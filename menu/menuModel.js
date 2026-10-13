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
      validate: {
        validator(items) {
          const ids = items.map((item) => item.stockItemId.toString());
          return new Set(ids).size === ids.length;
        },
        message: "Recipe cannot contain duplicate stock items",
      },
    },
  },
  {
    timestamps: true,
    collection: "drinks",
  },
);

drinkSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } },
);

module.exports = mongoose.models.Drink || mongoose.model("Drink", drinkSchema);
