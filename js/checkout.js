// =====================================================
// SANTIANO BOOKS — CHECKOUT.JS
// =====================================================

const CHECKOUT_API =
  window.SANTIANO_API ||
  "https://ent-books.onrender.com/api";

const PAYSTACK_PUBLIC_KEY =
  "pk_live_87c9da8d951f26772deb4bdfa3c3f2d832b9de25";

// =====================================================
// AUTH TOKEN
// =====================================================

function getToken() {
  return localStorage.getItem("santianoToken");
}

// =====================================================
// REPURCHASE CHECK
// =====================================================

function isRepurchase() {
  return localStorage.getItem("santianoRepurchase") === "1";
}

// =====================================================
// GET USER
// =====================================================

function getCheckoutUser() {
  try {
    return JSON.parse(
      localStorage.getItem("santianoUser") || "null"
    );
  } catch (error) {
    console.error("Unable to read user:", error);
    return null;
  }
}

// =====================================================
// GET CART KEY
// =====================================================

function getCheckoutCartKey() {
  const user = getCheckoutUser();

  if (user && user.id) {
    return `santianoCart_${user.id}`;
  }

  return "santianoCart_guest";
}

// =====================================================
// GET PENDING ORDER
// =====================================================

function getPendingOrder() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("santianoPendingOrder") || "null"
    );

    if (!saved) {
      return null;
    }

    return {
      ...saved,
      id: Number(saved.id),
      total_kobo: Number(saved.total_kobo || 0),
      currency: String(
        saved.currency || "NGN"
      ).toUpperCase()
    };
  } catch (error) {
    console.error("Unable to read pending order:", error);
    return null;
  }
}

// =====================================================
// GET CHECKOUT CART
// =====================================================

function getCheckoutCart() {
  try {
    // A repurchase uses its own temporary cart so the real cart is untouched.
    const cartKey = isRepurchase()
      ? "santianoRepurchaseCart"
      : getCheckoutCartKey();

    const cart = JSON.parse(
      localStorage.getItem(cartKey) || "[]"
    );

    return Array.isArray(cart) ? cart : [];
  } catch (error) {
    console.error("Unable to read checkout cart:", error);
    return [];
  }
}

// =====================================================
// FORMAT NGN
// =====================================================

function checkoutMoney(kobo) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(kobo || 0) / 100);
}

// =====================================================
// ESCAPE HTML
// =====================================================

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

// =====================================================
// COVER URL
// =====================================================

