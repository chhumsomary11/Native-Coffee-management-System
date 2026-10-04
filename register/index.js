require("dotenv").config();
const bcrypt = require("bcryptjs");
const express = require("express");
const mongoose = require("mongoose");

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const ADMIN_CREATED_ROLES = new Set(["admin", "barista"]);

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["admin", "barista", "customer"],
      default: "customer",
    },
  },
  { collection: "users", timestamps: { createdAt: true, updatedAt: false } },
);

const User = mongoose.model("User", userSchema);

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validateInput({ name, email, password }) {
  if (typeof name !== "string" || name.trim().length < 2) {
    return "Name must contain at least 2 characters";
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return "A valid email is required";
  if (typeof password !== "string" || password.length < 8) {
    return "Password must contain at least 8 characters";
  }
  return null;
}

function toPublicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

async function createUser({ name, email, password, role }) {
  const normalizedEmail = normalizeEmail(email);
  const validationError = validateInput({ name, email: normalizedEmail, password });
  if (validationError) {
    const error = new Error(validationError);
    error.status = 400;
    throw error;
  }

  if (await User.exists({ email: normalizedEmail })) {
    const error = new Error("Email already exists");
    error.status = 409;
    throw error;
  }

  return User.create({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 12),
    role,
  });
}

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.post("/register", async (req, res, next) => {
  try {
    // Ignore a public role value: public registration always creates a customer.
    const user = await createUser({ ...req.body, role: "customer" });
    res.status(201).json(toPublicUser(user));
  } catch (error) {
    next(error);
  }
});

app.post("/users", async (req, res, next) => {
  try {
    // Trust this only behind the Gateway and a private service port.
    if (req.get("x-user-role") !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { name, email, password, role } = req.body;
    if (!ADMIN_CREATED_ROLES.has(role)) {
      return res.status(400).json({ error: "Role must be admin or barista" });
    }

    const user = await createUser({ name, email, password, role });
    return res.status(201).json(toPublicUser(user));
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
    return res.status(409).json({ error: "Email already exists" });
  }
  if (error.name === "ValidationError") {
    return res.status(400).json({ error: error.message });
  }

  const status = error.status || 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({
    error: status >= 500 ? "Internal server error" : error.message,
  });
});

async function start() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);
  app.listen(PORT, () => console.log(`Registration service listening on port ${PORT}`));
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Registration service failed to start:", error.message);
    process.exit(1);
  });
}

module.exports = { app, start, User };
