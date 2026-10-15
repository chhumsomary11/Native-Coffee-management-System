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

async function requestJson(url, options = {}) {
  const timeout = Number(process.env.SERVICE_REQUEST_TIMEOUT_MS) || 5000;
  let response;

  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    throw new ServiceRequestError("Registration service is unavailable", 502);
  }

  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ServiceRequestError(
        "Registration service returned invalid JSON",
        502,
      );
    }
  }

  if (!response.ok) {
    const safeStatuses = new Set([400, 404]);
    throw new ServiceRequestError(
      typeof body.error === "string"
        ? body.error
        : "Registration service request failed",
      safeStatuses.has(response.status) ? response.status : 502,
    );
  }
  return body;
}

function getUser(userId) {
  const baseUrl = requiredEnvironment("REGISTRATION_SERVICE_URL");
  return requestJson(
    `${baseUrl}/internal/users/${encodeURIComponent(userId)}`,
    {
      method: "GET",
      headers: {
        "x-internal-key": requiredEnvironment("INTERNAL_API_KEY"),
      },
    },
  );
}

module.exports = { ServiceRequestError, requestJson, getUser };
