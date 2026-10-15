require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");

const { connectDB } = require("./dbconnect.js");
const Staff = require("./staffModel.js");
const Shift = require("./shiftModel.js");
const registrationClient = require("./serviceClient.js");

const app = express();
const PORT = Number(process.env.PORT) || 3007;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

function requireAdmin(req, res, next) {
  const userId = req.get("x-user-id");
  const name = req.get("x-user-name");
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

  req.user = { userId, name: name.trim(), role };
  return next();
}

function requireBarista(req, res, next) {
  const userId = req.get("x-user-id");
  const name = req.get("x-user-name");
  const role = req.get("x-user-role");

  if (
    !mongoose.isObjectIdOrHexString(userId) ||
    typeof name !== "string" ||
    !name.trim() ||
    !role
  ) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (role !== "barista") {
    return res.status(403).json({ error: "Barista access required" });
  }

  req.user = { userId, name: name.trim(), role };
  return next();
}

function requireInternalKey(req, res, next) {
  if (!INTERNAL_API_KEY) {
    return res
      .status(500)
      .json({ error: "Internal API key is not configured" });
  }
  if (req.get("x-internal-key") !== INTERNAL_API_KEY) {
    return res.status(401).json({ error: "Invalid internal API key" });
  }
  return next();
}

function validateObjectId(value, message) {
  if (!mongoose.isObjectIdOrHexString(value)) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
}

function parseDateOnly(value, label = "Date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error(`${label} must use YYYY-MM-DD format`);
    error.status = 400;
    throw error;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    const error = new Error(`${label} is invalid`);
    error.status = 400;
    throw error;
  }
  return date;
}

function validateTimeRange(startTime, endTime) {
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!timePattern.test(startTime) || !timePattern.test(endTime)) {
    const error = new Error("startTime and endTime must use HH:mm format");
    error.status = 400;
    throw error;
  }
  if (startTime >= endTime) {
    const error = new Error("startTime must be earlier than endTime");
    error.status = 400;
    throw error;
  }
}

function toPublicStaff(staff) {
  return {
    id: staff._id.toString(),
    userId: staff.userId.toString(),
    name: staff.name,
    position: staff.position,
    phone: staff.phone,
    createdAt: staff.createdAt,
    updatedAt: staff.updatedAt,
  };
}

function toPublicShift(shift) {
  return {
    id: shift._id.toString(),
    staffId: shift.staffId.toString(),
    name: shift.name,
    date: shift.date.toISOString().slice(0, 10),
    startTime: shift.startTime,
    endTime: shift.endTime,
    createdAt: shift.createdAt,
    updatedAt: shift.updatedAt,
  };
}

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

// Private lookup used by Registration before deleting a barista account.
app.get(
  "/internal/staff/by-user/:userId",
  requireInternalKey,
  async (req, res, next) => {
    try {
      validateObjectId(req.params.userId, "Invalid user ID");
      const staff = await Staff.findOne({ userId: req.params.userId });
      if (!staff)
        return res.status(404).json({ error: "Staff profile not found" });
      return res.status(200).json(toPublicStaff(staff));
    } catch (error) {
      return next(error);
    }
  },
);

app.post("/staff", requireAdmin, async (req, res, next) => {
  try {
    const { userId, position, phone } = req.body;
    validateObjectId(userId, "A valid barista userId is required");

    const user = await registrationClient.getUser(userId);
    if (user.role !== "barista") {
      return res.status(400).json({ error: "User must have the barista role" });
    }

    const staff = await Staff.create({
      userId,
      name: user.name,
      position,
      phone,
    });
    return res.status(201).json(toPublicStaff(staff));
  } catch (error) {
    return next(error);
  }
});

app.get("/staff", requireAdmin, async (req, res, next) => {
  try {
    const staff = await Staff.find().sort({ createdAt: -1 });
    return res.status(200).json({ staff: staff.map(toPublicStaff) });
  } catch (error) {
    return next(error);
  }
});

app.get("/staff/me", requireBarista, async (req, res, next) => {
  try {
    const staff = await Staff.findOne({ userId: req.user.userId });
    if (!staff)
      return res.status(404).json({ error: "Staff profile not found" });
    return res.status(200).json(toPublicStaff(staff));
  } catch (error) {
    return next(error);
  }
});

