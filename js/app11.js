/* =====================================================
   SANTIANO BOOKS — APP.JS
===================================================== */


/* =========================
   API CONFIGURATION
========================= */

window.SANTIANO_API =
  window.SANTIANO_API ||
  "https://santiano-books.onrender.com/api";


function apiUrl(path = "") {
  return `${window.SANTIANO_API}/${String(path).replace(/^\/+/, "")}`;
}


/* =========================
   APPLICATION STATE
========================= */

let books = [];

let activeCategory = "All";

let searchTerm = "";


/* =========================
   SUPABASE COVER STORAGE
========================= */

const SUPABASE_COVERS =
  "https://zzgjyznobxsfktcaaple.supabase.co/storage/v1/object/public/covers";


/* =========================
   MONEY — NGN / KOBO
========================= */

function money(kobo) {

  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(
    Number(kobo || 0) / 100
  );

}


/* =========================
   COVER URL
========================= */

function coverUrl(coverKey) {

  if (!coverKey) {
    return "";
  }

  let cleanKey =
    String(coverKey).trim();


  /* Already a complete URL */

  if (
    /^https?:\/\//i.test(
      cleanKey
    )
  ) {
    return cleanKey;
  }


  /*
    Database keys may look like:

    covers/example.jpg

    ebooks/example.pdf

    uploads/covers/example.jpg

    api/files/covers/example.jpg
  */

  cleanKey =
    cleanKey
      .replace(/^\/+/, "")
      .replace(
        /^api\/+files\/covers\//i,
        ""
      )
      .replace(
        /^api\/+files\//i,
        ""
      )
      .replace(
        /^uploads\/covers\//i,
        ""
      )
      .replace(
        /^covers\//i,
        ""
      )
      .replace(
        /\\/g,
        "/"
      );


  return `${SUPABASE_COVERS}/${cleanKey
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

}


/* =========================
   AUTHENTICATION
========================= */

function getAuthToken() {

  return localStorage.getItem(
    "santianoToken"
  );

}


function getCurrentUser() {

  try {

    return JSON.parse(
      localStorage.getItem(
        "santianoUser"
      ) || "null"
    );

  } catch {

    return null;

  }

}


function isLoggedIn() {

  return Boolean(
    getAuthToken()
  );

}


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
    "santianoCheckoutReturn"
  );

  localStorage.removeItem(
    "santianoRepurchaseOriginalCart"
  );

  localStorage.removeItem(
    "santianoRepurchase"
  );


  window.location.href =
    "index.html";

}


/* =========================
   USER-SPECIFIC CART
========================= */

function getCartKey() {

  const user =
    getCurrentUser();


  if (
    user &&
    user.id
  ) {

    return `santianoCart_${user.id}`;

  }


  return "santianoCart_guest";

}


function getCart() {

  try {

    const cart =
      JSON.parse(
        localStorage.getItem(
          getCartKey()
        ) || "[]"
      );


    return Array.isArray(cart)
      ? cart
      : [];

  } catch {

    return [];

  }

}


function setCart(cart) {

  localStorage.setItem(
    getCartKey(),
    JSON.stringify(cart)
  );

}


/* =========================
   CART COUNT
========================= */

function updateCartCount() {

  const count =
    getCart().reduce(
      (total, item) =>
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
    .forEach(element => {

      element.textContent =
        count;

    });

}


/* =========================
   ADD TO CART
========================= */

function addToCart(id) {

  const book =
    books.find(
      item =>
        Number(item.id) ===
        Number(id)
    );


  if (!book) {

    console.error(
      "Book not found:",
      id
    );

    return;
  }


  const cart =
    getCart();


  const existingItem =
    cart.find(
      item =>
        Number(item.id) ===
        Number(id)
    );


  if (existingItem) {

    existingItem.qty =
      Number(
        existingItem.qty || 1
      ) + 1;

  } else {

    cart.push({

      id:
        Number(book.id),

      title:
        book.title,

      author:
        book.author,

      description:
        book.description,

      category:
        book.category,

      price_kobo:
        Number(
          book.price_kobo ??
          book.price_cents ??
          0
        ),

      cover_key:
        book.cover_key,

      qty: 1

    });

  }


  setCart(cart);

  updateCartCount();


  alert(
    `${book.title} added to cart.`
  );

}


/* =========================
   REMOVE FROM CART
========================= */

function removeFromCart(id) {

  const updatedCart =
    getCart().filter(
      item =>
        Number(item.id) !==
        Number(id)
    );


  setCart(updatedCart);

  updateCartCount();

  renderCart();

}


/* =========================
   NORMAL CHECKOUT
========================= */

async function startCheckout() {

  const cart =
    getCart();


  if (!cart.length) {

    alert(
      "Your cart is empty."
    );

    return;
  }


  const token =
    getAuthToken();


  if (!token) {

    localStorage.setItem(
      "santianoCheckoutReturn",
      "cart.html"
    );


    window.location.href =
      "login.html";

    return;
  }


  const items =
    cart.map(item => ({

      book_id:
        Number(item.id),

      quantity:
        Number(
          item.qty || 1
        )

    }));


  try {

    const response =
      await fetch(
        apiUrl(
          "orders/draft"
        ),
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
              items
            })
        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data.error ||
        "Unable to create order."
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


    const pendingOrder = {

      ...data.order,

      id:
        orderId,

      total_kobo:
        Number(
          data.order.total_kobo ??
          data.order.total_cents ??
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


    window.location.href =
      "checkout.html";


  } catch (error) {

    console.error(
      "Santiano checkout error:",
      error
    );


    alert(
      error.message ||
      "Unable to start checkout."
    );

  }

}


/* =========================
   REPURCHASE BOOK
========================= */

async function repurchaseBook(bookId) {

  const token =
    getAuthToken();


  if (!token) {

    localStorage.setItem(
      "santianoCheckoutReturn",
      "library.html"
    );


    window.location.href =
      "login.html";

    return;
  }


  const numericBookId =
    Number(bookId);


  if (
    !Number.isInteger(
      numericBookId
    ) ||
    numericBookId <= 0
  ) {

    alert(
      "Invalid book."
    );

    return;
  }


  try {

    /* Find book */

    const book =
      books.find(
        item =>
          Number(item.id) ===
          numericBookId
      );


    let bookData =
      book;


    if (!bookData) {

      const bookResponse =
        await fetch(
          apiUrl(
            `books/${numericBookId}`
          )
        );


      const responseData =
        await bookResponse.json();


      if (!bookResponse.ok) {

        throw new Error(
          responseData.error ||
          "Unable to find this book."
        );

      }


      bookData =
        responseData.book;

    }


    if (!bookData) {

      throw new Error(
        "Book information was not found."
      );

    }


    /* Create new order */

    const response =
      await fetch(
        apiUrl(
          "orders/draft"
        ),
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
                    numericBookId,

                  quantity: 1

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
        "Unable to create repurchase order."
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


    /* Save original cart */

    const originalCart =
      getCart();


    localStorage.setItem(
      "santianoRepurchaseOriginalCart",
      JSON.stringify(
        originalCart
      )
    );


    /* Temporary checkout cart */

    setCart([

      {

        id:
          numericBookId,

        title:
          bookData.title,

        author:
          bookData.author,

        description:
          bookData.description,

        category:
          bookData.category,

        price_kobo:
          Number(
            bookData.price_kobo ??
            bookData.price_cents ??
            0
          ),

        cover_key:
          bookData.cover_key,

        qty: 1

      }

    ]);


    /* Save pending order */

    const pendingOrder = {

      ...data.order,

      id:
        orderId,

      total_kobo:
        Number(
          data.order.total_kobo ??
          data.order.total_cents ??
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


    /* Tell checkout.js this is a repurchase */

    localStorage.setItem(
      "santianoRepurchase",
      "1"
    );


    window.location.href =
      "checkout.html";


  } catch (error) {

    console.error(
      "Santiano repurchase error:",
      error
    );


    alert(
      error.message ||
      "Unable to continue with payment."
    );

  }

}


/* =========================
   BOOK CARD
========================= */

function bookCard(book) {

  const cover =
    coverUrl(
      book.cover_key
    );


  const price =
    Number(
      book.price_kobo ??
      book.price_cents ??
      0
    );


  return `

    <article class="book-card">


      <div class="cover">

        ${
          cover

            ? `

              <img

                src="${escapeHtml(cover)}"

                alt="${escapeHtml(book.title)} cover"

                style="
                  width: 100%;
                  height: 100%;
                  object-fit: cover;
                  border-radius: inherit;
                  display: block;
                "

                onerror="
                  this.style.display='none';
                "

              >

            `

            : `

              <h3>
                ${escapeHtml(
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
        ${escapeHtml(
          book.title
        )}
      </h3>


      <div class="category">

        ${escapeHtml(
          book.category ||
          "General"
        )}

      </div>


      <div class="price">

        ${money(price)}

      </div>


      <div class="book-actions">


        <button
          type="button"
          onclick="
            location.href='book.html?id=${Number(book.id)}'
          "
        >
          VIEW
        </button>


        <button
          type="button"
          onclick="
            addToCart(${Number(book.id)})
          "
        >
          ADD
        </button>


      </div>


    </article>

  `;

}


