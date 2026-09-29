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
        recipient_id TEXT,
        message TEXT,
        is_emergency INTEGER DEFAULT 0,
        created_at TEXT
      )
    `).run();
  } catch (e) {}

  const url = new URL(request.url);

  if (request.method === "GET") {
    const room_id = url.searchParams.get("room_id");
    if (!room_id) {
      return new Response(JSON.stringify({ error: "room_id required" }), { status: 400, headers: corsHeaders });
    }
    try {
      const { results } = await DB.prepare(
        "SELECT * FROM messages WHERE room_id = ? ORDER BY id ASC"
      ).bind(room_id).all();

      const formatted = (results || []).map(m => ({
        ...m,
        senderPhone: m.sender_id
      }));

      return new Response(JSON.stringify(formatted), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  if (request.method === "POST") {
    try {
      const data = await request.json();
      const { room_id, sender_id, sender_name, message, is_emergency, created_at } = data;

      if (!room_id || !sender_id || !message) {
        return new Response(JSON.stringify({ error: "Missing required message fields." }), { status: 400, headers: corsHeaders });
      }

      // Automatic keyword fallback scanning if toggle wasn't manually clicked
      const emergencyKeywords = ["help", "emergency", "sos", "danger", "fire", "urgent", "save", "accident", "attack", "critical"];
      const lowerMsg = message.toLowerCase();
      const autoDetected = emergencyKeywords.some(keyword => lowerMsg.includes(keyword));
      const finalEmergencyState = (is_emergency || autoDetected) ? 1 : 0;

      await DB.prepare(
        "INSERT INTO messages (room_id, sender_id, sender_name, recipient_id, message, is_emergency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(room_id, sender_id, sender_name || "Emergency User", "", message, finalEmergencyState, created_at || new Date().toISOString()).run();

      // OPTIONAL GMAIL BACKUP HOOK: 
      // If finalEmergencyState === 1, you can hook up your Gmail API mail dispatch here for recipient.email!

      return new Response(JSON.stringify({ success: true, is_emergency: finalEmergencyState }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ error: "Invalid method" }), { status: 405, headers: corsHeaders });
}
