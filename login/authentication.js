const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const User = require("./userModel.js");
const dbconnect = require("./dbconnect.js");

const app = express();
const PORT = process.env.PORT || 3002;
const JWT_SECRETE = process.env.JWT_SECRETE;

app.use(express.json());

//1. Purpose: For health checks of the service
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

//2. Purpose: For user login and JWT token generation

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    // Find the user by email only.
    // Never trust a role submitted by the client.
    const user = await User.findOne({
      emailid: email.trim().toLowerCase(),
    }).select("+passwordHash");

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    //Note: Comparing Password with the hashed password stored in the database using bcrypt.
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const token = jwt.sign(
      {
        userId: user._id.toString(),
        email: user.emailid,
        role: user.role, // Role comes from the database
      },
      JWT_SECRETE,
      {
        expiresIn: "24h",
        algorithm: "HS256",
      },
    );

    return res.status(200).json({
      token,
      message: "Login successful",
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      message: "Unable to log in",
    });
  }
});

async function startServer() {
  try {
    if (!JWT_SECRETE) {
      throw new Error("JWT_SECRETE is missing");
    }

    await dbconnect.connectDB();

    app.listen(PORT, () => {
      console.log(`Authentication Service is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start service:", error.message);
    process.exit(1);
  }
}

startServer();