/* =========================
   LOAD BOOKS
========================= */

async function loadBooks() {

  const grid =
    document.querySelector(
      "[data-books-grid]"
    );


  try {

    const response =
      await fetch(
        apiUrl("books")
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data.error ||
        "Unable to load books."
      );

    }


    books =
      Array.isArray(
        data.books
      )
        ? data.books
        : [];


    /*
     * Build categories from
     * the books returned by
     * the backend before rendering
     * the book grid.
     */

    renderCategories();

    renderBooks();

    renderBook();


  } catch (error) {

    console.error(
      "Santiano Books API error:",
      error
    );


    const categories =
      document.getElementById(
        "categoriesList"
      );


    if (categories) {

      categories.innerHTML =
        `
          <div
            class="categories-empty"
          >
            Unable to load categories.
          </div>
        `;

    }


    if (grid) {

      grid.innerHTML = `

        <p class="muted">
          Unable to load books right now.
        </p>

      `;

    }

  }

}


/* =====================================================
   DYNAMIC CATEGORIES
===================================================== */

function renderCategories() {

  const container =
    document.getElementById(
      "categoriesList"
    );


  if (!container) {
    return;
  }


  /*
   * Use a Map so categories such as:
   *
   * Philosophy
   * philosophy
   * PHILOSOPHY
   *
   * are treated as the same category.
   *
   * We preserve the first version
   * entered by the admin.
   */

  const uniqueCategories =
    new Map();


  books.forEach(
    book => {

      const rawCategory =
        String(
          book.category || ""
        )
          .trim()
          .replace(
            /\s+/g,
            " "
          );


      if (!rawCategory) {
        return;
      }


      const categoryKey =
        rawCategory.toLowerCase();


      if (
        !uniqueCategories.has(
          categoryKey
        )
      ) {

        uniqueCategories.set(
          categoryKey,
          rawCategory
        );

      }

    }
  );


  /*
   * Sort categories alphabetically.
   */

  const categories = [

    "All",

    ...Array.from(
      uniqueCategories.values()
    ).sort(
      (a, b) =>
        a.localeCompare(
          b,
          undefined,
          {
            sensitivity:
              "base"
          }
        )
    )

  ];


  /*
   * If the currently selected
   * category no longer exists,
   * return to All.
   */

  if (
    activeCategory !==
    "All"
  ) {

    const categoryStillExists =
      categories.some(
        category =>
          category.toLowerCase() ===
          activeCategory
            .trim()
            .toLowerCase()
      );


    if (
      !categoryStillExists
    ) {

      activeCategory =
        "All";

    }

  }


  container.innerHTML =
    categories
      .map(
        category => {

          const isActive =
            category.toLowerCase() ===
            activeCategory
              .trim()
              .toLowerCase();


          const label =
            category === "All"
              ? "All Books"
              : category;


          return `

            <a

              href="#"

              data-category="${escapeHtml(
                category
              )}"

              class="${
                isActive
                  ? "active"
                  : ""
              }"

            >

              ${escapeHtml(
                label
              )}

            </a>

          `;

        }
      )
      .join("");


  /*
   * The links were just created
   * with innerHTML, so they need
   * their click handlers.
   */

  setupCategories();

}


