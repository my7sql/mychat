// functions/users.js - Cloudflare Pages Function for User Auth, Verification & Resend Integration

const NO_CACHE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

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
        subject: subject,
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

  // Handle CORS Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: NO_CACHE_HEADERS });
  }

  try {
    // GET Request: Fetch Contacts List
    if (request.method === "GET") {
      const myPhone = url.searchParams.get("phone");
      if (!myPhone) {
        return new Response(JSON.stringify({ error: "Phone number required" }), { status: 400, headers: NO_CACHE_HEADERS });
      }

      // Retrieve all other users except the logged-in user
      const { results } = await env.DB.prepare(
        "SELECT name, phone, CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END as has_email FROM users WHERE phone != ?"
      ).bind(myPhone).all();

      return new Response(JSON.stringify(results || []), { status: 200, headers: NO_CACHE_HEADERS });
    }

    // POST Request: Handle Auth & Profile Actions
    if (request.method === "POST") {
      const action = url.searchParams.get("action");
      const body = await request.json();

      // 1. REGISTER
      if (action === "register") {
        const { name, phone, email, device_id } = body;
        if (!name || !phone || phone.length !== 10) {
          return new Response(JSON.stringify({ error: "Valid name and 10-digit phone required" }), { status: 400, headers: NO_CACHE_HEADERS });
        }

        const requires_verification = email && email.length > 0 ? 1 : 0;
        const pin = requires_verification ? Math.floor(100 + Math.random() * 900).toString() : null;

        await env.DB.prepare(
          `INSERT INTO users (phone, name, email, email_verified, device_id, pin) 
           VALUES (?, ?, ?, ?, ?, ?) 
           ON CONFLICT(phone) DO UPDATE SET name=?, email=?, email_verified=?, device_id=?, pin=?`
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

        return new Response(JSON.stringify({ success: true, requires_verification: !!requires_verification, pin_sent: pin }), { status: 200, headers: NO_CACHE_HEADERS });
      }

      // 2. VERIFY REGISTER PIN
      if (action === "verify-register") {
        const { phone, pin } = body;
        const user = await env.DB.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).first();

        if (!user || String(user.pin) !== String(pin)) {
          return new Response(JSON.stringify({ error: "Invalid verification PIN" }), { status: 400, headers: NO_CACHE_HEADERS });
        }

        await env.DB.prepare("UPDATE users SET email_verified = 1, pin = NULL WHERE phone = ?").bind(phone).run();
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: NO_CACHE_HEADERS });
      }

      // 3. LOGIN
      if (action === "login") {
        const { phone } = body;
        const user = await env.DB.prepare("SELECT phone, name, email FROM users WHERE phone = ?").bind(phone).first();

        if (!user) {
          return new Response(JSON.stringify({ error: "User not found. Please register first." }), { status: 404, headers: NO_CACHE_HEADERS });
        }

        return new Response(JSON.stringify({ success: true, user }), { status: 200, headers: NO_CACHE_HEADERS });
      }

      // 4. UPDATE EMAIL INITIALIZATION
      if (action === "update-email-init") {
        const { phone, email } = body;
        const pin = Math.floor(100 + Math.random() * 900).toString();

        const user = await env.DB.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "Phone number not registered" }), { status: 404, headers: NO_CACHE_HEADERS });
        }

        await env.DB.prepare("UPDATE users SET email = ?, email_verified = 0, pin = ? WHERE phone = ?").bind(email, pin, phone).run();

        if (email && env.RESEND_API_KEY) {
          await sendResendEmail(
            env.RESEND_API_KEY,
            email,
            "Verify New Email - axtres",
            `<p>Your email update verification code for axtres is: <strong style="font-size:1.4rem;">${pin}</strong></p>`
          );
        }

        return new Response(JSON.stringify({ success: true, pin_sent: pin }), { status: 200, headers: NO_CACHE_HEADERS });
      }

      // 5. VERIFY EMAIL UPDATE PIN
      if (action === "verify-email-update") {
        const { phone, pin } = body;
        const user = await env.DB.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).first();

        if (!user || String(user.pin) !== String(pin)) {
          return new Response(JSON.stringify({ error: "Invalid PIN" }), { status: 400, headers: NO_CACHE_HEADERS });
        }

        await env.DB.prepare("UPDATE users SET email_verified = 1, pin = NULL WHERE phone = ?").bind(phone).run();
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: NO_CACHE_HEADERS });
      }

      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: NO_CACHE_HEADERS });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: NO_CACHE_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: NO_CACHE_HEADERS });
  }
}
