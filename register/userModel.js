const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ["admin", "barista", "customer"],
      required: true,
      default: "customer",
    },
    phone: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: "users",
  },
);

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