/* =========================
   FILTER AND SEARCH BOOKS
========================= */

function filterBooks(category) {

  activeCategory =
    category || "All";


  const grid =
    document.querySelector(
      "[data-books-grid]"
    );


  const resultCount =
    document.querySelector(
      "[data-books-result-count]"
    );


  if (!grid) {
    return;
  }


  const normalizedSearch =
    searchTerm
      .trim()
      .toLowerCase();


  const filteredBooks =
    books.filter(
      book => {


        const matchesCategory =

          activeCategory ===
          "All"

            ? true

            : String(
                book.category ||
                ""
              )
                .trim()
                .toLowerCase() ===
              activeCategory
                .trim()
                .toLowerCase();


        const searchableText = [

          book.title,

          book.author,

          book.category,

          book.description

        ]

          .filter(Boolean)

          .join(" ")

          .toLowerCase();


        const matchesSearch =

          !normalizedSearch ||

          searchableText.includes(
            normalizedSearch
          );


        return (
          matchesCategory &&
          matchesSearch
        );

      }
    );


  if (resultCount) {

    resultCount.textContent =

      `${filteredBooks.length} book${
        filteredBooks.length ===
        1
          ? ""
          : "s"
      } found`;

  }


  if (
    !filteredBooks.length
  ) {

    grid.innerHTML = `

      <div
        class="muted"
        style="
          padding: 30px 0;
        "
      >

        <h3>
          No books found
        </h3>

        <p>
          Try another search term
          or choose a different
          category.
        </p>

      </div>

    `;

    return;
  }


  grid.innerHTML =
    filteredBooks
      .map(bookCard)
      .join("");

}


