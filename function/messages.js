export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // Enable CORS
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // GET: Fetch message history for a specific room
  if (request.method === "GET") {
    const roomId = url.searchParams.get("room");
    if (!roomId) return new Response("Missing room", { status: 400, headers: corsHeaders });

    const { results } = await env.DB.prepare(
      "SELECT sender_id, sender_name, message FROM messages WHERE room_id = ? ORDER BY timestamp ASC"
    ).bind(roomId).all();

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // POST: Save a new message
  if (request.method === "POST") {
    const data = await request.json();
    const { room_id, sender_id, sender_name, message } = data;

    await env.DB.prepare(
      "INSERT INTO messages (room_id, sender_id, sender_name, message) VALUES (?, ?, ?, ?)"
    ).bind(room_id, sender_id, sender_name, message).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
}
