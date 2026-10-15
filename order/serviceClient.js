require("dotenv").config();

class ServiceRequestError extends Error {
  constructor(message, status = 502, details = {}) {
    super(message);
    this.name = "ServiceRequestError";
    this.status = status;
    Object.assign(this, details);
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing from the .env file`);
  return value.replace(/\/$/, "");
}

function internalHeaders(identity = {}) {
  const headers = {
    "x-internal-key": requiredEnvironment("INTERNAL_API_KEY"),
  };

  if (identity.userId) headers["x-user-id"] = identity.userId;
  if (identity.name) headers["x-user-name"] = identity.name;
  if (identity.email) headers["x-user-email"] = identity.email;
  if (identity.role) headers["x-user-role"] = identity.role;
  return headers;
}

async function requestJson(url, options = {}) {
  const timeout = Number(process.env.SERVICE_REQUEST_TIMEOUT_MS) || 5000;
  let response;

  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    throw new ServiceRequestError("Dependent service is unavailable", 502, {
      cause: error,
    });
  }

  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ServiceRequestError("Dependent service returned invalid JSON");
    }
  }

  if (!response.ok) {
    const safeStatuses = new Set([400, 403, 404, 409]);
    throw new ServiceRequestError(
      typeof body.error === "string" ? body.error : "Dependent service request failed",
      safeStatuses.has(response.status) ? response.status : 502,
      body.stockItemId ? { stockItemId: body.stockItemId } : {},
    );
  }

  return body;
}

function getDrink(drinkId, identity) {
  const baseUrl = requiredEnvironment("MENU_SERVICE_URL");
  return requestJson(`${baseUrl}/menu/${encodeURIComponent(drinkId)}`, {
    method: "GET",
    headers: internalHeaders(identity),
  });
}

function updateInventory(path, items) {
  const baseUrl = requiredEnvironment("INVENTORY_SERVICE_URL");
  return requestJson(`${baseUrl}/inventory/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...internalHeaders(),
    },
    body: JSON.stringify({ items }),
  });
}

function consumeInventory(items) {
  return updateInventory("consume", items);
}

function restoreInventory(items) {
  return updateInventory("restore", items);
}

module.exports = {
  ServiceRequestError,
  requestJson,
  getDrink,
  consumeInventory,
  restoreInventory,
};
