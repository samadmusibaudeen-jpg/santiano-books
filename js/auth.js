
/* =====================================================
   SANTIANO BOOKS — AUTH.JS
===================================================== */


/* =====================================================
   API CONFIGURATION
===================================================== */

window.SANTIANO_API =
    window.SANTIANO_API ||
    "https://santiano-books.onrender.com/api";


function authApiUrl(path = "") {
    return `${window.SANTIANO_API.replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}


/* =====================================================
   AUTH STORAGE KEYS
===================================================== */

const AUTH_TOKEN_KEY = "santianoToken";
const AUTH_USER_KEY = "santianoUser";
const LOGIN_RETURN_KEY = "santianoLoginReturn";


/* =====================================================
   AUTH STORAGE
===================================================== */

function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
}


function getCurrentUser() {
    try {
        return JSON.parse(
            localStorage.getItem(AUTH_USER_KEY) || "null"
        );
    } catch {
        return null;
    }
}


function isAuthenticated() {
    return Boolean(getAuthToken());
}


/* =====================================================
   AUTH HEADERS
===================================================== */

function getAuthHeaders(extraHeaders = {}) {
    const token = getAuthToken();

    if (!token) {
        return { ...extraHeaders };
    }

    return {
        ...extraHeaders,
        Authorization: `Bearer ${token}`
    };
}


/* =====================================================
   SAVE AUTH DATA
===================================================== */

function saveAuth(data) {
    if (data.token) {
        localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    }

    if (data.user) {
        localStorage.setItem(
            AUTH_USER_KEY,
            JSON.stringify(data.user)
        );
    }
}


/* =====================================================
   SHARED API RESPONSE HANDLER
===================================================== */

async function readAuthResponse(response) {
    let data = {};

    try {
        data = await response.json();
    } catch {
        data = {};
    }

    if (!response.ok) {
        throw new Error(
            data.error ||
            data.message ||
            "Something went wrong. Please try again."
        );
    }

    return data;
}


/* =====================================================
   LOGIN
===================================================== */

async function loginUser(email, password) {
    const response = await fetch(
        authApiUrl("auth/login"),
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email,
                password
            })
        }
    );

    const data = await readAuthResponse(response);

    if (!data.token) {
        throw new Error(
            "Login succeeded, but no authentication token was returned."
        );
    }

    saveAuth(data);

    return data;
}


/* =====================================================
   REGISTER
===================================================== */

async function registerUser(name, email, password) {
    const response = await fetch(
        authApiUrl("auth/register"),
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name,
                email,
                password
            })
        }
    );

    const data = await readAuthResponse(response);

    if (data.token) {
        saveAuth(data);
    }

    return data;
}


/* =====================================================
   FORGOT PASSWORD
===================================================== */

async function requestPasswordReset(email) {
    if (typeof email !== "string" || !email.trim()) {
        throw new Error("Please enter your email address.");
    }

    const response = await fetch(
        authApiUrl("auth/forgot-password"),
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email: email.trim()
            })
        }
    );

    return await readAuthResponse(response);
}


/* =====================================================
   RESET PASSWORD
===================================================== */

async function resetUserPassword(token, password) {
    if (!token) {
        throw new Error(
            "Your reset link is missing its token. Please request a new link."
        );
    }

    if (typeof password !== "string" || password.length < 8) {
        throw new Error(
            "Password must be at least 8 characters."
        );
    }

    const response = await fetch(
        authApiUrl("auth/reset-password"),
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                token,
                password
            })
        }
    );

    return await readAuthResponse(response);
}


/* =====================================================
   REQUIRE LOGIN
===================================================== */

function requireLogin() {
    if (isAuthenticated()) {
        return true;
    }

    const page =
        location.pathname.split("/").pop() ||
        "index.html";

    const returnUrl =
        page + location.search + location.hash;

    const publicPages = [
        "",
        "index.html",
        "login.html",
        "register.html",
        "forgot-password.html",
        "reset-password.html"
    ];

    if (!publicPages.includes(page)) {
        localStorage.setItem(
            LOGIN_RETURN_KEY,
            returnUrl
        );
    }

    location.href = "login.html";

    return false;
}


/* =====================================================
   HANDLE LOGIN REDIRECT
===================================================== */

function handleLoginReturn() {
    const returnUrl = localStorage.getItem(LOGIN_RETURN_KEY);

    localStorage.removeItem(LOGIN_RETURN_KEY);

    if (
        returnUrl &&
        returnUrl !== "index.html" &&
        returnUrl !== "login.html" &&
        returnUrl !== "register.html" &&
        returnUrl !== "forgot-password.html" &&
        returnUrl !== "reset-password.html"
    ) {
        location.href = returnUrl;
        return;
    }

    location.href = "home.html";
}


/* =====================================================
   LOGOUT
===================================================== */

function logout() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(LOGIN_RETURN_KEY);
    localStorage.removeItem("santianoPendingOrder");
    localStorage.removeItem("santianoCheckoutReturn");
    localStorage.removeItem("santianoRepurchaseOriginalCart");
    localStorage.removeItem("santianoRepurchase");

    location.href = "index.html";
}


/* =====================================================
   USER NAME
===================================================== */

function getUserName() {
    const user = getCurrentUser();

    if (!user) {
        return "Reader";
    }

    return (
        user.name ||
        user.full_name ||
        user.fullName ||
        "Reader"
    );
}


/* =====================================================
   DISPLAY USER NAME
===================================================== */

function updateUserName() {
    const name = getUserName();

    document
        .querySelectorAll("[data-user-name]")
        .forEach(element => {
            element.textContent = name;
        });
}


/* =====================================================
   AUTH NAVIGATION
===================================================== */

function updateAuthNavigation() {
    const loggedIn = isAuthenticated();

    document
        .querySelectorAll("[data-auth-guest]")
        .forEach(element => {
            element.style.display = loggedIn ? "none" : "";
        });

    document
        .querySelectorAll("[data-auth-user]")
        .forEach(element => {
            element.style.display = loggedIn ? "" : "none";
        });
}


/* =====================================================
   REDIRECT AUTHENTICATED USERS
===================================================== */

function redirectAuthenticatedUser() {
    const page = location.pathname.split("/").pop();

    if (
        isAuthenticated() &&
        (
            page === "login.html" ||
            page === "register.html"
        )
    ) {
        location.href = "home.html";
    }
}


/* =====================================================
   LOGIN FORM
===================================================== */

function setupLoginForm() {
    const form = document.getElementById("loginForm");

    if (!form) return;

    const emailInput = document.getElementById("loginEmail");
    const passwordInput = document.getElementById("loginPassword");
    const loginButton = document.getElementById("loginButton");
    const message = document.getElementById("loginMessage");

    form.addEventListener("submit", async event => {
        event.preventDefault();

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            message.textContent =
                "Please enter your email and password.";
            return;
        }

        loginButton.disabled = true;
        loginButton.textContent = "LOGGING IN...";
        message.textContent = "";

        try {
            await loginUser(email, password);

            message.textContent =
                "Login successful. Redirecting...";

            setTimeout(handleLoginReturn, 400);
        } catch (error) {
            console.error("Santiano login error:", error);

            message.textContent =
                error.message || "Unable to login.";

            loginButton.disabled = false;
            loginButton.textContent = "LOGIN";
        }
    });
}


/* =====================================================
   REGISTER FORM
===================================================== */

function setupRegisterForm() {
    const form = document.getElementById("registerForm");

    if (!form) return;

    const nameInput = document.getElementById("registerName");
    const emailInput = document.getElementById("registerEmail");
    const passwordInput = document.getElementById("registerPassword");
    const confirmInput = document.getElementById("registerConfirm");
    const registerButton = document.getElementById("registerButton");
    const message = document.getElementById("registerMessage");

    form.addEventListener("submit", async event => {
        event.preventDefault();

        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const confirmPassword = confirmInput.value;

        if (!name) {
            message.textContent = "Please enter your full name.";
            return;
        }

        if (!email) {
            message.textContent = "Please enter your email address.";
            return;
        }

        if (password.length < 8) {
            message.textContent =
                "Password must be at least 8 characters.";
            return;
        }

        if (password !== confirmPassword) {
            message.textContent = "Passwords do not match.";
            return;
        }

        registerButton.disabled = true;
        registerButton.textContent = "CREATING ACCOUNT...";
        message.textContent = "";

        try {
            const data = await registerUser(
                name,
                email,
                password
            );

            if (data.token) {
                message.textContent =
                    "Account created successfully. Welcome to Santiano Books!";

                setTimeout(() => {
                    location.href = "home.html";
                }, 500);

                return;
            }

            message.textContent =
                "Account created successfully. Redirecting to login...";

            setTimeout(() => {
                location.href = "login.html";
            }, 700);
        } catch (error) {
            console.error(
                "Santiano registration error:",
                error
            );

            message.textContent =
                error.message ||
                "Unable to create your account.";

            registerButton.disabled = false;
            registerButton.textContent = "CREATE ACCOUNT";
        }
    });
}


/* =====================================================
   START AUTH SYSTEM
===================================================== */

document.addEventListener("DOMContentLoaded", () => {
    redirectAuthenticatedUser();
    setupLoginForm();
    setupRegisterForm();
    updateAuthNavigation();
    updateUserName();
});
