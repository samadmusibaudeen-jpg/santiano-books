/* =====================================================
   SANTIANO BOOKS — LIBRARY.JS
===================================================== */

const API =
  window.SANTIANO_API ||
  "https://santiano-books.onrender.com/api";


const SUPABASE_COVERS_URL =
  "https://zzgjyznobxsfktcaaple.supabase.co/storage/v1/object/public/covers";


/* =====================================================
   AUTH TOKEN
===================================================== */

function getAuthToken() {
  return localStorage.getItem("santianoToken");
}


/* =====================================================
   USER
===================================================== */

function getUser() {
  try {
    return JSON.parse(
      localStorage.getItem("santianoUser") || "null"
    );
  } catch {
    return null;
  }
}


/* =====================================================
   CART KEY
===================================================== */

function getCartKey() {
  const user = getUser();

  if (user && user.id) {
    return `santianoCart_${user.id}`;
  }

  return "santianoCart_guest";
}


/* =====================================================
   COVER URL
===================================================== */

function coverUrl(coverKey) {
  if (!coverKey) {
    return "";
  }

  let cleanKey =
    String(coverKey).trim();

  if (
    cleanKey.startsWith("http://") ||
    cleanKey.startsWith("https://")
  ) {
    return cleanKey;
  }

  cleanKey =
    cleanKey
      .replace(
        /^uploads[\\/]+covers[\\/]+/i,
        ""
      )
      .replace(
        /^covers[\\/]+/i,
        ""
      )
      .replace(
        /[\\/]+/g,
        "/"
      );

  return `${SUPABASE_COVERS_URL}/${cleanKey
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}


/* =====================================================
   HTML SECURITY
===================================================== */

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    character =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[character]
  );
}


/* =====================================================
   DATE
===================================================== */

function formatDate(date) {
  if (!date) {
    return "";
  }

  const parsed =
    new Date(date);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return "";
  }

  return parsed.toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "short",
      day: "numeric"
    }
  );
}


/* =====================================================
   LOGIN REDIRECT
===================================================== */

function redirectToLogin() {
  localStorage.setItem(
    "santianoLibraryReturn",
    "library.html"
  );

  window.location.href =
    "login.html";
}


/* =====================================================
   DOWNLOAD BOOK
   SERVER ONLY AUTHORIZES THE REQUEST.

   SUPABASE PROVIDES THE ACTUAL TEMPORARY
   SIGNED DOWNLOAD URL.

   RENDER DOES NOT STREAM THE PDF.
===================================================== */

async function downloadBook(
  bookId,
  bookTitle,
  bookAuthor = "Santiano Books"
) {

  const token =
    getAuthToken();

  if (!token) {
    redirectToLogin();
    return;
  }


  const button =
    document.querySelector(
      `[data-download-book="${bookId}"]`
    );


  const originalText =
    button
      ? button.textContent
      : "DOWNLOAD";


  try {

    /* ---------------------------------------------
       BUTTON STATE
    --------------------------------------------- */

    if (button) {
      button.disabled = true;
      button.textContent =
        "PREPARING...";
    }


    /* ---------------------------------------------
       ASK BACKEND FOR TEMPORARY SUPABASE URL

       IMPORTANT:
       Only a small authorization request
       goes through Render.

       The ebook itself does NOT go through Render.
    --------------------------------------------- */

    const response =
      await fetch(
        `${API}/library/${encodeURIComponent(bookId)}/download`,
        {
          method: "GET",

          headers: {
            Authorization:
              `Bearer ${token}`
          }
        }
      );


    /* ---------------------------------------------
       AUTHENTICATION ERROR
    --------------------------------------------- */

    if (
      response.status === 401
    ) {

      localStorage.removeItem(
        "santianoToken"
      );

      localStorage.removeItem(
        "santianoUser"
      );

      redirectToLogin();

      return;
    }


    /* ---------------------------------------------
       READ SERVER RESPONSE
    --------------------------------------------- */

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";


    let data = {};


    if (
      contentType.includes(
        "application/json"
      )
    ) {

      data =
        await response
          .json()
          .catch(
            () => ({})
          );

    }


    /* ---------------------------------------------
       SERVER ERROR
    --------------------------------------------- */

    if (!response.ok) {

      throw new Error(
        data.error ||
        "Unable to prepare this book for download."
      );

    }


    /* ---------------------------------------------
       CHECK SIGNED URL
    --------------------------------------------- */

    if (
      !data.download_url
    ) {

      throw new Error(
        "The server did not provide a temporary download link."
      );

    }


    /* ---------------------------------------------
       GET SUPABASE SIGNED URL
    --------------------------------------------- */

    const temporaryUrl =
      String(
        data.download_url
      );


    /* ---------------------------------------------
       GET EXPIRATION TIME

       Backend currently returns:

       expires_in: 300

       = 5 minutes
    --------------------------------------------- */

    const expiresIn =
      Number(
        data.expires_in
      ) || 300;


    /* ---------------------------------------------
       CREATE TEMPORARY DOWNLOAD PAGE

       The Supabase signed URL is passed to
       download.html.

       The actual PDF is still hosted by Supabase.
    --------------------------------------------- */

    const temporaryPage =
      new URL(
        "download.html",
        window.location.href
      );


    temporaryPage.searchParams.set(
      "url",
      temporaryUrl
    );


    temporaryPage.searchParams.set(
      "title",
      data.title ||
      bookTitle ||
      "Santiano Book"
    );


    temporaryPage.searchParams.set(
      "author",
      data.author ||
      bookAuthor ||
      "Santiano Books"
    );


    temporaryPage.searchParams.set(
  "expires_at",
  String(
    data.expires_at
  )
    );


    /* ---------------------------------------------
       OPEN TEMPORARY DOWNLOAD PAGE
    --------------------------------------------- */

    window.open(
      temporaryPage.href,
      "_blank"
    );


    /* ---------------------------------------------
       UPDATE LIBRARY BUTTON
    --------------------------------------------- */

    if (button) {

      button.textContent =
        "DOWNLOAD AGAIN";

      button.dataset.downloaded =
        "true";

    }


    /* ---------------------------------------------
       LOG EXPIRATION
    --------------------------------------------- */

    console.log(
      `Santiano Books: Supabase temporary download URL created. Expires in ${expiresIn} seconds.`
    );


  } catch (error) {

    console.error(
      "Santiano download error:",
      error
    );


    showToast(
      error.message ||
      "Unable to download this book."
    );


  } finally {

    if (button) {

      button.disabled =
        false;


      if (
        button.textContent ===
        "PREPARING..."
      ) {

        button.textContent =
          originalText;

      }

    }

  }
}


/* =====================================================
   TOAST MESSAGE
===================================================== */

let toastTimer = null;


function showToast(message) {

  let toast =
    document.getElementById(
      "santianoToast"
    );


  if (!toast) {

    toast =
      document.createElement("div");

    toast.id =
      "santianoToast";

    toast.setAttribute(
      "role",
      "status"
    );

    toast.setAttribute(
      "aria-live",
      "polite"
    );

    toast.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: 28px;
      transform: translate(-50%, 20px);
      max-width: min(90vw, 420px);
      padding: 12px 20px;
      border: 2px solid #1b1813;
      border-radius: 99px;
      background: #1f4d3a;
      color: #fffdf8;
      font-size: 14px;
      font-weight: 700;
      text-align: center;
      box-shadow: 4px 4px 0 #1b1813;
      opacity: 0;
      pointer-events: none;
      transition: opacity .25s, transform .25s;
      z-index: 9999;
    `;

    document.body.appendChild(toast);

  }


  toast.textContent =
    message;


  requestAnimationFrame(() => {

    toast.style.opacity = "1";

    toast.style.transform =
      "translate(-50%, 0)";

  });


  clearTimeout(toastTimer);

  toastTimer =
    setTimeout(() => {

      toast.style.opacity = "0";

      toast.style.transform =
        "translate(-50%, 20px)";

    }, 3500);

}


