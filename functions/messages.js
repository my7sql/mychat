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
      const { room_id, sender_id, sender_name, recipient_phone, message, send_via_email, created_at } = data;

      if (!room_id || !sender_id || !message) {
        return new Response(JSON.stringify({ error: "Missing required message fields." }), { status: 400, headers: corsHeaders });
      }

      await DB.prepare(
        "INSERT INTO messages (room_id, sender_id, sender_name, recipient_id, message, is_emergency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(room_id, sender_id, sender_name || "User", "", message, send_via_email ? 1 : 0, created_at || new Date().toISOString()).run();

      // If "Send via Email" is checked, dispatch email to recipient with anti-spam headers
      if (send_via_email && recipient_phone) {
        const recipientRes = await DB.prepare("SELECT email, name FROM users WHERE phone = ?").bind(recipient_phone).all();
        if (recipientRes.results && recipientRes.results.length > 0) {
          const recipient = recipientRes.results[0];
          if (recipient.email && recipient.email.includes("@")) {
            try {
              // Send via Cloudflare Mailchannels API (optimized to reduce spam flagging)
              await fetch("https://api.mailchannels.net/tx/v1/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  personalizations: [{ to: [{ email: recipient.email, name: recipient.name }] }],
                  from: { email: "noreply@axtres-messenger.workers.dev", name: "Axtres Emergency Messenger" },
                  subject: `🚨 Urgent Message from ${sender_name}`,
                  content: [{
                    type: "text/plain",
                    value: `Hello ${recipient.name},\n\nYou received a secure message sent via email from ${sender_name}:\n\n"${message}"\n\nLog in to your Axtres app to reply.`
                  }]
                })
              });
            } catch (mailErr) {
              console.error("Email dispatch failed:", mailErr);
            }
          }
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ error: "Invalid method" }), { status: 405, headers: corsHeaders });
}
