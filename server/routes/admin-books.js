
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
    fileSize: 200 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {
    if (
      file.fieldname === "ebook" &&
      file.mimetype !== "application/pdf"
    ) {
      return cb(
        new Error("The eBook must be a PDF.")
      );
    }

    if (
      file.fieldname === "cover" &&
      ![
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/jpg"
      ].includes(file.mimetype)
    ) {
      return cb(
        new Error("Cover must be JPG, PNG or WebP.")
      );
    }

    cb(null, true);
  }
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
        page_count,
        file_key,
        cover_key,
        is_published,
        created_at
      FROM books
      ORDER BY created_at DESC
    `);

    res.json({
      books: result.rows
    });
  } catch (error) {
    next(error);
  }
});

/* =========================
   CREATE BOOK
========================= */

router.post(
  "/books",

  upload.fields([
    {
      name: "ebook",
      maxCount: 1
    },
    {
      name: "cover",
      maxCount: 1
    }
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
        page_count,
        isPublished
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
        page_count === undefined ||
        page_count === "" ||
        !ebook
      ) {
        return res.status(400).json({
          error:
            "Title, description, price, page count and PDF eBook are required."
        });
      }

      /* =========================
         CLEAN INPUTS
      ========================= */

      const cleanTitle = String(title).trim();

      const cleanAuthor = String(
        author || "Musibau Samad Eniola"
      ).trim();

      const cleanDescription = String(
        description
      ).trim();

      const cleanCategory = normalizeCategory(category);

      if (!cleanTitle) {
        return res.status(400).json({
          error: "Book title is required."
        });
      }

      if (!cleanDescription) {
        return res.status(400).json({
          error: "Book description is required."
        });
      }

      /* =========================
         VALIDATE PAGE COUNT
      ========================= */

      const pageCount = Number(page_count);

      if (
        !Number.isSafeInteger(pageCount) ||
        pageCount <= 0
      ) {
        return res.status(400).json({
          error:
            "Page count must be a positive whole number."
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
          error: "Price must be greater than zero."
        });
      }

      if (
        !Number.isSafeInteger(Math.round(priceKobo))
      ) {
        return res.status(400).json({
          error: "The price is invalid."
        });
      }

      /* =========================
         VALIDATE EBOOK
      ========================= */

      if (ebook.mimetype !== "application/pdf") {
        return res.status(400).json({
          error: "The eBook must be a PDF."
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

      // Store the bucket-relative key in the database.
      // The actual file inside the ebooks bucket uses
      // only the filename.

      const ebookKey = `ebooks/${ebookFilename}`;

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
          "webp"
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
      ========================= */

      const ebookUpload = await supabase.storage
        .from("ebooks")
        .upload(
          ebookFilename,
          ebook.buffer,
          {
            contentType: "application/pdf",
            upsert: false
          }
        );

      if (ebookUpload.error) {
        throw new Error(
          `eBook upload failed: ${ebookUpload.error.message}`
        );
      }

      uploadedEbookKey = ebookFilename;

      /* =========================
         UPLOAD COVER
      ========================= */

      if (cover && coverKey && storageCoverKey) {
        const coverUpload = await supabase.storage
          .from("covers")
          .upload(
            storageCoverKey,
            cover.buffer,
            {
              contentType: cover.mimetype,
              upsert: false
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
          page_count,
          file_key,
          cover_key,
          is_published
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10
        )
        RETURNING
          id,
          title,
          author,
          slug,
          description,
          category,
          price_kobo,
          page_count,
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
          pageCount,
          ebookKey,
          coverKey,
          isPublished !== "false"
        ]
      );

      /* =========================
         SUCCESS
      ========================= */

      res.status(201).json({
        message: "Book created successfully.",
        book: result.rows[0]
      });
    } catch (error) {
      console.error("Create book error:", error);

      /* =========================
         CLEANUP EBOOK
      ========================= */

      if (uploadedEbookKey) {
        const { error: cleanupError } =
          await supabase.storage
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
        const { error: cleanupError } =
          await supabase.storage
            .from("covers")
            .remove([uploadedCoverKey]);

        if (cleanupError) {
          console.error(
            "Cover cleanup failed:",
            cleanupError.message
          );
        }
      }

      next(error);
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

      if (
        !Number.isInteger(bookId) ||
        bookId <= 0
      ) {
        return res.status(400).json({
          error: "Invalid book ID."
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
          page_count,
          is_published
        `,
        [bookId]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: "Book not found."
        });
      }

      res.json({
        book: result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   REMOVE BOOK
========================= */

router.delete(
  "/books/:id",
  async (req, res, next) => {
    try {
      const bookId = Number(req.params.id);

      if (
        !Number.isInteger(bookId) ||
        bookId <= 0
      ) {
        return res.status(400).json({
          error: "Invalid book ID."
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
          page_count,
          is_published
        `,
        [bookId]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: "Book not found."
        });
      }

      res.json({
        message: "Book removed from the store.",
        book: result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;