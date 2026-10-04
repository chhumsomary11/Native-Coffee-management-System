require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const User = mongoose.model(
  "User",
  new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      passwordHash: { type: String, required: true, select: false },
      role: { type: String, enum: ["admin", "barista", "customer"], required: true },
    },
    { collection: "users", timestamps: { createdAt: true, updatedAt: false } },
  ),
);

async function seedAdmin() {
  const { MONGO_URI, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!MONGO_URI || !ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error("MONGO_URI, ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD are required");
  }
  if (ADMIN_PASSWORD.length < 8) {
    throw new Error("ADMIN_PASSWORD must contain at least 8 characters");
  }

  await mongoose.connect(MONGO_URI);
  const email = ADMIN_EMAIL.trim().toLowerCase();
  if (await User.exists({ email })) {
    console.log(`Admin seed skipped: ${email} already exists`);
    return;
  }

  await User.create({
    name: ADMIN_NAME.trim(),
    email,
    passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
    role: "admin",
  });
  console.log(`Initial admin created: ${email}`);
}

seedAdmin()
  .catch((error) => {
    console.error("Admin seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
