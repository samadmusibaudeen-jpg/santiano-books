
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");

const pool = require("../db/pool");
const supabase = require("../supabase/client");
const { requireAdmin } = require("../middleware/admin");

const router = express.Router();

/* =========================
   MULTER
========================= */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 200 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    if (
      file.fieldname === "ebook" &&
      file.mimetype !== "application/pdf"
    ) {
      return cb(new Error("The eBook must be a PDF."));
    }

    if (
      file.fieldname === "cover" &&
      !["image/jpeg", "image/png", "image/webp", "image/jpg"].includes(
        file.mimetype
      )
    ) {
      return cb(new Error("Cover must be JPG, PNG or WebP."));
    }

    cb(null, true);
  },
});

/* =========================
   CATEGORY
========================= */

function normalizeCategory(value) {
  const category = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

  return category || "General";
}

/* =========================
   PAGES
========================= */

// Returns { ok: true, value: number | null } or { ok: false }.
// An empty value is allowed and becomes null.
function parsePages(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { ok: true, value: null };
  }

  const pages = Number(value);

  if (!Number.isInteger(pages) || pages < 1 || pages > 100000) {
    return { ok: false };
  }

  return { ok: true, value: pages };
}

/* =========================
   ADMIN AUTH
========================= */

router.use(requireAdmin);

/* =========================
   GET ALL BOOKS
========================= */

