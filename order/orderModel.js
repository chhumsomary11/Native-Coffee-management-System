const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    drinkId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: [0, "Unit price cannot be negative"],
    },
    qty: {
      type: Number,
      required: true,
      min: [1, "Order quantity must be at least 1"],
      validate: {
        validator: Number.isInteger,
        message: "Order quantity must be a whole number",
      },
    },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    customerName: {
      type: String,
      required: [true, "Customer name is required"],
      trim: true,
    },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: "An order must contain at least one item",
      },
    },
    total: {
      type: Number,
      required: true,
      min: [0, "Order total cannot be negative"],
    },
    status: {
      type: String,
      enum: ["pending", "preparing", "ready", "completed"],
      default: "pending",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid"],
      default: "unpaid",
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "orders",
  },
);

orderSchema.index({ createdAt: -1 });
orderSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.models.Order || mongoose.model("Order", orderSchema);
