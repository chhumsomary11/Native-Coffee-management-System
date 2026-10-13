const mongoose = require("mongoose");

const stockItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Stock item name is required"],
      trim: true,
    },
    unit: {
      type: String,
      required: [true, "Unit is required"],
      trim: true,
      lowercase: true,
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [0, "Quantity cannot be negative"],
    },
    lowThreshold: {
      type: Number,
      required: [true, "Low threshold is required"],
      min: [0, "Low threshold cannot be negative"],
    },
  },
  {
    timestamps: true,
    collection: "stock_items",
  },
);

stockItemSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } },
);

module.exports =
  mongoose.models.StockItem || mongoose.model("StockItem", stockItemSchema);