router.get("/books", async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        title,
        author,
        slug,
        description,
        category,
        price_kobo,
        pages,
        file_key,
        cover_key,
        is_published,
        created_at
      FROM books
      ORDER BY created_at DESC
    `);

    return res.json({
      books: result.rows,
    });
  } catch (error) {
    return next(error);
  }
});

/* =========================
   CREATE BOOK
========================= */

router.post(
  "/books",
  upload.fields([
    { name: "ebook", maxCount: 1 },
    { name: "cover", maxCount: 1 },
  ]),
  async (req, res, next) => {
    let uploadedEbookKey = null;
    let uploadedCoverKey = null;

    try {
      const {
        title,
        author,
        description,
        category,
        price_kobo,
        pages,
        isPublished,
      } = req.body;

      const ebook = req.files?.ebook?.[0];
      const cover = req.files?.cover?.[0];

      /* =========================
         REQUIRED FIELDS
      ========================= */

      if (
        !title ||
        !description ||
        price_kobo === undefined ||
        price_kobo === "" ||
        !ebook
      ) {
        return res.status(400).json({
          error: "Title, description, price and PDF eBook are required.",
        });
      }

      /* =========================
         CLEAN INPUTS
      ========================= */

      const cleanTitle = String(title).trim();

      const cleanAuthor = String(
        author || "Musibau Samad Eniola"
      ).trim();

      const cleanDescription = String(description).trim();
      const cleanCategory = normalizeCategory(category);

      if (!cleanTitle) {
        return res.status(400).json({
          error: "Book title is required.",
        });
      }

      if (!cleanDescription) {
        return res.status(400).json({
          error: "Book description is required.",
        });
      }

      /* =========================
         VALIDATE PRICE
      ========================= */

      const priceKobo = Number(price_kobo);

      if (
        !Number.isFinite(priceKobo) ||
        priceKobo <= 0
      ) {
        return res.status(400).json({
          error: "Price must be greater than zero.",
        });
      }

      if (!Number.isSafeInteger(Math.round(priceKobo))) {
        return res.status(400).json({
          error: "The price is invalid.",
        });
      }

      /* =========================
         VALIDATE PAGES
      ========================= */

      const parsedPages = parsePages(pages);

      if (!parsedPages.ok) {
        return res.status(400).json({
          error: "Pages must be a whole number greater than zero.",
        });
      }

      /* =========================
         VALIDATE EBOOK
      ========================= */

      if (ebook.mimetype !== "application/pdf") {
        return res.status(400).json({
          error: "The eBook must be a PDF.",
        });
      }

      /* =========================
         SLUG
      ========================= */

      const slug = (
        cleanTitle +
        "-" +
        crypto.randomBytes(4).toString("hex")
      )
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      /* =========================
         STORAGE FILE NAMES
      ========================= */

      const ebookFilename =
        Date.now() +
        "-" +
        crypto.randomBytes(8).toString("hex") +
        ".pdf";

      // Actual path inside the ebooks bucket.
      const ebookStoragePath = `ebooks/${ebookFilename}`;

      // Store the same bucket-relative object path in the database.
      const ebookKey = ebookStoragePath;

      let coverKey = null;
      let storageCoverKey = null;

      if (cover) {
        const originalExtension = cover.originalname
          .split(".")
          .pop()
          .toLowerCase();

        const safeExtension = [
          "jpg",
          "jpeg",
          "png",
          "webp",
        ].includes(originalExtension)
          ? originalExtension
          : "jpg";

        const coverFilename =
          Date.now() +
          "-" +
          crypto.randomBytes(8).toString("hex") +
          "." +
          safeExtension;

        coverKey = `covers/${coverFilename}`;
        storageCoverKey = coverFilename;
      }

      /* =========================
         UPLOAD EBOOK
         Bucket: ebooks
         Folder: ebooks/
      ========================= */

      const ebookUpload = await supabase.storage
        .from("ebooks")
        .upload(
          ebookStoragePath,
          ebook.buffer,
          {
            contentType: "application/pdf",
            upsert: false,
          }
        );

      if (ebookUpload.error) {
        throw new Error(
          `eBook upload failed: ${ebookUpload.error.message}`
        );
      }

      uploadedEbookKey = ebookStoragePath;

      /* =========================
         UPLOAD COVER
         Bucket: covers
      ========================= */

      if (cover && coverKey && storageCoverKey) {
        const coverUpload = await supabase.storage
          .from("covers")
          .upload(
            storageCoverKey,
            cover.buffer,
            {
              contentType: cover.mimetype,
              upsert: false,
            }
          );

        if (coverUpload.error) {
          throw new Error(
            `Cover upload failed: ${coverUpload.error.message}`
          );
        }

        uploadedCoverKey = storageCoverKey;
      }

      /* =========================
         SAVE BOOK TO DATABASE
      ========================= */

      const result = await pool.query(
        `
          INSERT INTO books (
            title,
            author,
            slug,
            description,
            category,
            price_kobo,
            pages,
            file_key,
            cover_key,
            is_published
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
          )
          RETURNING
            id,
            title,
            author,
            slug,
            description,
            category,
            price_kobo,
            pages,
            file_key,
            cover_key,
            is_published,
            created_at
        `,
        [
          cleanTitle,
          cleanAuthor,
          slug,
          cleanDescription,
          cleanCategory,
          Math.round(priceKobo),
          parsedPages.value,
          ebookKey,
          coverKey,
          isPublished !== "false",
        ]
      );

      return res.status(201).json({
        message: "Book created successfully.",
        book: result.rows[0],
      });
    } catch (error) {
      console.error("Create book error:", error);

      /* =========================
         CLEANUP EBOOK
      ========================= */

      if (uploadedEbookKey) {
        const { error: cleanupError } = await supabase.storage
          .from("ebooks")
          .remove([uploadedEbookKey]);

        if (cleanupError) {
          console.error(
            "eBook cleanup failed:",
            cleanupError.message
          );
        }
      }

      /* =========================
         CLEANUP COVER
      ========================= */

      if (uploadedCoverKey) {
        const { error: cleanupError } = await supabase.storage
          .from("covers")
          .remove([uploadedCoverKey]);

        if (cleanupError) {
          console.error(
            "Cover cleanup failed:",
            cleanupError.message
          );
        }
      }

      return next(error);
    }
  }
);

/* =========================
   UPDATE BOOK
   Works for published and unpublished books.
   Does not change is_published or the slug.
   eBook and cover are optional; if sent, they replace the old files.
========================= */

router.put(
  "/books/:id",
  upload.fields([
    { name: "ebook", maxCount: 1 },
    { name: "cover", maxCount: 1 },
  ]),
  async (req, res, next) => {
    let newEbookPath = null;
    let newCoverStorageName = null;

    try {
      const bookId = Number(req.params.id);

      if (!Number.isInteger(bookId) || bookId <= 0) {
        return res.status(400).json({
          error: "Invalid book ID.",
        });
      }

      const existing = await pool.query(
        `SELECT id, file_key, cover_key FROM books WHERE id = $1`,
        [bookId]
      );

      if (!existing.rowCount) {
        return res.status(404).json({
          error: "Book not found.",
        });
      }

      const oldBook = existing.rows[0];

      const {
        title,
        author,
        description,
        category,
        price_kobo,
        pages,
      } = req.body;

      const ebook = req.files?.ebook?.[0];
      const cover = req.files?.cover?.[0];

      /* =========================
         VALIDATE
      ========================= */

      if (
        !title ||
        !description ||
        price_kobo === undefined ||
        price_kobo === ""
      ) {
        return res.status(400).json({
          error: "Title, description and price are required.",
        });
      }

      const cleanTitle = String(title).trim();
      const cleanAuthor = String(author || "Musibau Samad Eniola").trim();
      const cleanDescription = String(description).trim();
      const cleanCategory = normalizeCategory(category);

      if (!cleanTitle) {
        return res.status(400).json({
          error: "Book title is required.",
        });
      }

      if (!cleanDescription) {
        return res.status(400).json({
          error: "Book description is required.",
        });
      }

      const priceKobo = Number(price_kobo);

      if (!Number.isFinite(priceKobo) || priceKobo <= 0) {
        return res.status(400).json({
          error: "Price must be greater than zero.",
        });
      }

      if (!Number.isSafeInteger(Math.round(priceKobo))) {
        return res.status(400).json({
          error: "The price is invalid.",
        });
      }

      const parsedPages = parsePages(pages);

      if (!parsedPages.ok) {
        return res.status(400).json({
          error: "Pages must be a whole number greater than zero.",
        });
      }

      /* =========================
         UPLOAD NEW EBOOK (OPTIONAL)
      ========================= */

      let ebookKey = oldBook.file_key;

      if (ebook) {
        const ebookFilename =
          Date.now() +
          "-" +
          crypto.randomBytes(8).toString("hex") +
          ".pdf";

        const ebookStoragePath = `ebooks/${ebookFilename}`;

        const ebookUpload = await supabase.storage
          .from("ebooks")
          .upload(ebookStoragePath, ebook.buffer, {
            contentType: "application/pdf",
            upsert: false,
          });

        if (ebookUpload.error) {
          throw new Error(
            `eBook upload failed: ${ebookUpload.error.message}`
          );
        }

        newEbookPath = ebookStoragePath;
        ebookKey = ebookStoragePath;
      }

      /* =========================
         UPLOAD NEW COVER (OPTIONAL)
      ========================= */

      let coverKey = oldBook.cover_key;

      if (cover) {
        const originalExtension = cover.originalname
          .split(".")
          .pop()
          .toLowerCase();

        const safeExtension = ["jpg", "jpeg", "png", "webp"].includes(
          originalExtension
        )
          ? originalExtension
          : "jpg";

        const coverFilename =
          Date.now() +
          "-" +
          crypto.randomBytes(8).toString("hex") +
          "." +
          safeExtension;

        const coverUpload = await supabase.storage
          .from("covers")
          .upload(coverFilename, cover.buffer, {
            contentType: cover.mimetype,
            upsert: false,
          });

        if (coverUpload.error) {
          throw new Error(
            `Cover upload failed: ${coverUpload.error.message}`
          );
        }

        newCoverStorageName = coverFilename;
        coverKey = `covers/${coverFilename}`;
      }

      /* =========================
         UPDATE DATABASE
         is_published and slug are left untouched.
         If pages is empty, the existing value is kept.
      ========================= */

      const result = await pool.query(
        `
          UPDATE books
          SET
            title = $1,
            author = $2,
            description = $3,
            category = $4,
            price_kobo = $5,
            pages = COALESCE($6, pages),
            file_key = $7,
            cover_key = $8
          WHERE id = $9
          RETURNING
            id,
            title,
            author,
            slug,
            description,
            category,
            price_kobo,
            pages,
            file_key,
            cover_key,
            is_published,
            created_at
        `,
        [
          cleanTitle,
          cleanAuthor,
          cleanDescription,
          cleanCategory,
          Math.round(priceKobo),
          parsedPages.value,
          ebookKey,
          coverKey,
          bookId,
        ]
      );

      if (!result.rowCount) {
        throw new Error("Book disappeared while updating.");
      }

      /* =========================
         REMOVE REPLACED FILES
         Best effort: a failure here must not fail the update.
      ========================= */

      if (newEbookPath && oldBook.file_key && oldBook.file_key !== newEbookPath) {
        const { error: removeError } = await supabase.storage
          .from("ebooks")
          .remove([oldBook.file_key]);

        if (removeError) {
          console.error("Old eBook removal failed:", removeError.message);
        }
      }

      if (newCoverStorageName && oldBook.cover_key) {
        const oldCoverName = String(oldBook.cover_key).replace(/^covers\//, "");

        const { error: removeError } = await supabase.storage
          .from("covers")
          .remove([oldCoverName]);

        if (removeError) {
          console.error("Old cover removal failed:", removeError.message);
        }
      }

      return res.json({
        message: "Book updated successfully.",
        book: result.rows[0],
      });
    } catch (error) {
      console.error("Update book error:", error);

      /* =========================
         CLEAN UP NEW UPLOADS
         The old files are still referenced by the database.
      ========================= */

      if (newEbookPath) {
        const { error: cleanupError } = await supabase.storage
          .from("ebooks")
          .remove([newEbookPath]);

        if (cleanupError) {
          console.error("eBook cleanup failed:", cleanupError.message);
        }
      }

      if (newCoverStorageName) {
        const { error: cleanupError } = await supabase.storage
          .from("covers")
          .remove([newCoverStorageName]);

        if (cleanupError) {
          console.error("Cover cleanup failed:", cleanupError.message);
        }
      }

      return next(error);
    }
  }
);

/* =========================
   PUBLISH / UNPUBLISH
========================= */

router.patch(
  "/books/:id/publish",
  async (req, res, next) => {
    try {
      const bookId = Number(req.params.id);

      if (!Number.isInteger(bookId) || bookId <= 0) {
        return res.status(400).json({
          error: "Invalid book ID.",
        });
      }

      const result = await pool.query(
        `
          UPDATE books
          SET is_published = NOT is_published
          WHERE id = $1
          RETURNING
            id,
            title,
            category,
            is_published
        `,
        [bookId]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: "Book not found.",
        });
      }

      return res.json({
        book: result.rows[0],
      });
    } catch (error) {
      return next(error);
    }
  }
);

/* =========================
   REMOVE BOOK FROM STORE
========================= */

router.delete(
  "/books/:id",
  async (req, res, next) => {
    try {
      const bookId = Number(req.params.id);

      if (!Number.isInteger(bookId) || bookId <= 0) {
        return res.status(400).json({
          error: "Invalid book ID.",
        });
      }

      const result = await pool.query(
        `
          UPDATE books
          SET is_published = false
          WHERE id = $1
          RETURNING
            id,
            title,
            category,
            is_published
        `,
        [bookId]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: "Book not found.",
        });
      }

      return res.json({
        message: "Book removed from the store.",
        book: result.rows[0],
      });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;