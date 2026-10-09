const mongoose = require("mongoose");

const recipeItemSchema = new mongoose.Schema(
  {
    stockItemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    qty: {
      type: Number,
      required: true,
      min: [0.01, "Recipe quantity must be greater than 0"],
    },
  },
  {
    _id: false,
  },
);

const drinkSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Drink name is required"],
      trim: true,
    },

    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
    },

    category: {
      type: String,
      enum: {
        values: ["coffee", "tea", "pastry", "other"],
        message: "Invalid category",
      },
      required: [true, "Category is required"],
      trim: true,
      lowercase: true,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    available: {
      type: Boolean,
      default: true,
    },

    recipe: {
      type: [recipeItemSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: "drinks",
  },
);

module.exports = mongoose.models.Drink || mongoose.model("Drink", drinkSchema);