/* =========================
   CATEGORY BUTTONS
========================= */

function setupCategories() {

  const categoryLinks =
    document.querySelectorAll(
      "[data-category]"
    );


  categoryLinks.forEach(
    link => {

      /*
       * Prevent attaching the
       * same listener twice to
       * the same element.
       */

      if (
        link.dataset.categoryBound ===
        "true"
      ) {
        return;
      }


      link.dataset.categoryBound =
        "true";


      link.addEventListener(
        "click",
        event => {

          event.preventDefault();


          const category =
            link.dataset.category;


          /*
           * Update active state
           * on all current links.
           */

          document
            .querySelectorAll(
              "[data-category]"
            )
            .forEach(
              item =>
                item.classList.remove(
                  "active"
                )
            );


          link.classList.add(
            "active"
          );


          /*
           * Update mobile title
           * if the element exists.
           */

          const mobileTitle =
            document.getElementById(
              "booksMobileTitle"
            );


          if (mobileTitle) {

            mobileTitle.textContent =
              category === "All"
                ? "All Books"
                : category;

          }


          filterBooks(
            category
          );

        }
      );

    }
  );

}


/* =========================
   BOOK SEARCH
========================= */

function setupBookSearch() {

  const searchInput =
    document.querySelector(
      "#book-search"
    );


  const clearButton =
    document.querySelector(
      "#clear-search"
    );


  if (!searchInput) {
    return;
  }


  /*
   * Prevent duplicate
   * search listeners.
   */

  if (
    searchInput.dataset.searchBound ===
    "true"
  ) {
    return;
  }


  searchInput.dataset.searchBound =
    "true";


  searchInput.addEventListener(
    "input",
    event => {

      searchTerm =
        event.target.value;


      if (clearButton) {

        clearButton.classList.toggle(
          "visible",
          Boolean(
            searchTerm.trim()
          )
        );

      }


      filterBooks(
        activeCategory
      );

    }
  );


  if (clearButton) {

    clearButton.addEventListener(
      "click",
      () => {

        searchTerm =
          "";


        searchInput.value =
          "";


        clearButton.classList.remove(
          "visible"
        );


        filterBooks(
          activeCategory
        );


        searchInput.focus();

      }
    );

  }

}


/* =========================
   RENDER BOOKS
========================= */

function renderBooks() {

  const grid =
    document.querySelector(
      "[data-books-grid]"
    );


  if (!grid) {
    return;
  }


  filterBooks(
    activeCategory
  );

}


/* =========================
   RENDER CART
========================= */

function renderCart() {

  const box =
    document.querySelector(
      "[data-cart]"
    );


  if (!box) {
    return;
  }


  const cart =
    getCart();


  if (!cart.length) {

    box.innerHTML = `

      <p class="muted">

        Your cart is empty.

        <a
          href="books.html"
          style="
            color: #b8893d;
            font-weight: 700;
          "
        >
          Explore books →
        </a>

      </p>

    `;


    return;
  }


  let total = 0;


  const cartItems =
    cart
      .map(
        item => {

          const quantity =
            Number(
              item.qty || 1
            );


          const price =
            Number(
              item.price_kobo ??
              item.price_cents ??
              0
            );


          total +=
            price *
            quantity;


          const cover =
            coverUrl(
              item.cover_key
            );


          return `

            <div
              class="cart-row"
            >


              <div
                class="mini-cover"
              >

                ${
                  cover

                    ? `

                      <img
                        src="${escapeHtml(
                          cover
                        )}"

                        alt="${escapeHtml(
                          item.title
                        )} cover"

                        style="
                          width: 100%;
                          height: 100%;
                          object-fit: cover;
                          display: block;
                        "
                      >

                    `

                    : escapeHtml(
                        item.title
                      )
                }

              </div>


              <div>

                <b>
                  ${escapeHtml(
                    item.title
                  )}
                </b>


                <div
                  class="muted"
                >

                  ${escapeHtml(
                    item.category ||
                    "General"
                  )}

                </div>

              </div>


              <div>

                ${money(price)}

                ×

                ${quantity}

              </div>


              <button
                type="button"
                onclick="
                  removeFromCart(
                    ${Number(
                      item.id
                    )}
                  )
                "
              >
                Remove
              </button>


            </div>

          `;

        }
      )
      .join("");


  box.innerHTML = `

    ${cartItems}


    <div
      class="cart-total"
    >

      Total:

      <b>
        ${money(total)}
      </b>


      <br>


      <button
        class="gold-btn"
        style="
          margin-top: 15px
        "
        type="button"
        onclick="
          startCheckout()
        "
      >
        Proceed to Checkout
      </button>

    </div>

  `;

}


