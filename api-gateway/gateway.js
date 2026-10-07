require("dotenv").config();

const express = require("express");
const jwt = require("jsonwebtoken");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const { JWT_SECRETE, REGISTRATION_SERVICE_URL, LOGIN_SERVICE_URL } =
  process.env;

for (const [name, value] of Object.entries({
  JWT_SECRETE,
  REGISTRATION_SERVICE_URL,
  LOGIN_SERVICE_URL,
})) {
  if (!value) throw new Error(`${name} is required in the .env file`);
}

app.disable("x-powered-by");
// Leave request bodies untouched so the proxy can stream them to each service.

function authenticateToken(req, res, next) {
  const match = req.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return res.status(401).json({ error: "Bearer token is required" });
  }
  try {
    const user = jwt.verify(match[1], JWT_SECRETE, { algorithms: ["HS256"] });
    if (
      !user ||
      typeof user !== "object" ||
      typeof user.userId !== "string" ||
      !user.userId ||
      typeof user.email !== "string" ||
      !user.email ||
      !["admin", "barista", "customer"].includes(user.role)
    ) {
      return res.status(401).json({ error: "Invalid token claims" });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({
      error:
        error.name === "TokenExpiredError" ? "Token expired" : "Invalid token",
    });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
}

function serviceProxy(target, pathRewrite) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    ...(pathRewrite ? { pathRewrite } : {}),
    on: {
      proxyReq(proxyReq, req) {
        // Never trust identity headers supplied by a client.
        for (const header of proxyReq.getHeaderNames()) {
          if (header.startsWith("x-user-") || header.startsWith("x-auth-")) {
            proxyReq.removeHeader(header);
          }
        }
        if (req.user) {
          proxyReq.setHeader("x-user-id", req.user.userId);
          proxyReq.setHeader("x-user-email", req.user.email);
          proxyReq.setHeader("x-user-role", req.user.role);
        }
      },
      error(error, req, res) {
        console.error(
          "Proxy connection failed:",
          error.code || "unknown error",
        );
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Microservice is unavailable" }));
        }
      },
    },
  });
}

app.get("/", (req, res) =>
  res.json({ message: "Coffee Management API Gateway" }),
);
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Exact public routes: do not expose the service's other endpoints publicly.
app.post(
  "/register",
  serviceProxy(REGISTRATION_SERVICE_URL, () => "/register"),
);
app.post(
  "/auth/login",
  serviceProxy(LOGIN_SERVICE_URL, () => "/login"),
);

// Mounting at /admin strips that prefix: /admin/users becomes /users.
const adminRoutes = express.Router();
const registrationProxy = serviceProxy(REGISTRATION_SERVICE_URL);
adminRoutes.use(authenticateToken, requireAdmin);
adminRoutes.route("/users").get(registrationProxy).post(registrationProxy);
adminRoutes
  .route("/users/:id")
  .get(registrationProxy)
  .delete(registrationProxy);
app.use("/admin", adminRoutes);

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

if (require.main === module) {
  app.listen(PORT, () => console.log(`API Gateway is running on port ${PORT}`));
}

module.exports = { app };
