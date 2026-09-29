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
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT,
        sender_id TEXT,
        sender_name TEXT,
        message TEXT,
        created_at TEXT
      )
    `).run();
  } catch (e) {}

  const url = new URL(request.url);
  const roomId = url.searchParams.get("room_id");

  if (request.method === "GET") {
    try {
      let query = "SELECT sender_id AS senderPhone, sender_name AS senderName, message, created_at FROM messages";
      let params = [];

      if (roomId) {
        query += " WHERE room_id = ? ORDER BY id ASC";
        params = [roomId];
      } else {
        query += " ORDER BY id ASC";
      }

      const { results } = await DB.prepare(query).bind(...params).all();
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
      const { room_id, sender_id, sender_name, message, created_at } = data;

      if (!message || !sender_id || !room_id) {
        return new Response(JSON.stringify({ error: "Missing message data" }), { status: 400, headers: corsHeaders });
      }

      const timestamp = created_at || new Date().toISOString();

      await DB.prepare(
        "INSERT INTO messages (room_id, sender_id, sender_name, message, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(room_id, sender_id, sender_name, message, timestamp).run();

      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
}
