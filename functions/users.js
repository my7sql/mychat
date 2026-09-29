export async function onRequest(context) {
  const { request, env } = context;
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
    return new Response(JSON.stringify({ error: "Database binding missing." }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  try {
    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT UNIQUE,
        pin TEXT,
        device_id TEXT
      )
    `).run();
  } catch (e) {}

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (request.method === "POST") {
    try {
      const data = await request.json();
      const { name, phone, pin, device_id } = data;

      if (!phone || !pin) {
        return new Response(JSON.stringify({ error: "Phone and PIN are required." }), { 
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      if (action === "register") {
        if (!name) return new Response(JSON.stringify({ error: "Name is required." }), { status: 400, headers: corsHeaders });
        
        await DB.prepare(
          "INSERT INTO users (name, phone, pin, device_id) VALUES (?, ?, ?, ?)"
        ).bind(name, phone, pin, device_id || "unknown").run();

        return new Response(JSON.stringify({ success: true }), { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      if (action === "login") {
        const { results } = await DB.prepare(
          "SELECT * FROM users WHERE phone = ? AND pin = ?"
        ).bind(phone, pin).all();

        if (!results || results.length === 0) {
          return new Response(JSON.stringify({ error: "Invalid phone number or PIN." }), { 
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        const user = results[0];
        
        if (device_id) {
          await DB.prepare("UPDATE users SET device_id = ? WHERE phone = ?").bind(device_id, phone).run();
        }

        return new Response(JSON.stringify({ success: true, user: { name: user.name, phone: user.phone } }), { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: "User already exists or database error." }), { 
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }

  return new Response(JSON.stringify({ error: "Invalid endpoint" }), { 
    status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } 
  });
}
