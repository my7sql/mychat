export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // Dynamic fallback looking for both possible database binding names
  const DB = env.DB || env.chat;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Handle browser pre-flight safety check
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Error check if the database link isn't established in Cloudflare yet
  if (!DB) {
    return new Response(JSON.stringify({ error: "Database binding missing in Cloudflare dashboard." }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  // GET ROUTE: Fetch offline message history for a specific room
  if (request.method === "GET") {
    const roomId = url.searchParams.get("room");
    if (!roomId) return new Response("Missing room parameters", { status: 400, headers: corsHeaders });

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

  // POST ROUTE: Save a new message securely to the D1 SQLite database
  if (request.method === "POST") {
    try {
      const data = await request.json();
      const { room_id, sender_id, sender_name, message } = data;

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
