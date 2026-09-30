export async function onRequest(context) {
  const { request, env } = context;
  const DB = env.DB || env.chat;
  const RESEND_API_KEY = env.RESEND_API_KEY;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate"
  };

  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!DB) return new Response(JSON.stringify({ error: "DB missing" }), { status: 500, headers: corsHeaders });

  try {
    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        phone TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        device_id TEXT,
        verification_pin TEXT,
        is_verified INTEGER DEFAULT 0
      )
    `).run();
  } catch (e) {}

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (request.method === "GET") {
    const phone = url.searchParams.get("phone");
    try {
      const { results } = await DB.prepare("SELECT phone, name, email, is_verified FROM users WHERE phone != ?").bind(phone || "").all();
      const formatted = (results || []).map(u => ({
        ...u,
        has_email: (u.email && u.email.includes("@") && u.is_verified === 1) ? 1 : 0
      }));
      return new Response(JSON.stringify(formatted), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  if (request.method === "POST") {
    try {
      const data = await request.json();

      // 1. REGISTRATION (Optional Email)
      if (action === "register") {
        const { name, phone, email, device_id } = data;
        if (!name || !phone) return new Response(JSON.stringify({ error: "Name and phone required" }), { status: 400, headers: corsHeaders });

        let pin = null;
        let is_verified = 1; // Auto-verified if no email

        if (email && email.includes("@")) {
          pin = Math.floor(100 + Math.random() * 900).toString();
          is_verified = 0; // Requires PIN verification if email provided
        }

        await DB.prepare(`
          INSERT INTO users (phone, name, email, device_id, verification_pin, is_verified) 
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(phone) DO UPDATE SET name = ?, email = ?, device_id = ?, verification_pin = ?, is_verified = ?
        `).bind(phone, name, email || "", device_id || "", pin, is_verified, name, email || "", device_id || "", pin, is_verified).run();

        // Send Email via Resend if email provided
        if (email && email.includes("@") && RESEND_API_KEY) {
          try {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_API_KEY}` },
              body: JSON.stringify({
                from: "Axtres Messenger <onboarding@resend.dev>",
                to: [email],
                subject: `🔒 Your Axtres Verification PIN: ${pin}`,
                text: `Hello ${name},\n\nYour 3-digit verification PIN is: ${pin}`
              })
            });
          } catch (e) {}
        }

        return new Response(JSON.stringify({ success: true, requires_verification: is_verified === 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 2. VERIFY PIN FOR REGISTRATION
      if (action === "verify-register") {
        const { phone, pin } = data;
        const { results } = await DB.prepare("SELECT verification_pin FROM users WHERE phone = ?").bind(phone).all();
        if (!results || results.length === 0 || results[0].verification_pin !== pin.trim()) {
          return new Response(JSON.stringify({ error: "Incorrect 3-digit PIN." }), { status: 400, headers: corsHeaders });
        }
        await DB.prepare("UPDATE users SET is_verified = 1, verification_pin = NULL WHERE phone = ?").bind(phone).run();
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 3. ADD / UPDATE EMAIL LATER (From Sign-In)
      if (action === "update-email-init") {
        const { phone, email } = data;
        if (!phone || !email) return new Response(JSON.stringify({ error: "Phone and email required" }), { status: 400, headers: corsHeaders });

        const check = await DB.prepare("SELECT phone FROM users WHERE phone = ?").bind(phone).all();
        if (!check.results || check.results.length === 0) {
          return new Response(JSON.stringify({ error: "Phone number not registered. Please register first." }), { status: 404, headers: corsHeaders });
        }

        const pin = Math.floor(100 + Math.random() * 900).toString();
        await DB.prepare("UPDATE users SET email = ?, verification_pin = ?, is_verified = 0 WHERE phone = ?").bind(email, pin, phone).run();

        if (RESEND_API_KEY) {
          try {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_API_KEY}` },
              body: JSON.stringify({
                from: "Axtres Messenger <onboarding@resend.dev>",
                to: [email],
                subject: `🔒 Your Axtres Email Update PIN: ${pin}`,
                text: `Your 3-digit verification PIN to link this email is: ${pin}`
              })
            });
          } catch (e) {}
        }

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 4. VERIFY EMAIL UPDATE PIN
      if (action === "verify-email-update") {
        const { phone, pin } = data;
        const { results } = await DB.prepare("SELECT verification_pin FROM users WHERE phone = ?").bind(phone).all();
        if (!results || results.length === 0 || results[0].verification_pin !== pin.trim()) {
          return new Response(JSON.stringify({ error: "Incorrect 3-digit PIN." }), { status: 400, headers: corsHeaders });
        }
        await DB.prepare("UPDATE users SET is_verified = 1, verification_pin = NULL WHERE phone = ?").bind(phone).run();
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 5. LOGIN
      if (action === "login") {
        const { phone } = data;
        const { results } = await DB.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).all();
        if (!results || results.length === 0) {
          return new Response(JSON.stringify({ error: "Phone number not found. Please register." }), { status: 404, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ success: true, user: results[0] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ error: "Invalid call" }), { status: 400, headers: corsHeaders });
}
