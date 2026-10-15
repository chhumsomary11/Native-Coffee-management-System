const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0, "Payment amount cannot be negative"],
    },
    method: {
      type: String,
      enum: ["cash", "card"],
      required: true,
    },
    status: {
      type: String,
      enum: ["processing", "paid"],
      default: "processing",
      required: true,
      index: true,
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    paidByRole: {
      type: String,
      enum: ["customer", "barista"],
      required: true,
    },
  },
  {
    timestamps: true,
    collection: "payments",
  },
);

paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ customerId: 1, createdAt: -1 });

module.exports =
  mongoose.models.Payment || mongoose.model("Payment", paymentSchema);
