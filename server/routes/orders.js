
const express = require("express");

const router = express.Router();

const db = require("../db/pool");
const supabase = require("../supabase/client");
const requireAuth = require("../middleware/auth");

/* =====================================================
   PAYSTACK REQUEST HELPER
===================================================== */

async function paystackRequest(endpoint, options = {}) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  }

  const response = await fetch(
    `https://api.paystack.co${endpoint}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    }
  );

  const data = await response.json();

  if (!response.ok || !data.status) {
    throw new Error(data.message || "Paystack request failed.");
  }

  return data;
}

/* =====================================================
   CHECK BOOK PDF IN SUPABASE STORAGE
   New: ebooks/filename.pdf inside ebooks bucket
   Legacy: filename.pdf at bucket root
===================================================== */

async function ensureBookFileExists(book) {
  if (!book.file_key) {
    throw new Error(
      `The PDF for "${book.title}" is not available.`
    );
  }

  const fileKey = String(book.file_key)
    .trim()
    .replace(/^\/+/, "");

  // A database key beginning with ebooks/ points to
  // the nested folder. A plain filename is a legacy root file.
  const candidates = fileKey.startsWith("ebooks/")
    ? [fileKey, fileKey.slice("ebooks/".length)]
    : [fileKey, `ebooks/${fileKey}`];

  const uniqueCandidates = [
    ...new Set(candidates.filter(Boolean)),
  ];

  let lastStorageError = null;

  for (const storagePath of uniqueCandidates) {
    const separator = storagePath.lastIndexOf("/");
    const folder =
      separator >= 0
        ? storagePath.slice(0, separator)
        : "";

    const fileName =
      separator >= 0
        ? storagePath.slice(separator + 1)
        : storagePath;

    const { data, error } = await supabase.storage
      .from("ebooks")
      .list(folder, {
        search: fileName,
        limit: 100,
      });

    if (error) {
      lastStorageError = error;

      console.error("Supabase ebook check error:", {
        title: book.title,
        storagePath,
        folder,
        fileName,
        error: error.message,
      });

      continue;
    }

    const exists = (data || []).some(
      (file) =>
        file.name === fileName &&
        !file.id?.endsWith("/")
    );

    if (exists) {
      return true;
    }
  }

  if (lastStorageError) {
    throw new Error(
      `Unable to verify the PDF for "${book.title}" in Supabase Storage. Check the server logs.`
    );
  }

  console.error("Ebook not found in Supabase Storage:", {
    title: book.title,
    databaseFileKey: fileKey,
    checkedPaths: uniqueCandidates,
  });

  throw new Error(
    `The PDF for "${book.title}" is not available in Supabase Storage.`
  );
}

/* =====================================================
   GET MY ORDERS
   GET /api/orders
===================================================== */

router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT
        o.id,
        o.status,
        o.currency,
        o.total_kobo,
        o.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'book_id', oi.book_id,
              'quantity', oi.quantity,
              'unit_price_kobo', oi.unit_price_kobo,
              'title', b.title,
              'cover_key', b.cover_key
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN books b ON b.id = oi.book_id
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC
      `,
      [req.user.id]
    );

    res.json({
      orders: result.rows.map((order) => ({
        id: Number(order.id),
        status: order.status,
        currency: order.currency,
        total_kobo: Number(order.total_kobo),
        created_at: order.created_at,
        items: order.items || [],
      })),
    });
  } catch (error) {
    console.error("Get orders error:", error);

    res.status(500).json({
      error: "Unable to load your orders.",
    });
  }
});

/* =====================================================
   CREATE DRAFT ORDER
   POST /api/orders/draft
===================================================== */

