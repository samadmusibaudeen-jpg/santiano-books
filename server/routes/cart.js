const express = require("express");
const router = express.Router();
const db = require("../db/pool");
const requireAuth = require("../middleware/auth");

// GET /api/cart: load the logged-in user's cart
router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT b.id, b.title, b.author, b.description, b.category,
              b.price_kobo, b.cover_key, c.quantity AS qty
       FROM cart_items c
       JOIN books b ON b.id = c.book_id
       WHERE c.user_id = $1 AND b.is_published = true
       ORDER BY c.updated_at DESC`,
      [req.user.id]
    );
    res.json({
      items: result.rows.map(r => ({
        ...r,
        id: Number(r.id),
        price_kobo: Number(r.price_kobo),
        qty: Number(r.qty),
      })),
    });
  } catch (error) {
    console.error("Get cart error:", error);
    res.status(500).json({ error: "Unable to load your cart." });
  }
});

// PUT /api/cart: save the whole cart
router.put("/", requireAuth, async (req, res) => {
  const client = await db.connect();
  try {
    const merged = new Map();
    for (const i of Array.isArray(req.body.items) ? req.body.items : []) {
      const bookId = Number(i.book_id);
      const qty = Math.min(99, Math.max(1, Number(i.quantity) || 1));
      if (Number.isInteger(bookId) && bookId > 0) {
        merged.set(bookId, Math.min(99, (merged.get(bookId) || 0) + qty));
      }
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM cart_items WHERE user_id = $1", [req.user.id]);

    if (merged.size) {
      const ids = [...merged.keys()];
      const qtys = ids.map(id => merged.get(id));
      await client.query(
        `INSERT INTO cart_items (user_id, book_id, quantity)
         SELECT $1, b.id, t.qty
         FROM unnest($2::bigint[], $3::int[]) AS t(book_id, qty)
         JOIN books b ON b.id = t.book_id`,
        [req.user.id, ids, qtys]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Save cart error:", error);
    res.status(500).json({ error: "Unable to save your cart." });
  } finally {
    client.release();
  }
});

module.exports = router;