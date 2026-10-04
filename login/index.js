require("dotenv").config();
const bcrypt = require("bcryptjs");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const app = express();
const PORT = Number(process.env.PORT) || 3002;

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

// Login reads the users collection owned by the Registration service.
const userSchema = new mongoose.Schema(
  {
    name: String,
    email: String,
    passwordHash: { type: String, select: false },
    role: String,
  },
  { collection: "users", timestamps: { createdAt: true, updatedAt: false } },
);

const User = mongoose.model("User", userSchema);

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.post("/login", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;

    if (!email || typeof password !== "string" || password.length === 0) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email }).select("+passwordHash");
    const passwordMatches = user
      ? await bcrypt.compare(password, user.passwordHash)
      : false;

    // Unknown email and wrong password deliberately use the same response.
    if (!user || !passwordMatches) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user._id.toString(), role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "1h" },
    );

    return res.status(200).json({
      token,
      expiresIn: 3600,
      user: { id: user._id.toString(), name: user.name, role: user.role },
    });
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  console.error(error);
  return res.status(500).json({ error: "Internal server error" });
});

async function start() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }

  await mongoose.connect(process.env.MONGO_URI);
  app.listen(PORT, () => console.log(`Login service listening on port ${PORT}`));
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Login service failed to start:", error.message);
    process.exit(1);
  });
}

module.exports = { app, start, User };
