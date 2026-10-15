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

async function hasStaffProfile(userId) {
  const baseUrl = requiredEnvironment("STAFF_SERVICE_URL");
  let response;
  try {
    response = await fetch(
      `${baseUrl}/internal/staff/by-user/${encodeURIComponent(userId)}`,
      {
        method: "GET",
        headers: {
          "x-internal-key": requiredEnvironment("INTERNAL_API_KEY"),
        },
        signal: AbortSignal.timeout(
          Number(process.env.SERVICE_REQUEST_TIMEOUT_MS) || 5000,
        ),
      },
    );
  } catch (error) {
    throw new ServiceRequestError("Staff service is unavailable", 502);
  }

  if (response.status === 404) return false;
  if (response.ok) return true;

  let body = {};
  try {
    body = await response.json();
  } catch {
    // Use the safe fallback below.
  }
  throw new ServiceRequestError(
    typeof body.error === "string" ? body.error : "Staff service request failed",
    502,
  );
}

module.exports = { ServiceRequestError, hasStaffProfile };
