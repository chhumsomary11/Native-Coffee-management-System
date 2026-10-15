require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");

const { connectDB } = require("./dbconnect.js");
const Order = require("./orderModel.js");
const {
  getDrink,
  consumeInventory,
  restoreInventory,
} = require("./serviceClient.js");

const app = express();
const PORT = Number(process.env.PORT) || 3005;
const INSTANCE_ID = process.env.INSTANCE_ID || "order-A";
const ORDER_ROLES = new Set(["admin", "barista", "customer"]);
const STATUS_TRANSITIONS = {
  pending: "preparing",
  preparing: "ready",
  ready: "completed",
};

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => {
  res.set("X-Served-By", INSTANCE_ID);
  next();
});

function allowRoles(allowedRoles) {
  return (req, res, next) => {
    const userId = req.get("x-user-id");
    const name = req.get("x-user-name");
    const role = req.get("x-user-role");
    const email = req.get("x-user-email");

    if (
      !mongoose.isObjectIdOrHexString(userId) ||
      typeof name !== "string" ||
      !name.trim() ||
      !role ||
      !ORDER_ROLES.has(role)
    ) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!allowedRoles.has(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    req.user = { userId, name: name.trim(), role, email };
    return next();
  };
}

function requireInternalKey(req, res, next) {
  if (!process.env.INTERNAL_API_KEY) {
    return res
      .status(503)
      .json({ error: "Internal API key is not configured" });
  }
  if (req.get("x-internal-key") !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: "Invalid internal API key" });
  }
  return next();
}

function validateOrderId(req, res, next) {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    return res.status(400).json({ error: "Invalid order ID" });
  }
  return next();
}

function normalizeRequestedItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error("Items must be a non-empty array");
    error.status = 400;
    throw error;
  }

  const totals = new Map();
  for (const item of items) {
    if (!item || !mongoose.isObjectIdOrHexString(item.drinkId)) {
      const error = new Error("Every order item requires a valid drinkId");
      error.status = 400;
      throw error;
    }
    if (!Number.isInteger(item.qty) || item.qty < 1) {
      const error = new Error(
        "Every order quantity must be a whole number of at least 1",
      );
      error.status = 400;
      throw error;
    }

    const drinkId = item.drinkId.toString();
    totals.set(drinkId, (totals.get(drinkId) || 0) + item.qty);
  }

  return [...totals].map(([drinkId, qty]) => ({ drinkId, qty }));
}

async function buildOrderDetails(requestedItems, identity) {
  const drinks = await Promise.all(
    requestedItems.map((item) => getDrink(item.drinkId, identity)),
  );
  const inventoryTotals = new Map();
  let totalInCents = 0;

  const items = requestedItems.map((requested, index) => {
    const drink = drinks[index];
    if (!drink.available) {
      const error = new Error(`Drink is unavailable: ${drink.name}`);
      error.status = 404;
      throw error;
    }
    if (typeof drink.price !== "number" || !Number.isFinite(drink.price)) {
      const error = new Error("Menu returned an invalid drink price");
      error.status = 502;
      throw error;
    }

    totalInCents += Math.round(drink.price * 100) * requested.qty;
    for (const recipeItem of drink.recipe || []) {
      const requiredQty = recipeItem.qty * requested.qty;
      inventoryTotals.set(
        recipeItem.stockItemId,
        (inventoryTotals.get(recipeItem.stockItemId) || 0) + requiredQty,
      );
    }

    return {
      drinkId: requested.drinkId,
      name: drink.name,
      unitPrice: drink.price,
      qty: requested.qty,
    };
  });

  return {
    items,
    total: totalInCents / 100,
    inventoryItems: [...inventoryTotals].map(([stockItemId, qty]) => ({
      stockItemId,
      qty,
    })),
  };
}

function parseDateFilter(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error("Date must use YYYY-MM-DD format");
    error.status = 400;
    throw error;
  }

  const start = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    start.toISOString().slice(0, 10) !== value
  ) {
    const error = new Error("Date is invalid");
    error.status = 400;
    throw error;
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { $gte: start, $lt: end };
}

