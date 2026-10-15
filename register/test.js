const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.INTERNAL_API_KEY = "registration-test-key";
process.env.STAFF_SERVICE_URL = "http://127.0.0.1:1";
const { app, User } = require("./index.js");
const staffClient = require("./serviceClient.js");

test("private user lookup requires the internal key and returns a safe user", async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  let response = await fetch(`${baseUrl}/internal/users/${userId}`);
  assert.equal(response.status, 401);

  User.findById = () => ({
    select: async () => ({
      _id: userId,
      name: "Test Barista",
      email: "barista@example.com",
      role: "barista",
    }),
  });
  response = await fetch(`${baseUrl}/internal/users/${userId}`, {
    headers: { "x-internal-key": "registration-test-key" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: userId.toString(),
    name: "Test Barista",
    email: "barista@example.com",
    role: "barista",
  });

  const adminHeaders = { "x-user-role": "admin" };
  staffClient.hasStaffProfile = async () => true;
  response = await fetch(`${baseUrl}/users/${userId}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(response.status, 409);

  let deleted = false;
  staffClient.hasStaffProfile = async () => false;
  User.findByIdAndDelete = async () => {
    deleted = true;
  };
  response = await fetch(`${baseUrl}/users/${userId}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(response.status, 200);
  assert.equal(deleted, true);
});
