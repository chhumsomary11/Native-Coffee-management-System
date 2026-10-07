require("dotenv").config();

const bcrypt = require("bcryptjs");
const express = require("express");
const app = express();
const PORT = Number(process.env.PORT) || 3001;
const ADMIN_CREATED_ROLES = new Set(["admin", "barista"]);

const { connectDB } = require("./dbconnect.js");
const User = require("./userModel.js");

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validateInput({ name, email, password }) {
  if (typeof name !== "string" || name.trim().length < 2) {
    return "Name must contain at least 2 characters";
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(email))
    return "A valid email is required";
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
  const validationError = validateInput({
    name,
    email: normalizedEmail,
    password,
  });
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

// 1. Purpose: For health checks of the service
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

//2. Purpose: for normal user registration, always creates a customer role.   (Public)
app.post("/register", async (req, res, next) => {
  try {
    // Ignore a public role value: public registration always creates a customer.
    const user = await createUser({ ...req.body, role: "customer" });
    res.status(201).json(toPublicUser(user));
  } catch (error) {
    next(error);
  }
});

//3. Purpose: For admin to create users with role as admin or barista.        (Admin-only)
app.post("/users", async (req, res, next) => {
  try {
    //Note:  Trust this only behind the Gateway and a private service port.
    if (req.get("x-user-role") !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    //Note:  Check if the user has role as admin or barista, otherwise return an error.
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

// 4. Purpose: For admin to get a list of all users. (Admin-only)
app.get("/users", async (req, res, next) => {
  try {
    //Note:  Trust this only behind the Gateway and a private service port.
    if (req.get("x-user-role") !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const users = await User.find().select("-passwordHash");
    return res.status(200).json(users.map(toPublicUser));
  } catch (error) {
    return next(error);
  }
});

// 5. Purpose: For admin to get a specific user by ID. (Admin-only)
app.get("/users/:id", async (req, res, next) => {
  try {
    //Note:  Trust this only behind the Gateway and a private service port.
    if (req.get("x-user-role") !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const user = await User.findById(req.params.id).select("-passwordHash");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.status(200).json(toPublicUser(user));
  } catch (error) {
    return next(error);
  }
});

// 6. Purpose: For admin to delete a specific user by ID. (Admin-only)
app.delete("/users/:id", async (req, res, next) => {
  try {
    //Note:  Trust this only behind the Gateway and a private service port.
    if (req.get("x-user-role") !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.status(200).json({ message: "User deleted successfully" });
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
  await connectDB();
  app.listen(PORT, () =>
    console.log(`Registration service listening on port ${PORT}`),
  );
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Registration service failed to start:", error.message);
    process.exit(1);
  });
}

module.exports = { app, start, User };
