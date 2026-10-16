const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const mongoose = require("mongoose");

process.env.ORDER_SERVICE_URL ||= "http://127.0.0.1:1";
process.env.INTERNAL_API_KEY ||= "report-test-key";
const { app } = require("./index.js");
const orderClient = require("./serviceClient.js");

const adminHeaders = {
  "x-user-id": new mongoose.Types.ObjectId().toString(),
  "x-user-name": "Report Admin",
  "x-user-email": "admin@example.com",
  "x-user-role": "admin",
};

test("reports count only paid orders and aggregate top drinks", async (t) => {
  const coffeeId = new mongoose.Types.ObjectId().toString();
  const teaId = new mongoose.Types.ObjectId().toString();
  const originalGetOrders = orderClient.getOrders;
  const orderServer = http.createServer((req, res) => {
    assert.equal(req.url, "/orders");
    assert.equal(req.headers["x-internal-key"], "report-test-key");
    assert.equal(req.headers["x-user-role"], "admin");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ orders: [] }));
  });
  orderServer.listen(0, "127.0.0.1");
  await new Promise((resolve) => orderServer.once("listening", resolve));
  t.after(() => orderServer.close());
  process.env.ORDER_SERVICE_URL = `http://127.0.0.1:${orderServer.address().port}`;
  assert.deepEqual(await originalGetOrders({
    userId: adminHeaders["x-user-id"],
    name: adminHeaders["x-user-name"],
    email: adminHeaders["x-user-email"],
    role: "admin",
  }), []);

  orderClient.getOrders = async () => [
    {
      paymentStatus: "paid",
      total: 10.5,
      createdAt: "2026-10-15T02:00:00.000Z",
      items: [
        { drinkId: coffeeId, name: "Latte", unitPrice: 3.5, qty: 2 },
        { drinkId: teaId, name: "Tea", unitPrice: 3.5, qty: 1 },
      ],
    },
    {
      paymentStatus: "paid",
      total: 3.5,
      createdAt: "2026-10-15T12:00:00.000Z",
      items: [
        { drinkId: coffeeId, name: "Latte", unitPrice: 3.5, qty: 1 },
      ],
    },
    {
      paymentStatus: "unpaid",
      total: 99,
      createdAt: "2026-10-15T13:00:00.000Z",
      items: [
        { drinkId: teaId, name: "Tea", unitPrice: 99, qty: 1 },
      ],
    },
  ];

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  let response = await fetch(`${baseUrl}/reports/daily?date=2026-10-15`, {
    headers: adminHeaders,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    date: "2026-10-15",
    orderCount: 2,
    totalRevenue: 14,
    averageOrderValue: 7,
  });

  response = await fetch(
    `${baseUrl}/reports/top-drinks?from=2026-10-15&to=2026-10-15&limit=1`,
    { headers: adminHeaders },
  );
  assert.equal(response.status, 200);
  const top = await response.json();
  assert.equal(top.drinks.length, 1);
  assert.deepEqual(top.drinks[0], {
    drinkId: coffeeId,
    name: "Latte",
    quantitySold: 3,
    revenue: 10.5,
  });

  response = await fetch(`${baseUrl}/reports/daily?date=2026-10-15`, {
    headers: { ...adminHeaders, "x-user-role": "customer" },
  });
  assert.equal(response.status, 403);

  response = await fetch(
    `${baseUrl}/reports/top-drinks?from=2026-10-16&to=2026-10-15`,
    { headers: adminHeaders },
  );
  assert.equal(response.status, 400);
});
