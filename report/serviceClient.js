require("dotenv").config();

class ServiceRequestError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "ServiceRequestError";
    this.status = status;
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing from the .env file`);
  return value.replace(/\/$/, "");
}

async function getOrders(identity) {
  const baseUrl = requiredEnvironment("ORDER_SERVICE_URL");
  let response;

  try {
    response = await fetch(`${baseUrl}/orders`, {
      method: "GET",
      headers: {
        "x-internal-key": requiredEnvironment("INTERNAL_API_KEY"),
        "x-user-id": identity.userId,
        "x-user-name": identity.name,
        "x-user-email": identity.email || "",
        "x-user-role": identity.role,
      },
      signal: AbortSignal.timeout(
        Number(process.env.SERVICE_REQUEST_TIMEOUT_MS) || 5000,
      ),
    });
  } catch (error) {
    throw new ServiceRequestError("Order service is unavailable", 502);
  }

  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ServiceRequestError("Order service returned invalid JSON", 502);
    }
  }

  if (!response.ok) {
    throw new ServiceRequestError(
      typeof body.error === "string" ? body.error : "Order service request failed",
      response.status === 400 || response.status === 403 ? response.status : 502,
    );
  }
  if (!Array.isArray(body.orders)) {
    throw new ServiceRequestError("Order service returned an invalid response", 502);
  }
  return body.orders;
}

module.exports = { ServiceRequestError, getOrders };
