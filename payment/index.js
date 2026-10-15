require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");

const { connectDB } = require("./dbconnect.js");
const Payment = require("./paymentModel.js");
const { getOrder, markOrderPaid } = require("./serviceClient.js");

const app = express();
const PORT = Number(process.env.PORT) || 3006;
const PAYMENT_ROLES = new Set(["admin", "barista", "customer"]);

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

function allowRoles(allowedRoles) {
  return (req, res, next) => {
    const userId = req.get("x-user-id");
    const name = req.get("x-user-name");
    const email = req.get("x-user-email");
    const role = req.get("x-user-role");

    if (
      !mongoose.isObjectIdOrHexString(userId) ||
      typeof name !== "string" ||
      !name.trim() ||
      !role ||
      !PAYMENT_ROLES.has(role)
    ) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!allowedRoles.has(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    req.user = { userId, name: name.trim(), email, role };
    return next();
  };
}

function validateOrderId(req, res, next) {
  if (!mongoose.isObjectIdOrHexString(req.params.orderId)) {
    return res.status(400).json({ error: "Invalid order ID" });
  }
  return next();
}

function toCents(value) {
  return Math.round(value * 100);
}

function validatePaymentInput({ orderId, amount, method }) {
  if (!mongoose.isObjectIdOrHexString(orderId)) {
    const error = new Error("A valid orderId is required");
    error.status = 400;
    throw error;
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    const error = new Error("Amount must be a non-negative number");
    error.status = 400;
    throw error;
  }
  if (!Number.isInteger(toCents(amount)) || toCents(amount) / 100 !== amount) {
    const error = new Error("Amount can have at most two decimal places");
    error.status = 400;
    throw error;
  }
  if (!["cash", "card"].includes(method)) {
    const error = new Error("Payment method must be cash or card");
    error.status = 400;
    throw error;
  }
}

function parseDate(value, label) {
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

function toPublicPayment(payment) {
  return {
    id: payment._id.toString(),
    orderId: payment.orderId.toString(),
    customerId: payment.customerId.toString(),
    amount: payment.amount,
    method: payment.method,
    status: payment.status,
    paidBy: payment.paidBy.toString(),
    paidByRole: payment.paidByRole,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

const allowPaymentCreation = allowRoles(new Set(["customer", "barista"]));
const allowPaymentReading = allowRoles(new Set(["admin", "barista", "customer"]));
const allowAdmin = allowRoles(new Set(["admin"]));

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.post("/payments", allowPaymentCreation, async (req, res, next) => {
  let payment;
  try {
    const { orderId, amount, method } = req.body;
    validatePaymentInput({ orderId, amount, method });

    const order = await getOrder(orderId, req.user);
    if (order.paymentStatus === "paid") {
      return res.status(409).json({ error: "Order is already paid" });
    }
    if (
      req.user.role === "customer" &&
      order.customerId !== req.user.userId
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (toCents(amount) !== toCents(order.total)) {
      return res.status(400).json({ error: "Payment amount must equal order total" });
    }

    payment = await Payment.create({
      orderId,
      customerId: order.customerId,
      amount,
      method,
      status: "processing",
      paidBy: req.user.userId,
      paidByRole: req.user.role,
    });

    let orderIsPaid = false;
    try {
      await markOrderPaid(orderId);
      orderIsPaid = true;
    } catch (markError) {
      // The update may have succeeded even if its HTTP response was lost.
      try {
        const refreshedOrder = await getOrder(orderId, req.user);
        orderIsPaid = refreshedOrder.paymentStatus === "paid";
      } catch {
        // Keep the processing record for later reconciliation because the
        // final Order state is unknown.
        throw markError;
      }

      if (!orderIsPaid) {
        await Payment.deleteOne({ _id: payment._id });
        throw markError;
      }
    }

    if (orderIsPaid) {
      payment.status = "paid";
      await payment.save();
    }

    return res.status(201).json(toPublicPayment(payment));
  } catch (error) {
    return next(error);
  }
});

app.get(
  "/payments/:orderId",
  allowPaymentReading,
  validateOrderId,
  async (req, res, next) => {
    try {
      const payment = await Payment.findOne({ orderId: req.params.orderId });
      if (!payment || payment.status !== "paid") {
        return res.status(404).json({ error: "Payment not found" });
      }
      if (
        req.user.role === "customer" &&
        payment.customerId.toString() !== req.user.userId
      ) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return res.status(200).json(toPublicPayment(payment));
    } catch (error) {
      return next(error);
    }
  },
);

app.get("/payments", allowAdmin, async (req, res, next) => {
  try {
    const filter = { status: "paid" };
    if (req.query.from !== undefined || req.query.to !== undefined) {
      filter.createdAt = {};
      if (req.query.from !== undefined) {
        filter.createdAt.$gte = parseDate(req.query.from, "from");
      }
      if (req.query.to !== undefined) {
        const end = parseDate(req.query.to, "to");
        end.setUTCDate(end.getUTCDate() + 1);
        filter.createdAt.$lt = end;
      }
      if (
        filter.createdAt.$gte &&
        filter.createdAt.$lt &&
        filter.createdAt.$gte >= filter.createdAt.$lt
      ) {
        return res.status(400).json({ error: "from must not be after to" });
      }
    }

    const payments = await Payment.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ payments: payments.map(toPublicPayment) });
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  if (error.code === 11000) {
    return res.status(409).json({ error: "Order has already been paid" });
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
  });
});

async function start() {
  for (const name of ["ORDER_SERVICE_URL", "INTERNAL_API_KEY"]) {
    if (!process.env[name]) throw new Error(`${name} is missing from the .env file`);
  }
  await connectDB();
  await Payment.createIndexes();
  return app.listen(PORT, () =>
    console.log(`Payment service listening on port ${PORT}`),
  );
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Payment service failed to start:", error.message);
    process.exit(1);
  });
}

module.exports = {
  app,
  start,
  Payment,
  validatePaymentInput,
  parseDate,
  toCents,
};