app.get("/staff/me/shifts", requireBarista, async (req, res, next) => {
  try {
    const staff = await Staff.findOne({ userId: req.user.userId });
    if (!staff)
      return res.status(404).json({ error: "Staff profile not found" });

    const filter = { staffId: staff._id };
    if (req.query.from !== undefined || req.query.to !== undefined) {
      const from = req.query.from
        ? parseDateOnly(req.query.from, "From date")
        : undefined;
      const to = req.query.to
        ? parseDateOnly(req.query.to, "To date")
        : undefined;
      if (from && to && from > to) {
        return res
          .status(400)
          .json({ error: "From date must not be after to date" });
      }
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }

    const shifts = await Shift.find(filter).sort({ date: 1, startTime: 1 });
    return res.status(200).json({ shifts: shifts.map(toPublicShift) });
  } catch (error) {
    return next(error);
  }
});

app.delete("/staff/:id", requireAdmin, async (req, res, next) => {
  try {
    validateObjectId(req.params.id, "Invalid staff ID");
    const staff = await Staff.findById(req.params.id);
    if (!staff)
      return res.status(404).json({ error: "Staff profile not found" });

    await Shift.deleteMany({ staffId: staff._id });
    await Staff.findByIdAndDelete(staff._id);
    return res
      .status(200)
      .json({ message: "Staff profile deleted successfully" });
  } catch (error) {
    return next(error);
  }
});

app.post("/shifts", requireAdmin, async (req, res, next) => {
  try {
    const { staffId, date, startTime, endTime } = req.body;
    validateObjectId(staffId, "A valid staffId is required");
    const shiftDate = parseDateOnly(date, "Shift date");
    validateTimeRange(startTime, endTime);

    const staff = await Staff.findById(staffId);
    if (!staff)
      return res.status(404).json({ error: "Staff profile not found" });

    const overlap = await Shift.exists({
      staffId,
      date: shiftDate,
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    });
    if (overlap) {
      return res
        .status(409)
        .json({ error: "Shift overlaps an existing shift" });
    }

    const shift = await Shift.create({
      name: staff.name,
      staffId,
      date: shiftDate,
      startTime,
      endTime,
    });
    return res.status(201).json(toPublicShift(shift));
  } catch (error) {
    return next(error);
  }
});

app.get("/shifts", requireAdmin, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.date !== undefined) {
      filter.date = parseDateOnly(req.query.date, "Shift date");
    }
    if (req.query.staffId !== undefined) {
      validateObjectId(req.query.staffId, "Invalid staffId filter");
      filter.staffId = req.query.staffId;
    }

    const shifts = await Shift.find(filter).sort({ date: 1, startTime: 1 });
    return res.status(200).json({ shifts: shifts.map(toPublicShift) });
  } catch (error) {
    return next(error);
  }
});

app.delete("/shifts/:id", requireAdmin, async (req, res, next) => {
  try {
    validateObjectId(req.params.id, "Invalid shift ID");
    const shift = await Shift.findByIdAndDelete(req.params.id);
    if (!shift) return res.status(404).json({ error: "Shift not found" });
    return res.status(204).send();
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
    const isStaffProfile = error.keyPattern?.userId;
    return res.status(409).json({
      error: isStaffProfile
        ? "Staff profile already exists for this user"
        : "Shift overlaps an existing shift",
    });
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
  for (const name of ["REGISTRATION_SERVICE_URL", "INTERNAL_API_KEY"]) {
    if (!process.env[name]) {
      throw new Error(`${name} is missing from the .env file`);
    }
  }
  await connectDB();
  await Promise.all([Staff.createIndexes(), Shift.createIndexes()]);
  return app.listen(PORT, () =>
    console.log(`Staff service listening on port ${PORT}`),
  );
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Staff service failed to start:", error.message);
    process.exit(1);
  });
}

module.exports = {
  app,
  start,
  Staff,
  Shift,
  parseDateOnly,
  validateTimeRange,
};
