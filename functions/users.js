export async function onRequest(context) {
  const { request, env } = context;
  const DB = env.DB || env.chat;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!DB) return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500, headers: corsHeaders });

  // Ensure separate users table exists
  try {
    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        phone TEXT PRIMARY KEY,
        name TEXT,
        name_lower TEXT,
        pin TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e) {}

  if (request.method === "POST") {
    try {
      const data = await request.json();
      const { action, phone, name, pin } = data;

      if (action === "register") {
        if (!phone || phone.length !== 10 || !name || !pin || pin.length !== 3) {
          return new Response(JSON.stringify({ error: "Invalid registration parameters. Ensure 10-digit phone and 3-digit PIN." }), { status: 400, headers: corsHeaders });
        }

        // Check if phone already registered
        const existing = await DB.prepare("SELECT phone FROM users WHERE phone = ?").bind(phone).first();
        if (existing) {
          return new Response(JSON.stringify({ error: "Phone number already registered. Please login." }), { status: 400, headers: corsHeaders });
        }

        // Insert user storing name case-insensitively using lower case reference column
        await DB.prepare(
          "INSERT INTO users (phone, name, name_lower, pin) VALUES (?, ?, ?, ?)"
        ).bind(phone, name, name.toLowerCase(), pin).run();

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "login") {
        if (!phone || !pin) {
          return new Response(JSON.stringify({ error: "Phone and PIN required." }), { status: 400, headers: corsHeaders });
        }

        const user = await DB.prepare("SELECT name, phone FROM users WHERE phone = ? AND pin = ?").bind(phone, pin).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "Incorrect phone number or 3-digit PIN." }), { status: 401, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ success: true, user: { name: user.name, phone: user.phone } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
}
