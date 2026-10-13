const mongoose = require("mongoose");
require("dotenv").config();

const uri = process.env.URI;

if (!uri) {
  throw new Error("URI is missing from the .env file");
}

const clientOptions = {
  serverApi: { version: "1", strict: true, deprecationErrors: true },
};

async function connectDB() {
  try {
    await mongoose.connect(uri, clientOptions);
    await mongoose.connection.db.admin().command({ ping: 1 });
    console.log("Inventory service connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    throw error;
  }
}

module.exports = { connectDB };