function getCoverUrl(coverKey) {
  if (!coverKey) {
    return "";
  }

  let cleanKey = String(coverKey)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  cleanKey = cleanKey
    .replace(/^uploads\/covers\//i, "")
    .replace(/^uploads\//i, "")
    .replace(/^covers\//i, "");

  if (
    cleanKey.startsWith("http://") ||
    cleanKey.startsWith("https://")
  ) {
    return cleanKey;
  }

  return (
    "https://zzgjyznobxsfktcaaple.supabase.co/storage/v1/object/public/covers/" +
    cleanKey
      .split("/")
      .map(encodeURIComponent)
      .join("/")
  );
}

// =====================================================
// CLEAR CHECKOUT
// =====================================================

function clearCheckout() {
  if (isRepurchase()) {
    // A repurchase never touches the real cart.
    localStorage.removeItem("santianoRepurchaseCart");
    localStorage.removeItem("santianoRepurchase");
  } else {
    localStorage.removeItem(getCheckoutCartKey());
  }

  localStorage.removeItem("santianoRepurchaseOriginalCart");
  localStorage.removeItem("santianoPendingOrder");
}

// =====================================================
// RENDER CHECKOUT
// =====================================================

function renderCheckout() {
  const container =
    document.querySelector("[data-checkout]");

  if (!container) {
    console.error("Checkout container not found.");
    return;
  }

  const token = getToken();

  if (!token) {
    window.location.href = "login.html";
    return;
  }

  const order = getPendingOrder();
  const cart = getCheckoutCart();

  console.log("Pending order:", order);
  console.log("Checkout cart:", cart);

  // ===================================================
  // NO ORDER
  // ===================================================

  if (
    !order ||
    !Number.isInteger(order.id) ||
    order.id <= 0
  ) {
    container.innerHTML = `
      <div class="cart-box">
        <h2>No pending order</h2>

        <p class="muted">
          Please return to your cart
          and start checkout again.
        </p>

        <a
          href="cart.html"
          class="gold-btn"
        >
          RETURN TO CART
        </a>
      </div>
    `;

    return;
  }

  // ===================================================
  // CURRENCY
  // ===================================================

  if (order.currency !== "NGN") {
    container.innerHTML = `
      <div class="cart-box">

        <div class="eyebrow">
          ORDER #${escapeHTML(order.id)}
        </div>

        <h2>
          New checkout required
        </h2>

        <p class="muted">
          This order uses
          ${escapeHTML(order.currency)}.
          Santiano Books currently
          uses NGN for payments.
        </p>

        <button
          class="gold-btn"
          id="newOrderButton"
          type="button"
        >
          CREATE NEW ORDER
        </button>

      </div>
    `;

    document
      .getElementById("newOrderButton")
      ?.addEventListener("click", () => {
        clearCheckout();
        window.location.href = "cart.html";
      });

    return;
  }

  // ===================================================
  // CART
  // ===================================================

  if (!cart.length) {
    container.innerHTML = `
      <div class="cart-box">

        <h2>
          Your cart is empty
        </h2>

        <p class="muted">
          We could not find the
          books connected to this order.
        </p>

        <a
          href="cart.html"
          class="gold-btn"
        >
          RETURN TO CART
        </a>

      </div>
    `;

    return;
  }

  // ===================================================
  // ITEMS
  // ===================================================

  const itemsHTML = cart
    .map(item => {
      const quantity =
        Number(item.qty || 1);

      const price =
        Number(item.price_kobo || 0);

      const subtotal =
        price * quantity;

      const cover =
        getCoverUrl(item.cover_key);

      return `
        <article class="checkout-item">

          <div class="checkout-item-cover">

            ${
              cover
                ? `
                  <img
                    src="${escapeHTML(cover)}"
                    alt="${escapeHTML(item.title)} cover"
                    onerror="this.style.display='none';"
                  >
                `
                : `
                  <span>
                    ${escapeHTML(item.title)}
                  </span>
                `
            }

          </div>

          <div class="checkout-item-info">

            <h3>
              ${escapeHTML(item.title)}
            </h3>

            <p class="muted">
              By
              ${escapeHTML(
                item.author ||
                "Santiano Books"
              )}
            </p>

            <p class="muted">
              Quantity:
              ${quantity}
            </p>

          </div>

          <strong class="checkout-item-price">
            ${checkoutMoney(subtotal)}
          </strong>

        </article>
      `;
    })
    .join("");

  const totalKobo =
    Number(order.total_kobo || 0);

  // ===================================================
  // CHECKOUT UI
  // ===================================================

  container.innerHTML = `
    <section class="cart-box checkout-box">

      <div class="eyebrow">
        ORDER #${escapeHTML(order.id)}
      </div>

      ${
        isRepurchase()
          ? `
            <div
              class="ownership-status"
              style="margin-bottom:10px"
            >
              ✓ ALREADY OWNED
            </div>
          `
          : ""
      }

      <h2>
        Your Order
      </h2>

      <div class="checkout-items">
        ${itemsHTML}
      </div>

      <div class="cart-total checkout-total">

        <span>
          Total
        </span>

        <strong>
          ${checkoutMoney(totalKobo)}
        </strong>

      </div>

      <div class="checkout-payment">

        <h3>
          Payment
        </h3>

        <p class="muted">
          Pay securely with Paystack.
        </p>

        ${
          isRepurchase()
            ? `
              <p class="muted">
                You already own this book.
                This payment creates a new
                purchase and makes the book
                available for download again.
              </p>
            `
            : ""
        }

        <button
          class="gold-btn"
          id="payButton"
          type="button"
        >
          PAY
          ${checkoutMoney(totalKobo)}
        </button>

        <p
          id="checkoutMessage"
          class="muted"
        ></p>

      </div>

    </section>
  `;

  document
    .getElementById("payButton")
    ?.addEventListener(
      "click",
      beginPayment
    );
}

// =====================================================
// INITIALIZE PAYMENT
// =====================================================

async function beginPayment() {
  // If a payment went through but confirming it failed,
  // this click just tries to confirm it again.
  if (window.santianoRetryReference) {
    verifyPayment(
      window.santianoRetryReference
    );
    return;
  }

  const message =
    document.getElementById(
      "checkoutMessage"
    );

  const button =
    document.getElementById(
      "payButton"
    );

  const order =
    getPendingOrder();

  const token =
    getToken();

  if (!message || !button) {
    return;
  }

  if (
    !order ||
    !Number.isInteger(order.id) ||
    order.id <= 0
  ) {
    message.textContent =
      "Your pending order is invalid. Please return to your cart.";
    return;
  }

  if (!token) {
    window.location.href =
      "login.html";
    return;
  }

  button.disabled = true;
  button.textContent =
    "PREPARING PAYMENT...";

  message.textContent =
    "Checking your order...";

  try {
    // =================================================
    // CHECK PUBLIC KEY
    // =================================================

    if (
      !PAYSTACK_PUBLIC_KEY ||
      (
        !PAYSTACK_PUBLIC_KEY.startsWith("pk_test_") &&
        !PAYSTACK_PUBLIC_KEY.startsWith("pk_live_")
      )
    ) {
      throw new Error(
        "Paystack public key is not configured correctly."
      );
    }

    // =================================================
    // INITIALIZE PAYMENT
    // =================================================

    const response =
      await fetch(
        `${CHECKOUT_API}/orders/paystack/initialize`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${token}`
          },

          body: JSON.stringify({
            order_id: order.id
          })
        }
      );

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error(
        "The payment server returned an invalid response."
      );
    }

    console.log(
      "Paystack initialize response:",
      data
    );

    if (!response.ok) {
      throw new Error(
        data.error ||
        "Unable to initialize payment."
      );
    }

    if (!data.access_code) {
      throw new Error(
        "Paystack did not return an access code."
      );
    }

    // =================================================
    // PAYSTACK SCRIPT CHECK
    // =================================================

    if (
      typeof PaystackPop ===
      "undefined"
    ) {
      throw new Error(
        "Paystack script was not loaded. Check checkout.html."
      );
    }

    message.textContent =
      "Opening secure payment window...";

    // =================================================
    // OPEN PAYSTACK
    // =================================================

    const popup =
      new PaystackPop();

    window.santianoPaystackReference =
      data.reference;

    window.santianoPaystackOrderId =
      order.id;

    button.textContent =
      "WAITING FOR PAYMENT...";

    button.disabled = true;

    popup.resumeTransaction(
      data.access_code,
      {
        // Payment finished: confirm it automatically
        onSuccess: () => {
          verifyPayment(
            data.reference
          );
        },

        // Customer closed the window without paying
        onCancel: () => {
          message.textContent =
            "Payment was not completed. You can try again.";

          button.disabled = false;

          button.textContent =
            `PAY ${checkoutMoney(
              order.total_kobo
            )}`;
        },

        onError: (error) => {
          console.error(
            "Paystack error:",
            error
          );

          message.textContent =
            (error && error.message) ||
            "Payment could not be completed. Please try again.";

          button.disabled = false;

          button.textContent =
            `PAY ${checkoutMoney(
              order.total_kobo
            )}`;
        }
      }
    );

  } catch (error) {
    console.error(
      "Payment initialization error:",
      error
    );

    message.textContent =
      error.message ||
      "Unable to initialize payment.";

    button.disabled = false;

    button.textContent =
      `PAY ${checkoutMoney(
        order.total_kobo
      )}`;
  }
}

// =====================================================
// VERIFY PAYMENT
// =====================================================

async function verifyPayment(reference) {
  const message =
    document.getElementById(
      "checkoutMessage"
    );

  const button =
    document.getElementById(
      "payButton"
    );

  const token =
    getToken();

  if (!message || !button) {
    return;
  }

  if (!reference) {
    message.textContent =
      "No payment reference was found.";
    return;
  }

  if (!token) {
    window.location.href =
      "login.html";
    return;
  }

  button.disabled = true;
  button.textContent =
    "VERIFYING...";

  message.textContent =
    "Verifying your payment...";

  try {
    let response;
    let data;

    // Paystack can take a moment to mark the payment as
    // successful, so try a few times before giving up.
    for (let attempt = 1; attempt <= 4; attempt++) {
      response =
        await fetch(
          `${CHECKOUT_API}/orders/paystack/verify`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${token}`
            },

            body: JSON.stringify({
              reference
            })
          }
        );

      try {
        data = await response.json();
      } catch {
        throw new Error(
          "The payment server returned an invalid response."
        );
      }

      if (
        response.ok ||
        attempt === 4 ||
        response.status !== 400
      ) {
        break;
      }

      await new Promise(resolve =>
        setTimeout(resolve, 2000)
      );
    }

    console.log(
      "Payment verification response:",
      data
    );

    if (!response.ok) {
      throw new Error(
        data.error ||
        "Payment verification failed."
      );
    }

    window.santianoRetryReference = null;

    message.textContent =
      "Payment successful. Your book is now available to download.";

    button.textContent =
      "PAYMENT SUCCESSFUL";

    button.disabled = true;

    clearCheckout();

    setTimeout(() => {
      window.location.href =
        "library.html";
    }, 1500);

  } catch (error) {
    console.error(
      "Payment verification error:",
      error
    );

    window.santianoRetryReference = reference;

    message.textContent =
      (error.message ||
      "We could not confirm your payment.") +
      " If money was taken, tap the button to check again.";

    button.disabled = false;

    button.textContent =
      "CHECK PAYMENT AGAIN";
  }
}

// =====================================================
// START
// =====================================================

document.addEventListener(
  "DOMContentLoaded",
  () => {
    renderCheckout();
  }
);