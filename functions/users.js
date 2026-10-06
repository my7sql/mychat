// functions/users.js
// Axtres user auth, email verification and Resend integration

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

async function sendResendEmail(
  apiKey,
  recipientEmail,
  subject,
  bodyHtml,
  fromAddress
) {

  if (!apiKey) {

    throw new Error(
      "RESEND_API_KEY is not configured in Cloudflare."
    );
  }

  if (!recipientEmail) {

    throw new Error(
      "Recipient email is missing."
    );
  }

  const from =
    fromAddress ||
    "axtres Messenger <onboarding@resend.dev>";

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
            subject,
            html: bodyHtml
          })
      }
    );

  const responseText =
    await response.text();

  let data = {};

  try {

    data =
      responseText
        ? JSON.parse(
            responseText
          )
        : {};

  } catch (_) {}

  if (!response.ok) {

    console.error(
      "Resend API error:",
      response.status,
      responseText
    );

    throw new Error(
      data?.message ||
      data?.error ||
      `Resend rejected the email (${response.status}).`
    );
  }

  return data;
}

export async function onRequest(
  context
) {

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
     * Contacts
     */
    if (
      request.method ===
      "GET"
    ) {

      const myPhone =
        url.searchParams.get(
          "phone"
        );

      if (!myPhone) {

        return json(
          {
            error:
              "Phone number required"
          },
          400
        );
      }

      const {
        results
      } =
        await env.DB.prepare(
          `SELECT
             name,
             phone,
             CASE
               WHEN email IS NOT NULL
               AND email != ''
               AND email_verified = 1
               THEN 1
               ELSE 0
             END AS has_email
           FROM users
           WHERE phone != ?`
        )
        .bind(myPhone)
        .all();

      return json(
        results || []
      );
    }

    /*
     * POST
     */
    if (
      request.method ===
      "POST"
    ) {

      const action =
        url.searchParams.get(
          "action"
        );

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

      /*
       * REGISTER
       */
      if (
        action ===
        "register"
      ) {

        const {
          name,
          phone,
          email,
          device_id
        } = body;

        if (
          !name ||
          !phone ||
          String(phone).length !== 10
        ) {

          return json(
            {
              error:
                "Valid name and 10-digit phone required"
            },
            400
          );
        }

        const cleanPhone =
          String(phone).trim();

        const cleanEmail =
          String(email || "").trim();

        const requiresVerification =
          cleanEmail.length > 0
            ? 1
            : 0;

        const pin =
          requiresVerification
            ? Math.floor(
                100 +
                Math.random() *
                900
              ).toString()
            : null;

        await env.DB.prepare(
          `INSERT INTO users
            (
              phone,
              name,
              email,
              email_verified,
              device_id,
              pin
            )
           VALUES (?, ?, ?, ?, ?, ?)

           ON CONFLICT(phone)
           DO UPDATE SET
             name=?,
             email=?,
             email_verified=?,
             device_id=?,
             pin=?`
        )
        .bind(
          cleanPhone,
          name.trim(),
          cleanEmail,
          requiresVerification
            ? 0
            : 1,
          device_id || "",
          pin,

          name.trim(),
          cleanEmail,
          requiresVerification
            ? 0
            : 1,
          device_id || "",
          pin
        )
        .run();

        if (
          requiresVerification
        ) {

          try {

            await sendResendEmail(
              env.RESEND_API_KEY,
              cleanEmail,
              "Your axtres Verification Code",

              `<p>
                Hello
                <strong>
                  ${escapeHtml(name)}
                </strong>,
              </p>

              <p>
                Your verification code for
                axtres messenger is:
              </p>

              <p>
                <strong style="font-size:1.4rem;">
                  ${escapeHtml(pin)}
                </strong>
              </p>`,

              env.RESEND_FROM_EMAIL
            );

          } catch (
            emailError
          ) {

            console.error(
              "Registration verification email failed:",
              emailError
            );

            return json(
              {
                error:
                  `Account saved, but verification email failed: ${emailError.message}`
              },
              502
            );
          }
        }

        return json(
          {
            success: true,
            requires_verification:
              !!requiresVerification
          }
        );
      }

      /*
       * VERIFY REGISTER
       */
      if (
        action ===
        "verify-register"
      ) {

        const {
          phone,
          pin
        } = body;

        const user =
          await env.DB.prepare(
            "SELECT * FROM users WHERE phone = ?"
          )
          .bind(phone)
          .first();

        if (
          !user ||
          String(user.pin) !==
            String(pin)
        ) {

          return json(
            {
              error:
                "Invalid verification PIN"
            },
            400
          );
        }

        await env.DB.prepare(
          `UPDATE users
           SET
             email_verified = 1,
             pin = NULL
           WHERE phone = ?`
        )
        .bind(phone)
        .run();

        return json({
          success: true
        });
      }

      /*
       * LOGIN
       */
      if (
        action ===
        "login"
      ) {

        const {
          phone
        } = body;

        const user =
          await env.DB.prepare(
            `SELECT
               phone,
               name,
               email
             FROM users
             WHERE phone = ?`
          )
          .bind(phone)
          .first();

        if (!user) {

          return json(
            {
              error:
                "User not found. Please register first."
            },
            404
          );
        }

        return json({
          success: true,
          user
        });
      }

      /*
       * UPDATE EMAIL
       */
      if (
        action ===
        "update-email-init"
      ) {

        const {
          phone,
          email
        } = body;

        const cleanEmail =
          String(email || "").trim();

        if (
          !phone ||
          !cleanEmail
        ) {

          return json(
            {
              error:
                "Phone and email are required."
            },
            400
          );
        }

        const pin =
          Math.floor(
            100 +
            Math.random() *
            900
          ).toString();

        const user =
          await env.DB.prepare(
            "SELECT * FROM users WHERE phone = ?"
          )
          .bind(phone)
          .first();

        if (!user) {

          return json(
            {
              error:
                "Phone number not registered"
            },
            404
          );
        }

        await env.DB.prepare(
          `UPDATE users
           SET
             email = ?,
             email_verified = 0,
             pin = ?
           WHERE phone = ?`
        )
        .bind(
          cleanEmail,
          pin,
          phone
        )
        .run();

        try {

          await sendResendEmail(
            env.RESEND_API_KEY,
            cleanEmail,
            "Verify New Email - axtres",

            `<p>
              Your email update verification
              code for axtres is:
            </p>

            <p>
              <strong style="font-size:1.4rem;">
                ${escapeHtml(pin)}
              </strong>
            </p>`,

            env.RESEND_FROM_EMAIL
          );

        } catch (
          emailError
        ) {

          console.error(
            "Email update verification failed:",
            emailError
          );

          return json(
            {
              error:
                `Email was saved, but verification email failed: ${emailError.message}`
            },
            502
          );
        }

        return json({
          success: true
        });
      }

      /*
       * VERIFY EMAIL UPDATE
       */
      if (
        action ===
        "verify-email-update"
      ) {

        const {
          phone,
          pin
        } = body;

        const user =
          await env.DB.prepare(
            "SELECT * FROM users WHERE phone = ?"
          )
          .bind(phone)
          .first();

        if (
          !user ||
          String(user.pin) !==
            String(pin)
        ) {

          return json(
            {
              error:
                "Invalid PIN"
            },
            400
          );
        }

        await env.DB.prepare(
          `UPDATE users
           SET
             email_verified = 1,
             pin = NULL
           WHERE phone = ?`
        )
        .bind(phone)
        .run();

        return json({
          success: true
        });
      }

      return json(
        {
          error:
            "Invalid action"
        },
        400
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
      "Axtres users function error:",
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
