require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");

const { connectDB } = require("./dbconnect.js");
const StockItem = require("./stockItemModel.js");

const app = express();
const PORT = Number(process.env.PORT) || 3004;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const INVENTORY_ROLES = new Set(["admin", "barista", "customer"]);
const EDITABLE_FIELDS = new Set(["name", "unit", "quantity", "lowThreshold"]);

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

function allowRoles(allowedRoles) {
  return (req, res, next) => {
    const role = req.get("x-user-role");

    if (!role || !INVENTORY_ROLES.has(role)) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!allowedRoles.has(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}

function requireInternalKey(req, res, next) {
  if (!INTERNAL_API_KEY) {
    return res
      .status(503)
      .json({ error: "Internal API key is not configured" });
  }
  if (req.get("x-internal-key") !== INTERNAL_API_KEY) {
    return res.status(401).json({ error: "Invalid internal API key" });
  }
  return next();
}

const allowAdmin = allowRoles(new Set(["admin"]));
const allowInventoryReaders = allowRoles(new Set(["admin", "barista"]));

function toPublicStockItem(item) {
  return {
    id: item._id.toString(),
    name: item.name,
    unit: item.unit,
    quantity: item.quantity,
    lowThreshold: item.lowThreshold,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function validateObjectId(req, res, next) {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    return res.status(400).json({ error: "Invalid stock item ID" });
  }
  return next();
}

function normalizeConsumptionItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error("Items must be a non-empty array");
    error.status = 400;
    throw error;
  }

  const totals = new Map();
  for (const item of items) {
    if (!item || !mongoose.isObjectIdOrHexString(item.stockItemId)) {
      const error = new Error("Every item requires a valid stockItemId");
      error.status = 400;
      throw error;
    }
    if (
      typeof item.qty !== "number" ||
      !Number.isFinite(item.qty) ||
      item.qty <= 0
    ) {
      const error = new Error("Every item quantity must be greater than 0");
      error.status = 400;
      throw error;
    }

    const stockItemId = item.stockItemId.toString();
    totals.set(stockItemId, (totals.get(stockItemId) || 0) + item.qty);
  }

  return [...totals].map(([stockItemId, qty]) => ({ stockItemId, qty }));
}

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.post("/inventory", allowAdmin, async (req, res, next) => {
  try {
    const { name, unit, quantity, lowThreshold } = req.body;
    const item = await StockItem.create({ name, unit, quantity, lowThreshold });
    return res.status(201).json(toPublicStockItem(item));
  } catch (error) {
    return next(error);
  }
});

app.get("/inventory", allowInventoryReaders, async (req, res, next) => {
  try {
    const items = await StockItem.find().sort({ name: 1 });
    return res.status(200).json({ items: items.map(toPublicStockItem) });
  } catch (error) {
    return next(error);
  }
});

// Keep /low before parameterized inventory routes.
app.get("/inventory/low", allowInventoryReaders, async (req, res, next) => {
  try {
    const items = await StockItem.find({
      $expr: { $lte: ["$quantity", "$lowThreshold"] },
    }).sort({ name: 1 });
    return res.status(200).json({ items: items.map(toPublicStockItem) });
  } catch (error) {
    return next(error);
  }
});

app.put(
  "/inventory/:id",
  allowAdmin,
  validateObjectId,
  async (req, res, next) => {
    try {
      const fields = Object.keys(req.body);
      if (fields.length === 0) {
        return res
          .status(400)
          .json({ error: "At least one field is required" });
      }

      const invalidField = fields.find((field) => !EDITABLE_FIELDS.has(field));
      if (invalidField) {
        return res
          .status(400)
          .json({ error: `Field is not editable: ${invalidField}` });
      }

      const item = await StockItem.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!item) {
        return res.status(404).json({ error: "Stock item not found" });
      }
      return res.status(200).json(toPublicStockItem(item));
    } catch (error) {
      return next(error);
    }
  },
);

app.delete(
  "/inventory/:id",
  allowAdmin,
  validateObjectId,
  async (req, res, next) => {
    try {
      const item = await StockItem.findByIdAndDelete(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Stock item not found" });
      }
      return res.status(200).json({ message: "Item has been deleted" });
    } catch (error) {
      return next(error);
    }
  },
);

//Note: Internal use API
app.post("/inventory/consume", requireInternalKey, async (req, res, next) => {
  let session;
  try {
    const items = normalizeConsumptionItems(req.body.items);
    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      for (const item of items) {
        const updated = await StockItem.findOneAndUpdate(
          { _id: item.stockItemId, quantity: { $gte: item.qty } },
          { $inc: { quantity: -item.qty } },
          { new: true, runValidators: true, session },
        );

        if (!updated) {
          const error = new Error("Insufficient stock");
          error.status = 409;
          error.stockItemId = item.stockItemId;
          throw error;
        }
      }
    });

    return res.status(200).json({ consumed: true });
  } catch (error) {
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

app.post("/inventory/restore", requireInternalKey, async (req, res, next) => {
  let session;
  try {
    const items = normalizeConsumptionItems(req.body.items);
    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      for (const item of items) {
        const updated = await StockItem.findByIdAndUpdate(
          item.stockItemId,
          { $inc: { quantity: item.qty } },
          { new: true, runValidators: true, session },
        );
        if (!updated) {
          const error = new Error("Stock item not found");
          error.status = 404;
          error.stockItemId = item.stockItemId;
          throw error;
        }
      }
    });

    return res.status(200).json({ restored: true });
  } catch (error) {
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  if (error.code === 11000) {
    return res.status(409).json({ error: "Duplicate stock item name" });
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
  if (!INTERNAL_API_KEY) {
    throw new Error("INTERNAL_API_KEY is missing from the .env file");
  }
  await connectDB();

  // Ensure required indexes exist before accepting requests.
  await StockItem.createIndexes();

  ``;
  return app.listen(PORT, () =>
    console.log(`Inventory service listening on port ${PORT}`),
  );
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Inventory service failed to start:", error.message);
    process.exit(1);
  });
}

module.exports = {
  app,
  start,
  StockItem,
  normalizeConsumptionItems,
};
