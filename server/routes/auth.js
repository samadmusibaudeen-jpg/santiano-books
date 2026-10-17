
const router = require("express").Router();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Resend } = require("resend");


/* =====================================================
   CREATE JWT TOKEN
===================================================== */

function makeToken(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "7d"
        }
    );
}


/* =====================================================
   REGISTER
===================================================== */

router.post("/register", async (req, res, next) => {
    try {
        const { name, email, password } = req.body || {};

        if (
            typeof name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                error: "Name, email and password are required"
            });
        }

        const cleanName = name.trim();
        const normalizedEmail = email.trim().toLowerCase();

        if (!cleanName || !normalizedEmail || !password) {
            return res.status(400).json({
                error: "Name, email and password are required"
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                error: "Password must be at least 8 characters"
            });
        }

        const db = req.app.locals.db;

        const existing = await db.query(
            `SELECT id FROM users WHERE email = $1`,
            [normalizedEmail]
        );

        if (existing.rowCount > 0) {
            return res.status(409).json({
                error: "An account with that email already exists"
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await db.query(
            `INSERT INTO users
                (full_name, email, password_hash)
             VALUES ($1, $2, $3)
             RETURNING id, full_name, email, role, created_at`,
            [cleanName, normalizedEmail, passwordHash]
        );

        const row = result.rows[0];

        const user = {
            id: row.id,
            name: row.full_name,
            email: row.email,
            role: row.role,
            created_at: row.created_at
        };

        const token = makeToken(user);

        return res.status(201).json({ user, token });
    } catch (error) {
        next(error);
    }
});


/* =====================================================
   LOGIN
===================================================== */

router.post("/login", async (req, res, next) => {
    try {
        const { email, password } = req.body || {};

        if (
            typeof email !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                error: "Email and password are required"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (!normalizedEmail || !password) {
            return res.status(400).json({
                error: "Email and password are required"
            });
        }

        const db = req.app.locals.db;

        const result = await db.query(
            `SELECT
                id,
                full_name,
                email,
                password_hash,
                role,
                created_at
             FROM users
             WHERE email = $1`,
            [normalizedEmail]
        );

        if (result.rowCount === 0) {
            return res.status(401).json({
                error: "Invalid email or password"
            });
        }

        const row = result.rows[0];

        const validPassword = await bcrypt.compare(
            password,
            row.password_hash
        );

        if (!validPassword) {
            return res.status(401).json({
                error: "Invalid email or password"
            });
        }

        const user = {
            id: row.id,
            name: row.full_name,
            email: row.email,
            role: row.role,
            created_at: row.created_at
        };

        const token = makeToken(user);

        return res.json({ user, token });
    } catch (error) {
        next(error);
    }
});


/* =====================================================
   FORGOT PASSWORD
===================================================== */

router.post("/forgot-password", async (req, res, next) => {
    try {
        const { email } = req.body || {};

        if (typeof email !== "string" || !email.trim()) {
            return res.status(400).json({
                error: "Please enter your email address."
            });
        }

        if (
            !process.env.RESEND_API_KEY ||
            !process.env.RESEND_FROM ||
            !process.env.FRONTEND_URL
        ) {
            console.error("Password-reset environment variables are missing.");

            return res.status(503).json({
                error: "Password reset is temporarily unavailable."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const db = req.app.locals.db;

        const result = await db.query(
            `SELECT id, email
             FROM public.users
             WHERE email = $1`,
            [normalizedEmail]
        );

        // Use the same response whether or not an account exists.
        const genericResponse = {
            message: "If an account exists for that email, a reset link will be sent."
        };

        if (result.rowCount === 0) {
            return res.json(genericResponse);
        }

        const user = result.rows[0];

        // Generate a cryptographically secure token.
        const rawToken = crypto.randomBytes(32).toString("hex");

        // Store only its hash in PostgreSQL.
        const tokenHash = crypto
            .createHash("sha256")
            .update(rawToken)
            .digest("hex");

        const frontendUrl = process.env.FRONTEND_URL.replace(/\/+$/, "");

        const resetUrl =
            `${frontendUrl}/reset-password.html?token=${rawToken}`;

        const resend = new Resend(process.env.RESEND_API_KEY);

        // Insert a new token, then email it.
        // If email delivery fails, remove this token.
        await db.query(
            `DELETE FROM public.password_reset_tokens
             WHERE user_id = $1
               AND used_at IS NULL`,
            [user.id]
        );

        await db.query(
            `INSERT INTO public.password_reset_tokens
                (user_id, token_hash, expires_at)
             VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
            [user.id, tokenHash]
        );

        const { error } = await resend.emails.send({
            from: process.env.RESEND_FROM,
            to: [user.email],
            subject: "Reset your ENT Books password",
            html: `
                <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;line-height:1.6">
                    <h2>Reset your password</h2>
                    <p>We received a request to reset your ENT Books password.</p>
                    <p>
                        <a href="${resetUrl}"
                           style="display:inline-block;padding:12px 20px;background:#c49a45;color:#111;text-decoration:none;border-radius:5px">
                            Reset Password
                        </a>
                    </p>
                    <p>This link expires in 30 minutes and can only be used once.</p>
                    <p>If you did not request this, you can ignore this email.</p>
                    <p>ENT Books</p>
                </div>
            `
        });

        if (error) {
            await db.query(
                `DELETE FROM public.password_reset_tokens
                 WHERE token_hash = $1`,
                [tokenHash]
            );

            console.error("Resend email error:", error);

            return res.status(503).json({
                error: "We couldn't send the reset email right now. Please try again later."
            });
        }

        return res.json(genericResponse);
    } catch (error) {
        next(error);
    }
});


/* =====================================================
   RESET PASSWORD
===================================================== */

router.post("/reset-password", async (req, res, next) => {
    let client;

    try {
        const { token, password } = req.body || {};

        if (
            typeof token !== "string" ||
            !/^[a-f0-9]{64}$/i.test(token) ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                error: "Please provide a valid reset link and new password."
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                error: "Password must be at least 8 characters."
            });
        }

        const tokenHash = crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");

        const db = req.app.locals.db;

        // Use a transaction so token consumption and password update
        // happen together.
        client = await db.connect();

        await client.query("BEGIN");

        const result = await client.query(
            `SELECT id, user_id
             FROM public.password_reset_tokens
             WHERE token_hash = $1
               AND used_at IS NULL
               AND expires_at > NOW()
             FOR UPDATE`,
            [tokenHash]
        );

        if (result.rowCount === 0) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                error: "This reset link is invalid or has expired. Please request a new one."
            });
        }

        const resetToken = result.rows[0];

        const passwordHash = await bcrypt.hash(password, 12);

        const updateResult = await client.query(
            `UPDATE public.users
             SET password_hash = $1
             WHERE id = $2`,
            [passwordHash, resetToken.user_id]
        );

        if (updateResult.rowCount !== 1) {
            throw new Error("The account for this reset token could not be found.");
        }

        await client.query(
            `UPDATE public.password_reset_tokens
             SET used_at = NOW()
             WHERE user_id = $1
               AND used_at IS NULL`,
            [resetToken.user_id]
        );

        await client.query("COMMIT");

        return res.json({
            message: "Your password has been reset. You can now log in with your new password."
        });
    } catch (error) {
        if (client) {
            await client.query("ROLLBACK").catch(() => {});
        }

        next(error);
    } finally {
        if (client) {
            client.release();
        }
    }
});


/* =====================================================
   EXPORT ROUTER
===================================================== */

module.exports = router;
