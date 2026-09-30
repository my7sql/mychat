// functions/messages.js - Complete Backend File for Messaging & Anti-Cache Sync

const NO_CACHE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Handle CORS Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: NO_CACHE_HEADERS });
  }

  try {
    // GET Request: Fetch Chat Room Messages
    if (request.method === "GET") {
      const roomId = url.searchParams.get("room_id");
      if (!roomId) {
        return new Response(JSON.stringify({ error: "room_id parameter is required" }), { status: 400, headers: NO_CACHE_HEADERS });
      }

      const { results } = await env.DB.prepare(
        "SELECT id, room_id, sender_phone, sender_name, recipient_phone, message, is_emergency, created_at FROM messages WHERE room_id = ? ORDER BY id ASC"
      ).bind(roomId).all();

      return new Response(JSON.stringify(results || []), { status: 200, headers: NO_CACHE_HEADERS });
    }

    // POST Request: Send New Message
    if (request.method === "POST") {
      const body = await request.json();
      const { room_id, sender_id, sender_name, recipient_phone, message, send_via_email, created_at } = body;

      if (!room_id || !sender_id || !message) {
        return new Response(JSON.stringify({ error: "Missing required message fields" }), { status: 400, headers: NO_CACHE_HEADERS });
      }

      const isEmergency = send_via_email ? 1 : 0;
      const timestamp = created_at || new Date().toISOString();

      const info = await env.DB.prepare(
        `INSERT INTO messages (room_id, sender_phone, sender_name, recipient_phone, message, is_emergency, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        room_id, 
        sender_id, 
        sender_name || "Unknown", 
        recipient_phone || "", 
        message, 
        isEmergency, 
        timestamp
      ).run();

      return new Response(JSON.stringify({ success: true, message_id: info.meta.last_row_id }), { status: 201, headers: NO_CACHE_HEADERS });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: NO_CACHE_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: NO_CACHE_HEADERS });
  }
}
