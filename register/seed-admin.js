require("dotenv").config();

//Note: This script is used to seed the initial admin user into the database.
//Note: It should be run only once during the initial setup of the application.

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { connectDB } = require("./dbconnect");
const User = require("./userModel");

async function seedAdmin() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      " ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD are required",
    );
  }
  if (ADMIN_PASSWORD.length < 8) {
    throw new Error("ADMIN_PASSWORD must contain at least 8 characters");
  }

  await connectDB();

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
