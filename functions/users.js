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
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  try {
    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT UNIQUE,
        device_id TEXT
      )
    `).run();
  } catch (e) {}

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  // GET /users?phone=... -> Returns contacts list excluding yourself
  if (request.method === "GET") {
    try {
      const myPhone = url.searchParams.get("phone");
      const { results } = await DB.prepare("SELECT name, phone FROM users WHERE phone != ?").bind(myPhone || "").all();
      return new Response(JSON.stringify(results || []), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  if (request.method === "POST") {
    try {
      const data = await request.json();
      const { name, phone, device_id } = data;

      if (!phone) {
        return new Response(JSON.stringify({ error: "Phone number is required." }), { 
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      // Action: REGISTER
      if (action === "register") {
        if (!name) {
          return new Response(JSON.stringify({ error: "Name is required for registration." }), { status: 400, headers: corsHeaders });
        }

        // Check if phone already exists
        const existing = await DB.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).all();
        if (existing.results && existing.results.length > 0) {
          return new Response(JSON.stringify({ error: "This phone number is already registered. Please log in." }), { status: 400, headers: corsHeaders });
        }

        await DB.prepare(
          "INSERT INTO users (name, phone, device_id) VALUES (?, ?, ?)"
        ).bind(name, phone, device_id || "unknown").run();

        return new Response(JSON.stringify({ success: true }), { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      // Action: LOGIN (Phone number only)
      if (action === "login") {
        const { results } = await DB.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).all();
        
        if (!results || results.length === 0) {
          return new Response(JSON.stringify({ error: "Phone number not found. Please register first." }), { 
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        const user = results[0];
        
        // Update device ID binding for persistence
        if (device_id) {
          await DB.prepare("UPDATE users SET device_id = ? WHERE phone = ?").bind(device_id, phone).run();
        }

        return new Response(JSON.stringify({ success: true, user: { name: user.name, phone: user.phone } }), { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { 
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }

  return new Response(JSON.stringify({ error: "Invalid endpoint" }), { status: 404, headers: corsHeaders });
}
