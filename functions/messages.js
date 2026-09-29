export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const DB = env.DB || env.chat;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!DB) return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500, headers: corsHeaders });

  try {
    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT,
        sender_id TEXT,
        sender_name TEXT,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e) {}

  if (request.method === "GET") {
    const room = url.searchParams.get("room") || "general";
    try {
      const { results } = await DB.prepare(
        "SELECT sender_id AS senderPhone, sender_name AS senderName, message, time(created_at, 'localtime') AS time FROM messages WHERE room_id = ? ORDER BY id ASC"
      ).bind(room).all();
      return new Response(JSON.stringify(results), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  if (request.method === "POST") {
    try {
      const { room_id, sender_id, sender_name, message } = await request.json();
      await DB.prepare(
        "INSERT INTO messages (room_id, sender_id, sender_name, message) VALUES (?, ?, ?, ?)"
      ).bind(room_id, sender_id, sender_name, message).run();
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
}
