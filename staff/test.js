const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.URI ||= "mongodb://127.0.0.1:27017/staff_test";
process.env.REGISTRATION_SERVICE_URL ||= "http://127.0.0.1:1";
process.env.INTERNAL_API_KEY ||= "test-internal-key";
const { app, Staff, Shift } = require("./index.js");
const registrationClient = require("./serviceClient.js");

const adminHeaders = {
  "content-type": "application/json",
  "x-user-id": new mongoose.Types.ObjectId().toString(),
  "x-user-name": "Test Admin",
  "x-user-role": "admin",
};
const staffId = new mongoose.Types.ObjectId();
const userId = new mongoose.Types.ObjectId();
const shiftId = new mongoose.Types.ObjectId();
const createdAt = new Date("2026-10-15T00:00:00.000Z");
const baristaHeaders = {
  "x-user-id": userId.toString(),
  "x-user-name": "Test Barista",
  "x-user-role": "barista",
};

function staffRecord() {
  return { _id: staffId, userId, name: "Test Barista", position: "Barista", phone: "012345678", createdAt, updatedAt: createdAt };
}

function shiftRecord() {
  return { _id: shiftId, staffId, date: new Date("2026-10-16T00:00:00.000Z"), startTime: "08:00", endTime: "16:00", createdAt, updatedAt: createdAt };
}

async function request(baseUrl, path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

test("Phase 6 routes enforce RBAC, validate shifts, and reject overlaps", async (t) => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  let response = await request(baseUrl, "/health");
  assert.equal(response.status, 200);

  response = await request(baseUrl, "/staff", {
    method: "GET",
    headers: { ...adminHeaders, "x-user-role": "barista" },
  });
  assert.equal(response.status, 403);

  registrationClient.getUser = async () => ({
    id: userId.toString(),
    name: "Test Barista",
    role: "barista",
  });
  Staff.create = async () => staffRecord();
  response = await request(baseUrl, "/staff", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ userId, position: "Barista", phone: "012345678" }),
  });
  assert.equal(response.status, 201);
  const createdStaff = await response.json();
  assert.equal(createdStaff.userId, userId.toString());
  assert.equal(createdStaff.name, "Test Barista");

  registrationClient.getUser = async () => ({
    id: userId.toString(),
    role: "customer",
  });
  response = await request(baseUrl, "/staff", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ userId, position: "Barista", phone: "012345678" }),
  });
  assert.equal(response.status, 400);

  registrationClient.getUser = async () => ({
    id: userId.toString(),
    name: "Test Barista",
    role: "barista",
  });

  Staff.findOne = async () => staffRecord();
  response = await request(baseUrl, "/staff/me", {
    headers: baristaHeaders,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).userId, userId.toString());

  Shift.find = () => ({ sort: async () => [shiftRecord()] });
  response = await request(
    baseUrl,
    "/staff/me/shifts?from=2026-10-16&to=2026-10-16",
    { headers: baristaHeaders },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).shifts.length, 1);

  response = await request(baseUrl, `/internal/staff/by-user/${userId}`);
  assert.equal(response.status, 401);

  response = await request(baseUrl, `/internal/staff/by-user/${userId}`, {
    headers: { "x-internal-key": "test-internal-key" },
  });
  assert.equal(response.status, 200);

  Staff.findById = async () => staffRecord();
  Shift.exists = async () => null;
  Shift.create = async () => shiftRecord();
  response = await request(baseUrl, "/shifts", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ staffId, date: "2026-10-16", startTime: "08:00", endTime: "16:00" }),
  });
  assert.equal(response.status, 201);

  Shift.exists = async () => ({ _id: shiftId });
  response = await request(baseUrl, "/shifts", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ staffId, date: "2026-10-16", startTime: "12:00", endTime: "17:00" }),
  });
  assert.equal(response.status, 409);

  response = await request(baseUrl, "/shifts", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ staffId, date: "2026-10-16", startTime: "16:00", endTime: "08:00" }),
  });
  assert.equal(response.status, 400);

  Shift.findByIdAndDelete = async () => shiftRecord();
  response = await request(baseUrl, `/shifts/${shiftId}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(response.status, 204);

  Staff.findById = async () => staffRecord();
  Shift.deleteMany = async () => ({ deletedCount: 0 });
  Staff.findByIdAndDelete = async () => staffRecord();
  response = await request(baseUrl, `/staff/${staffId}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(response.status, 204);
});