/* =====================================================
   REPURCHASE
   No browser popup. The checkout page already tells
   the user they own this book and they must still
   press PAY, so nothing is charged by accident.
===================================================== */

function confirmRepurchase(
  bookId,
  bookTitle,
  bookData
) {

  startRepurchase(
    bookId,
    bookTitle,
    bookData
  );
}


/* =====================================================
   START REPURCHASE
===================================================== */

async function startRepurchase(
  bookId,
  bookTitle,
  bookData
) {

  const token =
    getAuthToken();


  if (!token) {
    redirectToLogin();
    return;
  }


  const button =
    document.querySelector(
      `[data-download-book="${bookId}"]`
    );


  try {

    if (button) {

      button.disabled =
        true;

      button.textContent =
        "PREPARING PAYMENT...";

    }


    const response =
      await fetch(
        `${API}/orders/draft`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${token}`
          },

          body:
            JSON.stringify({
              items: [
                {
                  book_id:
                    Number(bookId),

                  quantity:
                    1
                }
              ]
            })
        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data.error ||
        "Unable to create your new order."
      );

    }


    if (!data.order) {

      throw new Error(
        "The server did not return an order."
      );

    }


    const orderId =
      Number(
        data.order.id
      );


    if (
      !Number.isInteger(
        orderId
      ) ||
      orderId <= 0
    ) {

      throw new Error(
        "The server returned an invalid order ID."
      );

    }


    /* ---------------------------------------------
       TEMPORARY REPURCHASE CART
       Stored separately: the real cart is never touched.
    --------------------------------------------- */

    const temporaryCart = [

      {
        id:
          Number(bookId),

        title:
          bookTitle,

        author:
          bookData.author ||
          "Santiano Books",

        description:
          bookData.description ||
          "",

        category:
          bookData.category ||
          "General",

        price_kobo:
          Number(
            bookData.price_kobo ||
            0
          ),

        cover_key:
          bookData.cover_key ||
          "",

        qty:
          1
      }

    ];


    localStorage.setItem(
      "santianoRepurchaseCart",

      JSON.stringify(
        temporaryCart
      )
    );


    /* ---------------------------------------------
       PENDING ORDER
    --------------------------------------------- */

    const pendingOrder = {

      ...data.order,

      id:
        orderId,

      total_kobo:
        Number(
          data.order.total_kobo ||
          0
        ),

      currency:
        String(
          data.order.currency ||
          "NGN"
        ).toUpperCase()

    };


    localStorage.setItem(
      "santianoPendingOrder",

      JSON.stringify(
        pendingOrder
      )
    );


    /* ---------------------------------------------
       REPURCHASE FLAG
    --------------------------------------------- */

    localStorage.setItem(
      "santianoRepurchase",
      "1"
    );


    /* ---------------------------------------------
       GO TO CHECKOUT
    --------------------------------------------- */

    window.location.href =
      "checkout.html";


  } catch (error) {

    console.error(
      "Santiano repurchase error:",
      error
    );


    showToast(
      error.message ||
      "Unable to continue with payment."
    );


    if (button) {

      button.disabled =
        false;

      button.textContent =
        "DOWNLOAD AGAIN";

    }

  }
}


/* =====================================================
   LIBRARY ACTION
===================================================== */

function handleLibraryAction(
  bookId,
  bookTitle,
  hasDownloaded,
  bookData
) {

  if (hasDownloaded) {

    confirmRepurchase(
      bookId,
      bookTitle,
      bookData
    );

    return;
  }


  downloadBook(
    bookId,
    bookTitle,
    bookData.author ||
      "Santiano Books"
  );
}


/* =====================================================
   BOOK CARD
===================================================== */

function libraryBookCard(
  book
) {

  const cover =
    coverUrl(
      book.cover_key
    );


  const hasDownloaded =
    Boolean(
      book.downloaded_at
    );


  const buttonText =
    hasDownloaded
      ? "DOWNLOAD AGAIN"
      : "DOWNLOAD";


  const bookData =
    encodeURIComponent(
      JSON.stringify({

        author:
          book.author ||
          "",

        description:
          book.description ||
          "",

        category:
          book.category ||
          "General",

        price_kobo:
          Number(
            book.price_kobo ||
            0
          ),

        cover_key:
          book.cover_key ||
          ""

      })
    );


  const safeTitle =
    escapeHTML(
      book.title
    ).replace(
      /'/g,
      "\\'"
    );


  return `
    <article class="book-card">

      <div class="cover">

        ${
          cover

            ? `
              <img
                src="${escapeHTML(cover)}"
                alt="${escapeHTML(
                  book.title
                )} cover"

                style="
                  width:100%;
                  height:100%;
                  object-fit:cover;
                  border-radius:inherit;
                  display:block;
                "

                onerror="
                  this.style.display='none';
                "
              >
            `

            : `
              <h3>
                ${escapeHTML(
                  book.title
                )}
              </h3>

              <small>
                SANTIANO BOOKS
              </small>
            `
        }

      </div>


      <h3>
        ${escapeHTML(
          book.title
        )}
      </h3>


      <div class="category">
        ${escapeHTML(
          book.category ||
          "General"
        )}
      </div>


      <div class="library-date muted">

        Purchased:

        ${formatDate(
          book.purchased_at
        )}

      </div>


      <div class="ownership-status">
        ✓ OWNED
      </div>


      <div class="book-actions">

        <button
          type="button"

          data-download-book="${Number(
            book.id
          )}"

          data-downloaded="${
            hasDownloaded
              ? "true"
              : "false"
          }"

          onclick="
            handleLibraryAction(
              ${Number(book.id)},

              '${safeTitle}',

              ${hasDownloaded},

              JSON.parse(
                decodeURIComponent(
                  '${bookData}'
                )
              )
            )
          "
        >

          ${buttonText}

        </button>

      </div>

    </article>
  `;
}


/* =====================================================
   LOAD LIBRARY
===================================================== */

async function loadLibrary() {

  const message =
    document.querySelector(
      "[data-library-message]"
    );


  const grid =
    document.querySelector(
      "[data-library-grid]"
    );


  if (
    !message ||
    !grid
  ) {
    return;
  }


  const token =
    getAuthToken();


  if (!token) {

    redirectToLogin();

    return;

  }


  message.textContent =
    "Loading your library...";


  try {

    const response =
      await fetch(
        `${API}/library`,
        {
          method: "GET",

          headers: {
            Authorization:
              `Bearer ${token}`
          }
        }
      );


    const data =
      await response.json();


    /* ---------------------------------------------
       AUTH ERROR
    --------------------------------------------- */

    if (
      response.status === 401 ||
      response.status === 403
    ) {

      localStorage.removeItem(
        "santianoToken"
      );

      localStorage.removeItem(
        "santianoUser"
      );

      redirectToLogin();

      return;

    }


    /* ---------------------------------------------
       SERVER ERROR
    --------------------------------------------- */

    if (!response.ok) {

      throw new Error(
        data.error ||
        "Unable to load your library."
      );

    }


    /* ---------------------------------------------
       LIBRARY BOOKS
    --------------------------------------------- */

    const libraryBooks =
      Array.isArray(
        data.books
      )
        ? data.books
        : [];


    /* ---------------------------------------------
       EMPTY LIBRARY
    --------------------------------------------- */

    if (
      libraryBooks.length === 0
    ) {

      message.innerHTML = `
        You haven't purchased any books yet.

        <a
          href="books.html"

          style="
            color:#b8893d;
            font-weight:700;
          "
        >
          Explore books →
        </a>
      `;


      grid.innerHTML =
        "";

      return;

    }


    /* ---------------------------------------------
       LIBRARY COUNT
    --------------------------------------------- */

    message.textContent =
      `${libraryBooks.length} book${
        libraryBooks.length === 1
          ? ""
          : "s"
      } in your library.`;


    /* ---------------------------------------------
       RENDER BOOKS
    --------------------------------------------- */

    grid.innerHTML =
      libraryBooks
        .map(
          libraryBookCard
        )
        .join("");


  } catch (error) {

    console.error(
      "Santiano Library error:",
      error
    );


    message.textContent =
      error.message ||
      "Unable to load your library.";

  }
}


/* =====================================================
   LOGOUT
===================================================== */

function logout() {

  localStorage.removeItem(
    "santianoToken"
  );

  localStorage.removeItem(
    "santianoUser"
  );

  localStorage.removeItem(
    "santianoPendingOrder"
  );

  localStorage.removeItem(
    "santianoRepurchase"
  );

  localStorage.removeItem(
    "santianoRepurchaseOriginalCart"
  );

  localStorage.removeItem(
    "santianoRepurchaseCart"
  );


  window.location.href =
    "login.html";
}


/* =====================================================
   LOGOUT BUTTON
===================================================== */

function setupLogout() {

  const button =
    document.getElementById(
      "logoutButton"
    );


  if (!button) {
    return;
  }


  button.addEventListener(
    "click",
    logout
  );
}


/* =====================================================
   PAGE START
===================================================== */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    const user =
      getUser();


    const cartKey =
      getCartKey();


    let cart = [];


    try {

      cart =
        JSON.parse(
          localStorage.getItem(
            cartKey
          ) || "[]"
        );


      if (
        !Array.isArray(
          cart
        )
      ) {

        cart = [];

      }

    } catch {

      cart = [];

    }


    /* ---------------------------------------------
       CART COUNT
    --------------------------------------------- */

    const cartCount =
      cart.reduce(
        (
          total,
          item
        ) =>
          total +
          Number(
            item.qty || 0
          ),
        0
      );


    document
      .querySelectorAll(
        "[data-cart-count]"
      )
      .forEach(
        element => {

          element.textContent =
            cartCount;

        }
      );


    /* ---------------------------------------------
       USER NAME
    --------------------------------------------- */

    const nameElement =
      document.querySelector(
        "[data-user-name]"
      );


    if (
      nameElement &&
      user
    ) {

      nameElement.textContent =
        user.full_name ||
        user.name ||
        "Reader";

    }


    /* ---------------------------------------------
       INITIALIZE
    --------------------------------------------- */

    setupLogout();

    loadLibrary();

  }
);