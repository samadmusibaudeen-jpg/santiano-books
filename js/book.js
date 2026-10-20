const BOOK_API = "https://ent-books.onrender.com/api";

function getBookId() {
  const params = new URLSearchParams(window.location.search);
  return Number(params.get("id"));
}

function formatBookMoney(kobo) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
  }).format(Number(kobo || 0) / 100);
}

function escapeBookHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getBookCover(coverKey) {
  if (!coverKey) return "";

  const cleanKey = String(coverKey)
    .replace(/\\/g, "/")
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  return `${BOOK_API.replace("/api", "")}/api/files/${cleanKey}`;
}

async function loadBookDetails() {
  const container = document.querySelector(
    "[data-book-details]"
  );

  if (!container) return;

  const bookId = getBookId();

  if (!Number.isInteger(bookId) || bookId <= 0) {
    container.innerHTML = `
      <h2>Invalid book</h2>
      <p class="muted">
        The requested book could not be found.
      </p>
      <a href="books.html" class="gold-btn">
        BACK TO BOOKS
      </a>
    `;

    return;
  }

  try {
    const response = await fetch(
      `${BOOK_API}/books/${bookId}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "Unable to load book details."
      );
    }

    const book = data.book || data;

    const price = Number(
      book.price_kobo ?? book.price_cents ?? 0
    );

    const cover = book.cover_key
      ? `
        <img
          src="${escapeBookHTML(
            getBookCover(book.cover_key)
          )}"
          alt="${escapeBookHTML(book.title)} cover"
          style="
            width:100%;
            max-width:320px;
            height:430px;
            object-fit:cover;
            display:block;
          "
        >
      `
      : `
        <div class="mini-cover">
          No cover
        </div>
      `;

    container.innerHTML = `
      <div
        style="
          display:grid;
          grid-template-columns:minmax(250px, 320px) 1fr;
          gap:40px;
          align-items:start;
        "
      >

        <div>
          ${cover}
        </div>

        <div>
          <div class="eyebrow">
            ${escapeBookHTML(book.category || "Santiano Books")}
          </div>

          <h1 class="page-title">
            ${escapeBookHTML(book.title)}
          </h1>

          <p class="muted">
            By ${escapeBookHTML(
              book.author || "Musibau Samad Eniola"
            )}
          </p>

          <h2>
            ${formatBookMoney(price)}
          </h2>

          <p style="line-height:1.8">
            ${escapeBookHTML(
              book.description || "No description available."
            )}
          </p>

          <button
            class="gold-btn"
            type="button"
            id="addBookButton"
          >
            ADD TO CART
          </button>

          <a
            href="books.html"
            class="account-btn"
            style="margin-left:10px"
          >
            BACK TO BOOKS
          </a>
        </div>

      </div>
    `;

    document
      .getElementById("addBookButton")
      ?.addEventListener("click", () => {
        if (typeof addToCart === "function") {
          addToCart(book);
        } else {
          alert("Cart function was not found in app.js");
        }
      });

  } catch (error) {
    console.error("Book details error:", error);

    container.innerHTML = `
      <h2>Unable to load book</h2>
      <p class="muted">
        ${escapeBookHTML(error.message)}
      </p>

      <a href="books.html" class="gold-btn">
        BACK TO BOOKS
      </a>
    `;
  }
}

document.addEventListener(
  "DOMContentLoaded",
  loadBookDetails
);