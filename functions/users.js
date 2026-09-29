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

  // GET /users -> Returns list of all contacts except yourself
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

      if (!phone || !name) {
        return new Response(JSON.stringify({ error: "Name and phone are required." }), { 
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      // Upsert user: Register if new, log in seamlessly if already exists
      await DB.prepare(`
        INSERT INTO users (name, phone, device_id) VALUES (?, ?, ?)
        ON CONFLICT(phone) DO UPDATE SET name = excluded.name, device_id = excluded.device_id
      `).bind(name, phone, device_id || "unknown").run();

      const { results } = await DB.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).all();
      const user = results[0];

      return new Response(JSON.stringify({ success: true, user: { name: user.name, phone: user.phone } }), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { 
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }

  return new Response(JSON.stringify({ error: "Invalid endpoint" }), { status: 404, headers: corsHeaders });
}