router.post("/draft", requireAuth, async (req, res) => {
  const client = await db.connect();
  let transactionStarted = false;

  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "Cart is empty.",
      });
    }

    await client.query("BEGIN");
    transactionStarted = true;

    let totalKobo = 0;
    const orderItems = [];

    for (const item of items) {
      const bookId = Number(item.book_id || item.id);
      const quantity = Number(item.quantity || item.qty || 1);

      if (!Number.isInteger(bookId) || bookId <= 0) {
        throw new Error("Invalid book ID.");
      }

      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error("Invalid quantity.");
      }

      const bookResult = await client.query(
        `
        SELECT id, title, price_kobo, is_published, file_key
        FROM books
        WHERE id = $1
        FOR SHARE
        `,
        [bookId]
      );

      if (bookResult.rows.length === 0) {
        throw new Error(`Book not found: ${bookId}`);
      }

      const book = bookResult.rows[0];

      if (!book.is_published) {
        throw new Error(`Book is not available: ${book.title}`);
      }

      await ensureBookFileExists(book);

      const unitPriceKobo = Number(book.price_kobo);

      if (
        !Number.isSafeInteger(unitPriceKobo) ||
        unitPriceKobo <= 0
      ) {
        throw new Error(`Invalid price for book: ${book.title}`);
      }

      const itemTotal = unitPriceKobo * quantity;

      if (!Number.isSafeInteger(itemTotal)) {
        throw new Error("Order item total is too large.");
      }

      totalKobo += itemTotal;

      if (!Number.isSafeInteger(totalKobo)) {
        throw new Error("Order total is too large.");
      }

      orderItems.push({
        bookId: book.id,
        quantity,
        unitPriceKobo,
      });
    }

    if (totalKobo <= 0) {
      throw new Error("The order total must be greater than zero.");
    }

    const orderResult = await client.query(
      `
      INSERT INTO orders (user_id, status, currency, total_kobo)
      VALUES ($1, $2, $3, $4)
      RETURNING id, user_id, status, currency, total_kobo
      `,
      [req.user.id, "pending", "NGN", totalKobo]
    );

    const order = orderResult.rows[0];

    for (const item of orderItems) {
      await client.query(
        `
        INSERT INTO order_items (
          order_id, book_id, quantity, unit_price_kobo
        )
        VALUES ($1, $2, $3, $4)
        `,
        [
          order.id,
          item.bookId,
          item.quantity,
          item.unitPriceKobo,
        ]
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    res.status(201).json({
      ok: true,
      order: {
        id: Number(order.id),
        user_id: Number(order.user_id),
        status: order.status,
        currency: order.currency,
        total_kobo: Number(order.total_kobo),
      },
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }

    console.error("Create draft order error:", error);

    res.status(400).json({
      error: error.message || "Could not create draft order.",
    });
  } finally {
    client.release();
  }
});

/* =====================================================
   INITIALIZE PAYSTACK PAYMENT
   POST /api/orders/paystack/initialize
===================================================== */

router.post(
  "/paystack/initialize",
  requireAuth,
  async (req, res) => {
    try {
      const orderId = Number(req.body.order_id);

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({
          error: "Invalid order ID.",
        });
      }

      const orderResult = await db.query(
        `
        SELECT id, user_id, total_kobo, currency, status
        FROM orders
        WHERE id = $1
        LIMIT 1
        `,
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        return res.status(404).json({
          error: "Order does not exist.",
        });
      }

      const order = orderResult.rows[0];

      if (Number(order.user_id) !== Number(req.user.id)) {
        return res.status(403).json({
          error: "You cannot pay for this order.",
        });
      }

      if (order.status !== "pending") {
        return res.status(400).json({
          error: "This order cannot be paid for.",
        });
      }

      if (order.currency !== "NGN") {
        return res.status(400).json({
          error: "This order uses an unsupported currency.",
        });
      }

      const totalKobo = Number(order.total_kobo);

      if (!Number.isSafeInteger(totalKobo) || totalKobo <= 0) {
        return res.status(400).json({
          error: "Order total is invalid.",
        });
      }

      const email = req.user.email;

      if (!email) {
        return res.status(400).json({
          error: "Customer email is required.",
        });
      }

      const itemsResult = await db.query(
        `
        SELECT
          oi.book_id,
          oi.quantity,
          b.id,
          b.title,
          b.file_key,
          b.is_published
        FROM order_items oi
        INNER JOIN books b ON b.id = oi.book_id
        WHERE oi.order_id = $1
        `,
        [orderId]
      );

      if (itemsResult.rows.length === 0) {
        return res.status(400).json({
          error: "This order has no books.",
        });
      }

      for (const item of itemsResult.rows) {
        if (!item.is_published) {
          return res.status(400).json({
            error: `Book is no longer available: ${item.title}`,
          });
        }

        await ensureBookFileExists(item);
      }

      const reference = `SANTIANO-${order.id}-${Date.now()}`;

      const payment = await paystackRequest(
        "/transaction/initialize",
        {
          method: "POST",
          body: JSON.stringify({
            email,
            amount: totalKobo,
            currency: "NGN",
            reference,
            metadata: {
              order_id: Number(order.id),
              user_id: Number(req.user.id),
            },
          }),
        }
      );

      res.json({
        ok: true,
        access_code: payment.data.access_code,
        authorization_url: payment.data.authorization_url,
        reference: payment.data.reference,
      });
    } catch (error) {
      console.error("Paystack initialization error:", error);

      res.status(400).json({
        error: error.message || "Unable to initialize payment.",
      });
    }
  }
);

