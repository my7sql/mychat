// functions/messages.js
// Axtres messaging + Resend email alerts

const NO_CACHE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: NO_CACHE_HEADERS
    }
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendResendNotification(
  apiKey,
  recipientEmail,
  senderName,
  messageText,
  fromAddress
) {

  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not configured in Cloudflare."
    );
  }

  if (!recipientEmail) {
    throw new Error(
      "Recipient has no email address."
    );
  }

  const from =
    fromAddress ||
    "axtres Alert <onboarding@resend.dev>";

  const response =
    await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",

        headers: {
          "Authorization":
            `Bearer ${apiKey}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            from,

            to: [
              recipientEmail
            ],

            subject:
              `New Message from ${senderName} on axtres`,

            html: `
              <div style="font-family:Arial,sans-serif;padding:15px;border:1px solid #e0e0e0;border-radius:8px;">

                <h3 style="color:#075e54;margin-top:0;">
                  New Message Alert
                </h3>

                <p>
                  <strong>
                    ${escapeHtml(senderName)}
                  </strong>
                  sent you a message:
                </p>

                <blockquote style="background:#f0f2f5;padding:10px 15px;border-left:4px solid #075e54;margin:10px 0;">
                  ${escapeHtml(messageText)}
                </blockquote>

              </div>
            `
          })
      }
    );

  const responseText =
    await response.text();

  let responseData = {};

  try {
    responseData =
      responseText
        ? JSON.parse(responseText)
        : {};
  } catch (_) {}

  if (!response.ok) {

    console.error(
      "Resend API error:",
      response.status,
      responseText
    );

    throw new Error(
      responseData?.message ||
      responseData?.error ||
      `Resend rejected the email (${response.status}).`
    );
  }

  return responseData;
}

export async function onRequest(context) {

  const {
    request,
    env
  } = context;

  const url =
    new URL(request.url);

  if (
    request.method ===
    "OPTIONS"
  ) {

    return new Response(
      null,
      {
        status: 204,
        headers:
          NO_CACHE_HEADERS
      }
    );
  }

  try {

    if (!env.DB) {

      return json(
        {
          error:
            "Cloudflare D1 binding DB is missing."
        },
        500
      );
    }

    /*
     * GET
     * Fetch messages
     */
    if (
      request.method ===
      "GET"
    ) {

      const roomId =
        url.searchParams.get(
          "room_id"
        );

      if (!roomId) {

        return json(
          {
            error:
              "room_id parameter is required"
          },
          400
        );
      }

      const {
        results
      } =
        await env.DB.prepare(
          `SELECT
             id,
             room_id,
             sender_phone,
             sender_name,
             recipient_phone,
             message,
             is_emergency,
             created_at
           FROM messages
           WHERE room_id = ?
           ORDER BY id ASC`
        )
        .bind(roomId)
        .all();

      return json(
        results || []
      );
    }

    /*
     * POST
     * Save message
     */
    if (
      request.method ===
      "POST"
    ) {

      let body;

      try {

        body =
          await request.json();

      } catch (_) {

        return json(
          {
            error:
              "Invalid JSON request body."
          },
          400
        );
      }

      const {
        room_id,
        sender_id,
        sender_name,
        recipient_phone,
        message,
        send_via_email,
        created_at
      } = body;

      if (
        !room_id ||
        !sender_id ||
        !message
      ) {

        return json(
          {
            error:
              "Missing required message fields."
          },
          400
        );
      }

      const isEmergency =
        send_via_email
          ? 1
          : 0;

      const timestamp =
        created_at ||
        new Date().toISOString();

      const info =
        await env.DB.prepare(
          `INSERT INTO messages
            (
              room_id,
              sender_phone,
              sender_name,
              recipient_phone,
              message,
              is_emergency,
              created_at
            )
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          String(room_id),
          String(sender_id),
          sender_name ||
            "Unknown",
          recipient_phone ||
            "",
          String(message),
          isEmergency,
          timestamp
        )
        .run();

      const messageId =
        info?.meta?.last_row_id;

      let email = {
        requested:
          !!isEmergency,
        sent: false
      };

      /*
       * EMAIL
       */
      if (isEmergency) {

        let targetEmail =
          null;

        /*
         * Existing special routing for Yadhu
         */
        if (
          String(
            recipient_phone || ""
          ).trim() ===
          "7025707720"
        ) {

          targetEmail =
            "yadhukrishnabp777@gmail.com";

        } else if (
          recipient_phone
        ) {

          const recipientUser =
            await env.DB.prepare(
              `SELECT
                 email,
                 email_verified
               FROM users
               WHERE phone = ?`
            )
            .bind(
              String(
                recipient_phone
              )
            )
            .first();

          if (
            recipientUser?.email
          ) {

            targetEmail =
              recipientUser.email;
          }
        }

        try {

          if (!env.RESEND_API_KEY) {

            throw new Error(
              "RESEND_API_KEY is missing in Cloudflare."
            );
          }

          if (!targetEmail) {

            throw new Error(
              "No recipient email is available."
            );
          }

          await sendResendNotification(
            env.RESEND_API_KEY,
            targetEmail,
            sender_name ||
              sender_id,
            message,
            env.RESEND_FROM_EMAIL
          );

          email.sent = true;
          email.recipient =
            targetEmail;

        } catch (
          emailError
        ) {

          console.error(
            "Email alert failed:",
            emailError
          );

          email.error =
            emailError.message;
        }
      }

      return json(
        {
          success: true,
          message_id:
            messageId,
          email,
          warning:
            email.requested &&
            !email.sent
              ? email.error
              : undefined
        },
        201
      );
    }

    return json(
      {
        error:
          "Method not allowed"
      },
      405
    );

  } catch (err) {

    console.error(
      "Axtres messages function error:",
      err
    );

    return json(
      {
        error:
          err?.message ||
          "Internal server error"
      },
      500
    );
  }
}
