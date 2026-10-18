require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const pool = require("./db/pool");

const authRoutes = require("./routes/auth");
const bookRoutes = require("./routes/books");
const orderRoutes = require("./routes/orders");
const libraryRoutes = require("./routes/library");
const adminBookRoutes = require("./routes/admin-books");

const app = express();

app.locals.db = pool;

const PORT = process.env.PORT || 3000;


/* =========================
   CORS
========================= */

const allowedOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://santiano-ten.vercel.app"
];

app.use(
  cors({
    origin: function (origin, callback) {

      // Allow requests without an Origin header.
      // Useful for server-to-server requests and health checks.
      if (!origin) {
        return callback(null, true);
      }

      // Allow approved frontend origins.
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Reject unknown origins.
      return callback(
        new Error("Not allowed by CORS")
      );
    },

    credentials: true
  })
);


/* =========================
   JSON
========================= */

app.use(
  express.json({
    limit: "1mb"
  })
);


/* =========================
   UPLOADED FILES
========================= */

const uploadsPath = path.join(
  __dirname,
  "uploads"
);

app.use(
  "/api/files",
  express.static(uploadsPath)
);


/* =========================
   FRONTEND FILES
========================= */

// Frontend files are directly
// outside the server folder.

const frontendPath = path.join(
  __dirname,
  ".."
);

app.use(
  express.static(frontendPath)
);


/* =========================
   HEALTH
========================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true,
      service: "Santiano Books API",
      version: "2.0.0"
    });

  }
);


/* =========================
   API ROUTES
========================= */

app.use(
  "/api/auth",
  authRoutes
);

app.use(
  "/api/books",
  bookRoutes
);

app.use(
  "/api/orders",
  orderRoutes
);

app.use(
  "/api/library",
  libraryRoutes
);

app.use(
  "/api/admin",
  adminBookRoutes
);


/* =========================
   ERROR HANDLER
========================= */

app.use(
  (err, req, res, next) => {

    console.error(err);

    // CORS error
    if (err.message === "Not allowed by CORS") {
      return res.status(403).json({
        error: "CORS: Origin not allowed"
      });
    }

    res.status(500).json({
      error:
        err.message ||
        "Internal server error"
    });

  }
);


/* =========================
   404
========================= */

app.use(
  (req, res) => {

    res.status(404).json({
      error: "Route not found"
    });

  }
);


/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  () => {

    console.log(
      `Santiano Books API running on port ${PORT}`
    );

  }
);