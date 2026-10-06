// functions/messages.js - Cloudflare Pages Function for Messaging & Resend Email Alerts

const NO_CACHE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

async function sendResendNotification(apiKey, recipientEmail, senderName, messageText) {
  if (!apiKey || !recipientEmail) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "axtres Alert <onboarding@resend.dev>",
        to: [recipientEmail],
        subject: `New Message from ${senderName} on axtres`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h3 style="color: #075e54; margin-top: 0;">New Message Alert</h3>
            <p><strong>${senderName}</strong> sent you a message:</p>
            <blockquote style="background: #f0f2f5; padding: 10px 15px; border-left: 4px solid #075e54; margin: 10px 0;">
              ${messageText}
            </blockquote>
          </div>
        `
      })
    });
  } catch (err) {
    console.error("Failed to send Resend email alert:", err);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Handle CORS Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: NO_CACHE_HEADERS });
  }

  try {
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

      if (isEmergency && env.RESEND_API_KEY) {
        let targetEmail = null;

        // Force email for Yadhu (7025707720) to always be yadhukrishnabp777@gmail.com
        if (String(recipient_phone).trim() === "7025707720") {
          targetEmail = "yadhukrishnabp777@gmail.com";
        } else if (recipient_phone) {
          const recipientUser = await env.DB.prepare("SELECT email FROM users WHERE phone = ?").bind(recipient_phone).first();
          if (recipientUser && recipientUser.email) {
            targetEmail = recipientUser.email;
          }
        }

        if (targetEmail) {
          await sendResendNotification(
            env.RESEND_API_KEY,
            targetEmail,
            sender_name || sender_id,
            message
          );
        }
      }

      return new Response(JSON.stringify({ success: true, message_id: info.meta.last_row_id }), { status: 201, headers: NO_CACHE_HEADERS });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: NO_CACHE_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: NO_CACHE_HEADERS });
  }
}