/* =====================================================
   BOOK DETAIL
===================================================== */

function renderBook() {

  const element =
    document.querySelector(
      "[data-book-detail]"
    );


  if (
    !element ||
    !books.length
  ) {
    return;
  }


  const id =
    Number(
      new URLSearchParams(
        location.search
      ).get("id")
    ) ||
    Number(
      books[0].id
    );


  const book =
    books.find(
      item =>
        Number(item.id) ===
        id
    ) ||
    books[0];


  const cover =
    coverUrl(
      book.cover_key
    );


  const price =
    Number(
      book.price_kobo ??
      book.price_cents ??
      0
    );


  element.innerHTML = `

    <div
      class="book-detail-card"
    >


      <!-- BOOK COVER -->

      <div
        class="book-detail-cover"
      >

        ${
          cover

            ? `

              <img

                src="${escapeHtml(
                  cover
                )}"

                alt="${escapeHtml(
                  book.title
                )} cover"

                onerror="
                  this.style.display='none';
                  this.parentElement.innerHTML='<h3>SANTIANO BOOKS</h3>';
                "

              >

            `

            : `

              <div
                style="
                  width: 100%;
                  height: 100%;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  text-align: center;
                  padding: 20px;
                  box-sizing: border-box;
                "
              >

                <div>

                  <h3>

                    ${escapeHtml(
                      book.title
                    )}

                  </h3>


                  <small>
                    SANTIANO BOOKS
                  </small>

                </div>

              </div>

            `
        }

      </div>


      <!-- BOOK INFORMATION -->

      <div
        class="book-detail-info"
      >

        <div
          class="eyebrow"
        >
          Digital eBook
        </div>


        <h1>

          ${escapeHtml(
            book.title
          )}

        </h1>


        <p
          class="book-detail-author"
        >

          By

          <strong>

            ${escapeHtml(
              book.author ||
              "Santiano Books"
            )}

          </strong>

        </p>


        <div
          class="category"
        >

          ${escapeHtml(
            book.category ||
            "General"
          )}

        </div>


        <div
          class="book-detail-price"
        >

          ${money(price)}

        </div>


        <p
          class="book-detail-description"
        >

          ${escapeHtml(
            book.description ||
            "No description available."
          )}

        </p>


        <ul>

          <li>
            Instant digital access
            after purchase
          </li>

          <li>
            eBook / PDF format
          </li>

          <li>
            Read on phone, tablet
            or computer
          </li>

          <li>
            Personal library access
          </li>

        </ul>


        <div
          class="detail-actions"
        >


          <button
            class="gold-btn book-detail-button"
            type="button"
            onclick="
              addToCart(
                ${Number(
                  book.id
                )}
              );

              location.href='cart.html';
            "
          >
            BUY NOW
          </button>


          <button
            class="outline-btn book-detail-button"
            type="button"
            onclick="
              addToCart(
                ${Number(
                  book.id
                )}
              )
            "
          >
            ADD TO CART
          </button>


        </div>


      </div>


    </div>

  `;

}


/* =========================
   ESCAPE HTML
========================= */

function escapeHtml(value) {

  return String(
    value ?? ""
  ).replace(
    /[&<>"']/g,
    character =>
      ({
        "&":
          "&amp;",

        "<":
          "&lt;",

        ">":
          "&gt;",

        '"':
          "&quot;",

        "'":
          "&#039;"

      })[character]
  );

}


/* =========================
   START APPLICATION
========================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    updateCartCount();

    renderCart();

    setupCategories();

    setupBookSearch();

    loadBooks();

  }
);