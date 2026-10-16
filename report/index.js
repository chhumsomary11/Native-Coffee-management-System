require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const orderClient = require("./serviceClient.js");

const app = express();
const PORT = Number(process.env.PORT) || 3008;

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

function requireAdmin(req, res, next) {
  const userId = req.get("x-user-id");
  const name = req.get("x-user-name");
  const email = req.get("x-user-email");
  const role = req.get("x-user-role");

  if (
    !mongoose.isObjectIdOrHexString(userId) ||
    typeof name !== "string" ||
    !name.trim() ||
    !role
  ) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  req.user = { userId, name: name.trim(), email, role };
  return next();
}

function parseDateOnly(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error(`${label} must use YYYY-MM-DD format`);
    error.status = 400;
    throw error;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    const error = new Error(`${label} is invalid`);
    error.status = 400;
    throw error;
  }
  return date;
}

function paidOrdersInRange(orders, from, to) {
  const endExclusive = new Date(to);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return orders.filter((order) => {
    const createdAt = new Date(order.createdAt);
    return (
      order.paymentStatus === "paid" &&
      !Number.isNaN(createdAt.getTime()) &&
      createdAt >= from &&
      createdAt < endExclusive
    );
  });
}

function toCents(value) {
  return Math.round(Number(value) * 100);
}

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.get("/reports/daily", requireAdmin, async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const day = parseDateOnly(date, "Date");
    const orders = paidOrdersInRange(
      await orderClient.getOrders(req.user),
      day,
      day,
    );
    const totalCents = orders.reduce(
      (sum, order) => sum + toCents(order.total),
      0,
    );

    return res.status(200).json({
      date,
      orderCount: orders.length,
      totalRevenue: totalCents / 100,
      averageOrderValue:
        orders.length === 0
          ? 0
          : Math.round(totalCents / orders.length) / 100,
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/reports/top-drinks", requireAdmin, async (req, res, next) => {
  try {
    const fromText = req.query.from;
    const toText = req.query.to;
    const from = parseDateOnly(fromText, "From date");
    const to = parseDateOnly(toText, "To date");
    if (from > to) {
      return res.status(400).json({ error: "From date must not be after to date" });
    }

    const limitText = req.query.limit ?? "5";
    if (!/^\d+$/.test(limitText)) {
      return res.status(400).json({ error: "Limit must be a whole number" });
    }
    const limit = Number(limitText);
    if (limit < 1 || limit > 100) {
      return res.status(400).json({ error: "Limit must be between 1 and 100" });
    }

    const totals = new Map();
    const orders = paidOrdersInRange(
      await orderClient.getOrders(req.user),
      from,
      to,
    );
    for (const order of orders) {
      for (const item of order.items || []) {
        const current = totals.get(item.drinkId) || {
          drinkId: item.drinkId,
          name: item.name,
          quantitySold: 0,
          revenueCents: 0,
        };
        current.quantitySold += item.qty;
        current.revenueCents += toCents(item.unitPrice) * item.qty;
        totals.set(item.drinkId, current);
      }
    }

    const drinks = [...totals.values()]
      .sort(
        (a, b) =>
          b.quantitySold - a.quantitySold ||
          b.revenueCents - a.revenueCents ||
          a.name.localeCompare(b.name),
      )
      .slice(0, limit)
      .map(({ revenueCents, ...drink }) => ({
        ...drink,
        revenue: revenueCents / 100,
      }));

    return res.status(200).json({ from: fromText, to: toText, drinks });
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({
    error: status >= 500 ? "Internal server error" : error.message,
  });
});

async function start() {
  for (const name of ["ORDER_SERVICE_URL", "INTERNAL_API_KEY"]) {
    if (!process.env[name]) {
      throw new Error(`${name} is missing from the .env file`);
    }
  }
  return app.listen(PORT, () =>
    console.log(`Sales Report service listening on port ${PORT}`),
  );
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Sales Report service failed to start:", error.message);
    process.exit(1);
  });
}

module.exports = {
  app,
  start,
  parseDateOnly,
  paidOrdersInRange,
  toCents,
};
