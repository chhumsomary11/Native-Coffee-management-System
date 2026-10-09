require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");

const { connectDB } = require("./dbconnect.js");
const Drink = require("./menuModel.js");

const app = express();
const PORT = Number(process.env.PORT) || 3003;
const MENU_ROLES = new Set(["admin", "barista", "customer"]);
const EDITABLE_FIELDS = new Set([
  "name",
  "price",
  "category",
  "description",
  "available",
  "recipe",
]);

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

// The Gateway verifies the JWT and replaces any client-supplied x-user-* headers.
// This service must only be reachable through the Gateway in production.
function allowRoles(allowedRoles) {
  return (req, res, next) => {
    const role = req.get("x-user-role");

    if (!role || !MENU_ROLES.has(role)) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!allowedRoles.has(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return next();
  };
}

const allowAllUsers = allowRoles(MENU_ROLES);
const allowAdmin = allowRoles(new Set(["admin"]));

function toPublicDrink(drink) {
  return {
    id: drink._id.toString(),
    name: drink.name,
    price: drink.price,
    category: drink.category,
    description: drink.description,
    available: drink.available,
    recipe: (drink.recipe || []).map((item) => ({
      stockItemId: item.stockItemId.toString(),
      qty: item.qty,
    })),
    createdAt: drink.createdAt,
    updatedAt: drink.updatedAt,
  };
}

function validateObjectId(req, res, next) {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    return res.status(400).json({ error: "Invalid drink ID" });
  }
  return next();
}

// Health checks are called directly inside the private network.
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

// Admin: create a drink.
app.post("/menu", allowAdmin, async (req, res, next) => {
  try {
    const { name, price, category, description, available, recipe } = req.body;
    const drink = await Drink.create({
      name,
      price,
      category,
      description,
      available,
      recipe,
    });

    return res.status(201).json(toPublicDrink(drink));
  } catch (error) {
    return next(error);
  }
});

// Admin, barista, customer: list drinks with optional filters.
app.get("/menu", allowAllUsers, async (req, res, next) => {
  try {
    const filter = {};

    if (req.query.category !== undefined) {
      if (typeof req.query.category !== "string" || !req.query.category.trim()) {
        return res.status(400).json({ error: "Invalid category filter" });
      }
      filter.category = req.query.category.trim().toLowerCase();
    }

    if (req.query.available !== undefined) {
      if (!["true", "false"].includes(req.query.available)) {
        return res
          .status(400)
          .json({ error: "Available filter must be true or false" });
      }
      filter.available = req.query.available === "true";
    }

    const drinks = await Drink.find(filter).sort({ name: 1 });
    return res.status(200).json({ drinks: drinks.map(toPublicDrink) });
  } catch (error) {
    return next(error);
  }
});

// Admin, barista, customer: get one drink.
app.get(
  "/menu/:id",
  allowAllUsers,
  validateObjectId,
  async (req, res, next) => {
    try {
      const drink = await Drink.findById(req.params.id);
      if (!drink) {
        return res.status(404).json({ error: "Drink not found" });
      }
      return res.status(200).json(toPublicDrink(drink));
    } catch (error) {
      return next(error);
    }
  },
);

// Admin: update one or more editable drink fields.
app.put(
  "/menu/:id",
  allowAdmin,
  validateObjectId,
  async (req, res, next) => {
    try {
      const fields = Object.keys(req.body);
      if (fields.length === 0) {
        return res.status(400).json({ error: "At least one field is required" });
      }

      const invalidField = fields.find((field) => !EDITABLE_FIELDS.has(field));
      if (invalidField) {
        return res
          .status(400)
          .json({ error: `Field is not editable: ${invalidField}` });
      }

      const drink = await Drink.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!drink) {
        return res.status(404).json({ error: "Drink not found" });
      }
      return res.status(200).json(toPublicDrink(drink));
    } catch (error) {
      return next(error);
    }
  },
);

// Admin: delete a drink. A successful deletion intentionally has no body.
app.delete(
  "/menu/:id",
  allowAdmin,
  validateObjectId,
  async (req, res, next) => {
    try {
      const drink = await Drink.findByIdAndDelete(req.params.id);
      if (!drink) {
        return res.status(404).json({ error: "Drink not found" });
      }
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  },
);

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  if (error.name === "ValidationError") {
    const message = Object.values(error.errors)
      .map((item) => item.message)
      .join(", ");
    return res.status(400).json({ error: message });
  }

  console.error(error);
  return res.status(500).json({ error: "Internal server error" });
});

async function start() {
  await connectDB();
  return app.listen(PORT, () =>
    console.log(`Menu service listening on port ${PORT}`),
  );
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Menu service failed to start:", error.message);
    process.exit(1);
  });
}

module.exports = { app, start, Drink };
