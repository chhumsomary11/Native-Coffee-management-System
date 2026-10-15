const mongoose = require("mongoose");

const staffSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Barista user ID is required"],
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    position: {
      type: String,
      required: [true, "Position is required"],
      trim: true,
      minlength: [2, "Position must contain at least 2 characters"],
    },
    phone: {
      type: String,
      required: [true, "Phone is required"],
      trim: true,
      match: [
        /^\+?[0-9][0-9 -]{5,19}$/,
        "Phone must contain 6 to 20 valid characters",
      ],
    },
  },
  {
    timestamps: true,
    collection: "staff",
  },
);

module.exports = mongoose.models.Staff || mongoose.model("Staff", staffSchema);
