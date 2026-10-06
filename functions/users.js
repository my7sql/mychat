// functions/users.js - axtres User Auth, Directory & Admin Management

const ADMIN_PIN = "527";

const NO_CACHE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: NO_CACHE_HEADERS });
}

function validPhone(phone) {
  return /^\d{10}$/.test(String(phone || "").trim());
}

function validAdminPin(pin) {
  return String(pin || "") === ADMIN_PIN;
}

const VALID_THEMES = new Set([
  "emerald",
  "midnight",
  "ocean",
  "graphite",
  "royal",
  "ivory"
]);

const VALID_CHAT_BACKGROUNDS = new Set([
  "classic", "mint", "sky", "sand", "rose", "lavender",
  "slate", "cream", "deep-emerald", "navy", "pearl", "teal"
]);

async function ensureSettingsTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `).run();
}

async function sendResendEmail(apiKey, recipientEmail, subject, bodyHtml) {
  if (!apiKey || !recipientEmail) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "axtres Messenger <onboarding@resend.dev>",
        to: [recipientEmail],
        subject,
        html: bodyHtml
      })
    });
  } catch (err) {
    console.error("Resend send error:", err);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: NO_CACHE_HEADERS });
  }

  try {
    // Public app theme default. Admin controls the saved default;
    // users may still override it locally from their own Settings.
    if (request.method === "GET" && url.searchParams.get("action") === "theme") {
      await ensureSettingsTable(env.DB);
      const row = await env.DB.prepare(
        `SELECT key, value FROM app_settings WHERE key IN ('default_theme','default_chat_background')`
      ).all();
      const settings = Object.fromEntries((row.results || []).map(item => [item.key, item.value]));
      return json({
        theme: VALID_THEMES.has(settings.default_theme) ? settings.default_theme : "emerald",
        chat_background: VALID_CHAT_BACKGROUNDS.has(settings.default_chat_background) ? settings.default_chat_background : "classic"
      });
    }

    // Public directory/contact list used by the normal app.
    if (request.method === "GET") {
      const myPhone = url.searchParams.get("phone");
      if (!myPhone) return json({ error: "Phone number required" }, 400);

      const { results } = await env.DB.prepare(
        `SELECT name, phone,
          CASE WHEN email IS NOT NULL AND email != '' AND email_verified = 1 THEN 1 ELSE 0 END AS has_email
         FROM users
         WHERE phone != ?
         ORDER BY name COLLATE NOCASE ASC, phone ASC`
      ).bind(myPhone).all();

      return json(results || []);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const action = url.searchParams.get("action");
    const body = await request.json();

    // ADMIN DEFAULT THEME
    if (action === "admin-theme") {
      if (!validAdminPin(body.pin)) {
        return json({ error: "Wrong PIN" }, 401);
      }

      const theme = String(body.theme || "").trim();
      if (!VALID_THEMES.has(theme)) {
        return json({ error: "Invalid theme" }, 400);
      }

      await ensureSettingsTable(env.DB);
      await env.DB.prepare(`
        INSERT INTO app_settings (key, value)
        VALUES ('default_theme', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).bind(theme).run();

      return json({ success: true, theme });
    }

    // ADMIN GLOBAL CHAT BACKGROUND
    if (action === "admin-chat-background") {
      if (!validAdminPin(body.pin)) return json({ error: "Wrong PIN" }, 401);

      const background = String(body.background || "").trim();
      if (!VALID_CHAT_BACKGROUNDS.has(background)) {
        return json({ error: "Invalid chat background" }, 400);
      }

      await ensureSettingsTable(env.DB);
      await env.DB.prepare(`
        INSERT INTO app_settings (key, value)
        VALUES ('default_chat_background', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).bind(background).run();

      return json({ success: true, chat_background: background });
    }

    // ADMIN: verify PIN and return every registered user.
    if (action === "admin-list") {
      if (!validAdminPin(body.pin)) return json({ error: "Wrong PIN" }, 401);

      const { results } = await env.DB.prepare(
        `SELECT phone, name, email, email_verified
         FROM users
         ORDER BY name COLLATE NOCASE ASC, phone ASC`
      ).all();

      return json({ success: true, users: results || [] });
    }

    // ADMIN: add a new user or update an existing user.
    // Admin-created/edited users are immediately email-verified and do not receive a verification PIN.
    if (action === "admin-save") {
      if (!validAdminPin(body.pin)) return json({ error: "Wrong PIN" }, 401);

      const originalPhone = String(body.original_phone || "").trim();
      const name = String(body.name || "").trim();
      const phone = String(body.phone || "").trim();
      const email = String(body.email || "").trim();

      if (!name || !validPhone(phone)) {
        return json({ error: "Name and valid 10-digit phone are required" }, 400);
      }

      if (originalPhone) {
        const existingTarget = await env.DB.prepare("SELECT phone FROM users WHERE phone = ?").bind(phone).first();
        if (phone !== originalPhone && existingTarget) {
          return json({ error: "That phone number is already registered" }, 409);
        }

        const existingSource = await env.DB.prepare("SELECT phone FROM users WHERE phone = ?").bind(originalPhone).first();
        if (!existingSource) {
          return json({ error: "Original user not found" }, 404);
        }

        await env.DB.prepare(
          `UPDATE users
           SET phone = ?, name = ?, email = ?, email_verified = 1, pin = NULL
           WHERE phone = ?`
        ).bind(phone, name, email, originalPhone).run();

        return json({ success: true, updated: true, user: { phone, name, email, email_verified: 1 } });
      }

      const existing = await env.DB.prepare("SELECT phone FROM users WHERE phone = ?").bind(phone).first();
      if (existing) return json({ error: "That phone number is already registered" }, 409);

      await env.DB.prepare(
        `INSERT INTO users (phone, name, email, email_verified, device_id, pin)
         VALUES (?, ?, ?, 1, '', NULL)`
      ).bind(phone, name, email).run();

      return json({ success: true, created: true, user: { phone, name, email, email_verified: 1 } });
    }

    // 1. REGISTER
    if (action === "register") {
      const { name, phone, email, device_id } = body;
      if (!name || !validPhone(phone)) {
        return json({ error: "Valid name and 10-digit phone required" }, 400);
      }

      const requires_verification = email && email.length > 0 ? 1 : 0;
      const pin = requires_verification ? Math.floor(100 + Math.random() * 900).toString() : null;

      await env.DB.prepare(
        `INSERT INTO users (phone, name, email, email_verified, device_id, pin)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(phone) DO UPDATE SET
           name=?, email=?, email_verified=?, device_id=?, pin=?`
      ).bind(
        phone, name, email || "", requires_verification ? 0 : 1, device_id || "", pin,
        name, email || "", requires_verification ? 0 : 1, device_id || "", pin
      ).run();

      if (requires_verification && email && env.RESEND_API_KEY) {
        await sendResendEmail(
          env.RESEND_API_KEY,
          email,
          "Your axtres Verification Code",
          `<p>Hello <strong>${name}</strong>,</p><p>Your verification code for axtres messenger is: <strong style="font-size:1.4rem;">${pin}</strong></p>`
        );
      }

      return json({ success: true, requires_verification: !!requires_verification, pin_sent: pin });
    }

    // 2. VERIFY REGISTER PIN
    if (action === "verify-register") {
      const { phone, pin } = body;
      const user = await env.DB.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).first();

      if (!user || String(user.pin) !== String(pin)) {
        return json({ error: "Invalid verification PIN" }, 400);
      }

      await env.DB.prepare("UPDATE users SET email_verified = 1, pin = NULL WHERE phone = ?").bind(phone).run();
      return json({ success: true });
    }

    // 3. LOGIN
    if (action === "login") {
      const { phone } = body;
      const user = await env.DB.prepare("SELECT phone, name, email FROM users WHERE phone = ?").bind(phone).first();

      if (!user) {
        return json({ error: "User not found. Please register first." }, 404);
      }

      return json({ success: true, user });
    }

    // 4. UPDATE EMAIL INITIALIZATION
    if (action === "update-email-init") {
      const { phone, email } = body;
      const pin = Math.floor(100 + Math.random() * 900).toString();

      const user = await env.DB.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).first();
      if (!user) return json({ error: "Phone number not registered" }, 404);

      await env.DB.prepare("UPDATE users SET email = ?, email_verified = 0, pin = ? WHERE phone = ?").bind(email, pin, phone).run();

      if (email && env.RESEND_API_KEY) {
        await sendResendEmail(
          env.RESEND_API_KEY,
          email,
          "Verify New Email - axtres",
          `<p>Your email update verification code for axtres is: <strong style="font-size:1.4rem;">${pin}</strong></p>`
        );
      }

      return json({ success: true, pin_sent: pin });
    }

    // 5. VERIFY EMAIL UPDATE PIN
    if (action === "verify-email-update") {
      const { phone, pin } = body;
      const user = await env.DB.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).first();

      if (!user || String(user.pin) !== String(pin)) {
        return json({ error: "Invalid PIN" }, 400);
      }

      await env.DB.prepare("UPDATE users SET email_verified = 1, pin = NULL WHERE phone = ?").bind(phone).run();
      return json({ success: true });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (err) {
    console.error("users.js error:", err);
    return json({ error: err.message || "Server error" }, 500);
  }
}
