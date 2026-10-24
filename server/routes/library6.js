// routes/library.js

const express = require("express");

const router = express.Router();

const requireAuth =
  require("../middleware/auth");

const pool =
  require("../db/pool");

const supabase =
  require("../supabase/client");


/* =====================================================
   GET MY LIBRARY
   GET /api/library
===================================================== */

router.get(
  "/",
  requireAuth,
  async (req, res) => {
    try {

      const result =
        await pool.query(
          `
          SELECT
            books.id,
            books.title,
            books.author,
            books.description,
            books.category,
            books.price_kobo,
            books.cover_key,
            books.file_key,
            books.created_at,

            library.purchased_at,
            library.downloaded_at

          FROM library

          INNER JOIN books
            ON books.id =
              library.book_id

          WHERE
            library.user_id = $1

          ORDER BY
            library.purchased_at DESC
          `,
          [
            req.user.id
          ]
        );


      return res.json({
        books:
          result.rows
      });

    } catch (error) {

      console.error(
        "Library fetch error:",
        error
      );


      return res.status(500).json({
        error:
          "Unable to load your library"
      });

    }
  }
);


/* =====================================================
   DOWNLOAD BOOK
   GET /api/library/:bookId/download
===================================================== */

router.get(
  "/:bookId/download",
  requireAuth,
  async (req, res) => {

    try {

      /* ==============================================
         BOOK ID
      ============================================== */

      const bookId =
        Number(
          req.params.bookId
        );


      if (
        !Number.isInteger(bookId) ||
        bookId <= 0
      ) {

        return res.status(400).json({
          error:
            "Invalid book ID"
        });

      }


      /* ==============================================
         CONFIRM OWNERSHIP
      ============================================== */

      const result =
        await pool.query(
          `
          SELECT
            library.user_id,
            library.book_id,
            library.downloaded_at,

            books.file_key,
            books.title,
            books.author

          FROM library

          INNER JOIN books
            ON books.id =
              library.book_id

          WHERE
            library.user_id = $1

            AND books.id = $2

          LIMIT 1
          `,
          [
            req.user.id,
            bookId
          ]
        );


      /* ==============================================
         USER DOES NOT OWN BOOK
      ============================================== */

      if (
        result.rows.length === 0
      ) {

        return res.status(403).json({
          error:
            "You have not purchased this book."
        });

      }


      const libraryBook =
        result.rows[0];


      const fileKey =
        libraryBook.file_key;


      const title =
        libraryBook.title;


      const author =
        libraryBook.author ||
        "Santiano Books";


      /* ==============================================
         BOOK MUST HAVE PDF
      ============================================== */

      if (!fileKey) {

        return res.status(404).json({
          error:
            "This book has no PDF file."
        });

      }


      /* ==============================================
         TEMPORARY SIGNED URL

         SUPABASE BUCKET:
         ebooks

         BUCKET:
         PRIVATE

         URL LIFETIME:
         1800 SECONDS = 30 MINUTES

         IMPORTANT:
         The PDF itself is NOT downloaded
         through Render.
      ============================================== */

      const expiresIn =
        1800;


      const {
        data,
        error: signedUrlError
      } =
        await supabase.storage
          .from("ebooks")
          .createSignedUrl(
            fileKey,
            expiresIn
          );


      /* ==============================================
         SIGNED URL ERROR
      ============================================== */

      if (
        signedUrlError ||
        !data?.signedUrl
      ) {

        console.error(
          "Supabase signed URL error:",
          signedUrlError
        );


        return res.status(500).json({
          error:
            "Unable to prepare your book for download."
        });

      }


      /* ==============================================
         CALCULATE ABSOLUTE EXPIRATION TIME

         This allows the frontend countdown to
         represent the actual expiration time instead
         of simply starting a fresh 30-minute timer.
      ============================================== */

      const expiresAt =
        Date.now() +
        expiresIn * 1000;


      /* ==============================================
         RECORD DOWNLOAD

         We only record the first download time.
      ============================================== */

      try {

        await pool.query(
          `
          UPDATE library

          SET
            downloaded_at =
              COALESCE(
                downloaded_at,
                NOW()
              )

          WHERE
            user_id = $1

            AND book_id = $2
          `,
          [
            req.user.id,
            bookId
          ]
        );


        console.log(
          `Book download authorized: user=${req.user.id}, book=${bookId}`
        );

      } catch (updateError) {

        console.error(
          "Unable to record book download:",
          updateError
        );

      }


      /* ==============================================
         RETURN TEMPORARY DOWNLOAD INFORMATION

         Render returns ONLY JSON.

         Render does NOT stream the PDF.

         The browser will later download the PDF
         directly from Supabase Storage.
      ============================================== */

      return res.json({

        success:
          true,

        title:
          title,

        author:
          author,

        expires_in:
          expiresIn,

        expires_at:
          expiresAt,

        download_url:
          data.signedUrl

      });

    } catch (error) {

      console.error(
        "Book download error:",
        error
      );


      if (
        !res.headersSent
      ) {

        return res.status(500).json({
          error:
            "Unable to download book."
        });

      }

    }

  }
);


module.exports = router;