function toPublicOrder(order) {
  return {
    id: order._id.toString(),
    customerId: order.customerId.toString(),
    customerName: order.customerName || null,
    items: order.items.map((item) => ({
      drinkId: item.drinkId.toString(),
      name: item.name,
      unitPrice: item.unitPrice,
      qty: item.qty,
    })),
    total: order.total,
    status: order.status,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

const allowOrderCreation = allowRoles(new Set(["admin", "customer"]));
const allowOrderReading = allowRoles(new Set(["admin", "barista", "customer"]));
const allowStatusUpdate = allowRoles(new Set(["admin", "barista"]));

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.post("/orders", allowOrderCreation, async (req, res, next) => {
  let inventoryItems = [];
  let inventoryConsumed = false;

  try {
    const requestedItems = normalizeRequestedItems(req.body.items);
    const details = await buildOrderDetails(requestedItems, req.user);
    inventoryItems = details.inventoryItems;

    if (inventoryItems.length > 0) {
      await consumeInventory(inventoryItems);
      inventoryConsumed = true;
    }

    try {
      const order = await Order.create({
        customerId: req.user.userId,
        customerName: req.user.name,
        items: details.items,
        total: details.total,
      });
      return res.status(201).json(toPublicOrder(order));
    } catch (saveError) {
      if (inventoryConsumed) {
        try {
          await restoreInventory(inventoryItems);
        } catch (restoreError) {
          console.error(
            "CRITICAL: Inventory restoration failed:",
            restoreError.message,
          );
        }
      }
      throw saveError;
    }
  } catch (error) {
    return next(error);
  }
});

app.get("/orders", allowOrderReading, async (req, res, next) => {
  try {
    const filter = {};
    if (req.user.role === "customer") filter.customerId = req.user.userId;

    if (req.query.status !== undefined) {
      if (
        !["pending", "preparing", "ready", "completed"].includes(
          req.query.status,
        )
      ) {
        return res.status(400).json({ error: "Invalid order status filter" });
      }
      filter.status = req.query.status;
    }
    if (req.query.date !== undefined) {
      filter.createdAt = parseDateFilter(req.query.date);
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ orders: orders.map(toPublicOrder) });
  } catch (error) {
    return next(error);
  }
});

app.get(
  "/orders/:id",
  allowOrderReading,
  validateOrderId,
  async (req, res, next) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (
        req.user.role === "customer" &&
        order.customerId.toString() !== req.user.userId
      ) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return res.status(200).json(toPublicOrder(order));
    } catch (error) {
      return next(error);
    }
  },
);

app.put(
  "/orders/:id/status",
  allowStatusUpdate,
  validateOrderId,
  async (req, res, next) => {
    try {
      const { status } = req.body;
      if (!["pending", "preparing", "ready", "completed"].includes(status)) {
        return res.status(400).json({ error: "Invalid order status" });
      }

      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (STATUS_TRANSITIONS[order.status] !== status) {
        return res.status(409).json({
          error: `Order cannot move from ${order.status} to ${status}`,
        });
      }
      if (status === "completed" && order.paymentStatus !== "paid") {
        return res
          .status(409)
          .json({ error: "Order must be paid before completion" });
      }

      order.status = status;
      await order.save();
      return res.status(200).json(toPublicOrder(order));
    } catch (error) {
      return next(error);
    }
  },
);

app.put(
  "/orders/:id/payment-status",
  requireInternalKey,
  validateOrderId,
  async (req, res, next) => {
    try {
      if (req.body.paymentStatus !== "paid") {
        return res.status(400).json({ error: "paymentStatus must be paid" });
      }

      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.paymentStatus === "paid") {
        return res.status(409).json({ error: "Order is already paid" });
      }

      order.paymentStatus = "paid";
      await order.save();
      return res.status(200).json(toPublicOrder(order));
    } catch (error) {
      return next(error);
    }
  },
);

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  if (error.name === "ValidationError" || error.name === "CastError") {
    const message = error.errors
      ? Object.values(error.errors)
          .map((item) => item.message)
          .join(", ")
      : error.message;
    return res.status(400).json({ error: message });
  }

  const status = error.status || 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({
    error: status >= 500 ? "Internal server error" : error.message,
    ...(error.stockItemId ? { stockItemId: error.stockItemId } : {}),
  });
});

async function start() {
  const required = [
    "MENU_SERVICE_URL",
    "INVENTORY_SERVICE_URL",
    "INTERNAL_API_KEY",
    "INSTANCE_ID",
  ];
  for (const name of required) {
    if (!process.env[name])
      throw new Error(`${name} is missing from the .env file`);
  }

  await connectDB();
  await Order.createIndexes();
  return app.listen(PORT, () =>
    console.log(`Order service ${INSTANCE_ID} listening on port ${PORT}`),
  );
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Order service failed to start:", error.message);
    process.exit(1);
  });
}

module.exports = {
  app,
  start,
  Order,
  normalizeRequestedItems,
  buildOrderDetails,
  parseDateFilter,
};