/* =====================================================
   VERIFY PAYSTACK PAYMENT
   POST /api/orders/paystack/verify
===================================================== */

router.post(
  "/paystack/verify",
  requireAuth,
  async (req, res) => {
    const client = await db.connect();
    let transactionStarted = false;

    try {
      const { reference } = req.body;

      if (!reference) {
        return res.status(400).json({
          error: "Payment reference is required.",
        });
      }

      const payment = await paystackRequest(
        `/transaction/verify/${encodeURIComponent(reference)}`,
        { method: "GET" }
      );

      const transaction = payment.data;

      if (
        transaction.status !== "success" ||
        transaction.currency !== "NGN"
      ) {
        return res.status(400).json({
          error: "Payment was not successful.",
        });
      }

      const orderId = Number(transaction.metadata?.order_id);

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({
          error: "Invalid order reference.",
        });
      }

      await client.query("BEGIN");
      transactionStarted = true;

      const orderResult = await client.query(
        `
        SELECT id, user_id, total_kobo, currency, status
        FROM orders
        WHERE id = $1
        FOR UPDATE
        `,
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error("Order does not exist.");
      }

      const order = orderResult.rows[0];

      if (Number(order.user_id) !== Number(req.user.id)) {
        throw new Error("You cannot verify this order.");
      }

      if (order.currency !== "NGN") {
        throw new Error("This order does not use NGN.");
      }

      if (Number(transaction.amount) !== Number(order.total_kobo)) {
        throw new Error("Payment amount does not match the order total.");
      }

      if (
        Number(transaction.metadata?.user_id) !==
        Number(order.user_id)
      ) {
        throw new Error("Payment customer does not match the order.");
      }

      // Idempotency: a repeated verification must not reset
      // a previously paid order's library records.
      if (order.status === "paid") {
        await client.query("COMMIT");
        transactionStarted = false;

        return res.json({
          ok: true,
          order_id: Number(orderId),
          status: "paid",
          message: "This order has already been verified.",
        });
      }

      if (order.status !== "pending") {
        throw new Error("This order cannot be marked as paid.");
      }

      const itemsResult = await client.query(
        `
        SELECT
          oi.book_id,
          oi.quantity,
          b.title,
          b.file_key,
          b.is_published
        FROM order_items oi
        INNER JOIN books b ON b.id = oi.book_id
        WHERE oi.order_id = $1
        `,
        [orderId]
      );

      if (itemsResult.rows.length === 0) {
        throw new Error("This order has no books.");
      }

      for (const item of itemsResult.rows) {
        if (!item.is_published) {
          throw new Error(
            `Book is no longer available: ${item.title}`
          );
        }

        await ensureBookFileExists(item);
      }

      for (const item of itemsResult.rows) {
        await client.query(
          `
          INSERT INTO library (
            user_id,
            book_id,
            order_id,
            purchased_at,
            downloaded_at
          )
          VALUES ($1, $2, $3, NOW(), NULL)
          ON CONFLICT (user_id, book_id)
          DO UPDATE SET
            order_id = EXCLUDED.order_id,
            purchased_at = EXCLUDED.purchased_at,
            downloaded_at = NULL
          `,
          [order.user_id, item.book_id, orderId]
        );
      }

      await client.query(
        `
        UPDATE orders
        SET status = 'paid', payment_reference = $1
        WHERE id = $2
        `,
        [reference, orderId]
      );

      await client.query("COMMIT");
      transactionStarted = false;

      res.json({
        ok: true,
        order_id: Number(orderId),
        status: "paid",
        message: "Payment verified and books are now available for download.",
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Rollback error:", rollbackError);
        }
      }

      console.error("Paystack verification error:", error);

      res.status(400).json({
        error: error.message || "Payment verification failed.",
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
