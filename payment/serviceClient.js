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

function identityHeaders(identity) {
  return {
    "x-internal-key": requiredEnvironment("INTERNAL_API_KEY"),
    "x-user-id": identity.userId,
    "x-user-name": identity.name,
    "x-user-email": identity.email || "",
    "x-user-role": identity.role,
  };
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
    throw new ServiceRequestError("Order service is unavailable", 502, {
      cause: error,
    });
  }

  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ServiceRequestError("Order service returned invalid JSON");
    }
  }

  if (!response.ok) {
    const safeStatuses = new Set([400, 403, 404, 409]);
    throw new ServiceRequestError(
      typeof body.error === "string" ? body.error : "Order service request failed",
      safeStatuses.has(response.status) ? response.status : 502,
    );
  }

  return body;
}

function getOrder(orderId, identity) {
  const baseUrl = requiredEnvironment("ORDER_SERVICE_URL");
  return requestJson(`${baseUrl}/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: identityHeaders(identity),
  });
}

function markOrderPaid(orderId) {
  const baseUrl = requiredEnvironment("ORDER_SERVICE_URL");
  return requestJson(
    `${baseUrl}/orders/${encodeURIComponent(orderId)}/payment-status`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": requiredEnvironment("INTERNAL_API_KEY"),
      },
      body: JSON.stringify({ paymentStatus: "paid" }),
    },
  );
}

module.exports = {
  ServiceRequestError,
  requestJson,
  getOrder,
  markOrderPaid,
};
