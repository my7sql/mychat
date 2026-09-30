export async function onRequest(context) {
  const { request, env } = context;
  const DB = env.DB || env.chat;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!DB) {
    return new Response(JSON.stringify({ error: "Database binding missing." }), { status: 500, headers: corsHeaders });
  }

  try {
    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        phone TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        device_id TEXT
      )
    `).run();
  } catch (e) {}

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (request.method === "GET") {
    const phone = url.searchParams.get("phone");
    try {
      const { results } = await DB.prepare("SELECT phone, name, email FROM users WHERE phone != ?").bind(phone || "").all();
      const formatted = (results || []).map(u => ({
        ...u,
        has_email: (u.email && u.email.includes("@")) ? 1 : 0
      }));
      return new Response(JSON.stringify(formatted), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  if (request.method === "POST") {
    try {
      const data = await request.json();
      
      if (action === "register") {
        const { name, phone, email, device_id } = data;
        if (!name || !phone) return new Response(JSON.stringify({ error: "Name and phone required" }), { status: 400, headers: corsHeaders });
        
        await DB.prepare(`
          INSERT INTO users (phone, name, email, device_id) VALUES (?, ?, ?, ?)
          ON CONFLICT(phone) DO UPDATE SET name = ?, email = COALESCE(?, email), device_id = ?
        `).bind(phone, name, email || "", device_id || "", name, email || null, device_id || "").run();

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "update-email") {
        const { phone, email } = data;
        if (!phone || !email) return new Response(JSON.stringify({ error: "Phone and email required" }), { status: 400, headers: corsHeaders });

        const check = await DB.prepare("SELECT phone FROM users WHERE phone = ?").bind(phone).all();
        if (!check.results || check.results.length === 0) {
          return new Response(JSON.stringify({ error: "Phone number not registered. Please register first." }), { status: 404, headers: corsHeaders });
        }

        await DB.prepare("UPDATE users SET email = ? WHERE phone = ?").bind(email, phone).run();
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "login") {
        const { phone, device_id } = data;
        const { results } = await DB.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).all();
        if (!results || results.length === 0) {
          return new Response(JSON.stringify({ error: "Phone number not found. Please register." }), { status: 404, headers: corsHeaders });
        }
        const user = results.get ? results.get(0) : results[0];
        return new Response(JSON.stringify({ success: true, user }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ error: "Invalid endpoint call" }), { status: 400, headers: corsHeaders });
}
