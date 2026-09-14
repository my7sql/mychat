export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // Dynamic fallback: Checks if the database is bound to DB or chat
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
    return new Response(JSON.stringify({ error: "Database binding missing in Cloudflare dashboard." }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  // GET: Fetch message history
  if (request.method === "GET") {
    const roomId = url.searchParams.get("room");
    if (!roomId) return new Response("Missing room", { status: 400, headers: corsHeaders });

    try {
      const { results } = await DB.prepare(
        "SELECT sender_id, sender_name, message FROM messages WHERE room_id = ? ORDER BY timestamp ASC"
      ).bind(roomId).all();

      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // POST: Save a new message
  if (request.method === "POST") {
    const data = await request.json();
    const { room_id, sender_id, sender_name, message } = data;

    try {
      await DB.prepare(
        "INSERT INTO messages (room_id, sender_id, sender_name, message) VALUES (?, ?, ?, ?)"
      ).bind(room_id, sender_id, sender_name, message).run();

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
}
