const mongoose = require("mongoose");

const shiftSchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Staff ID is required"],
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: Date,
      required: [true, "Shift date is required"],
      index: true,
    },
    startTime: {
      type: String,
      required: [true, "Start time is required"],
      match: [/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Start time must use HH:mm"],
    },
    endTime: {
      type: String,
      required: [true, "End time is required"],
      match: [/^(?:[01]\d|2[0-3]):[0-5]\d$/, "End time must use HH:mm"],
    },
  },
  {
    timestamps: true,
    collection: "shifts",
  },
);

// Prevent exact duplicate shifts. The route separately rejects all overlaps.
shiftSchema.index(
  { staffId: 1, date: 1, startTime: 1, endTime: 1 },
  { unique: true },
);
shiftSchema.index({ date: 1, staffId: 1 });

module.exports = mongoose.models.Shift || mongoose.model("Shift", shiftSchema);
