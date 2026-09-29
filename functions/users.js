export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const DB = env.DB || env.chat;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!DB) {
    return new Response(JSON.stringify({ error: "Database binding missing in Cloudflare. Check D1 bindings." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Ensure users table exists
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

      if (action === "register") {
        const { name, phone, pin } = data;
        if (!name || !phone || !pin) {
          return new Response(JSON.stringify({ error: "All fields are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const existing = await DB.prepare("SELECT phone FROM users WHERE phone = ?").bind(phone).first();
        if (existing) {
          return new Response(JSON.stringify({ error: "Phone number already registered" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        await DB.prepare(
          "INSERT INTO users (phone, name, name_lower, pin) VALUES (?, ?, ?, ?)"
        ).bind(phone, name, name.toLowerCase(), pin).run();

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (action === "login") {
        const { phone, pin } = data;
        if (!phone || !pin) {
          return new Response(JSON.stringify({ error: "Phone and PIN required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const user = await DB.prepare("SELECT phone, name FROM users WHERE phone = ? AND pin = ?").bind(phone, pin).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "Invalid phone number or PIN" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        return new Response(JSON.stringify({ success: true, user }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ error: "Invalid action parameter specified" }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
