const ADMIN_PIN = "527";

const HEADERS = {
    "Content-Type": "application/json",
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
            headers: HEADERS
        }
    );
}

function validPhone(phone) {
    return /^\d{10}$/.test(
        String(phone || "").trim()
    );
}

function validAdminPin(pin) {
    return String(pin || "") === ADMIN_PIN;
}

async function sendResendEmail(
    apiKey,
    recipient,
    subject,
    html
) {

    if (!apiKey || !recipient) {
        return;
    }

    try {

        await fetch(
            "https://api.resend.com/emails",
            {
                method: "POST",

                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({

                    from:
                        "axtres Messenger <onboarding@resend.dev>",

                    to: [recipient],

                    subject,

                    html

                })
            }
        );

    } catch (error) {

        console.error(
            "Resend error:",
            error
        );

    }

}

export async function onRequest(context) {

    const {
        request,
        env
    } = context;

    const url =
        new URL(request.url);

    if (
        request.method === "OPTIONS"
    ) {

        return new Response(
            null,
            {
                status: 204,
                headers: HEADERS
            }
        );

    }

    try {

        /* =========================
           NORMAL DIRECTORY
           ========================= */

        if (
            request.method === "GET"
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

            const result =
                await env.DB.prepare(
                    `
                    SELECT
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
                    WHERE phone != ?
                    ORDER BY
                        name COLLATE NOCASE ASC,
                        phone ASC
                    `
                )
                .bind(myPhone)
                .all();

            return json(
                result.results || []
            );

        }


        if (
            request.method !== "POST"
        ) {

            return json(
                {
                    error:
                        "Method not allowed"
                },
                405
            );

        }

        const action =
            url.searchParams.get(
                "action"
            );

        const body =
            await request.json();


        /* =========================
           ADMIN LIST
           ========================= */

        if (
            action === "admin-list"
        ) {

            if (
                !validAdminPin(body.pin)
            ) {

                return json(
                    {
                        error:
                            "Wrong PIN"
                    },
                    401
                );

            }

            const result =
                await env.DB.prepare(
                    `
                    SELECT
                        phone,
                        name,
                        email,
                        email_verified
                    FROM users
                    ORDER BY
                        name COLLATE NOCASE ASC,
                        phone ASC
                    `
                )
                .all();

            return json(
                {
                    success: true,
                    users:
                        result.results || []
                }
            );

        }


        /* =========================
           ADMIN ADD / EDIT USER
           ========================= */

        if (
            action === "admin-save"
        ) {

            if (
                !validAdminPin(body.pin)
            ) {

                return json(
                    {
                        error:
                            "Wrong PIN"
                    },
                    401
                );

            }

            const originalPhone =
                String(
                    body.original_phone || ""
                ).trim();

            const name =
                String(
                    body.name || ""
                ).trim();

            const phone =
                String(
                    body.phone || ""
                ).trim();

            const email =
                String(
                    body.email || ""
                ).trim();


            if (
                !name ||
                !validPhone(phone)
            ) {

                return json(
                    {
                        error:
                            "Name and valid 10-digit phone are required"
                    },
                    400
                );

            }


            /* EDIT */

            if (originalPhone) {

                const target =
                    await env.DB.prepare(
                        `
                        SELECT phone
                        FROM users
                        WHERE phone = ?
                        `
                    )
                    .bind(phone)
                    .first();

                if (
                    phone !== originalPhone &&
                    target
                ) {

                    return json(
                        {
                            error:
                                "That phone number is already registered"
                        },
                        409
                    );

                }

                const source =
                    await env.DB.prepare(
                        `
                        SELECT phone
                        FROM users
                        WHERE phone = ?
                        `
                    )
                    .bind(originalPhone)
                    .first();

                if (!source) {

                    return json(
                        {
                            error:
                                "Original user not found"
                        },
                        404
                    );

                }

                await env.DB.prepare(
                    `
                    UPDATE users
                    SET
                        phone = ?,
                        name = ?,
                        email = ?,
                        email_verified = 1,
                        pin = NULL
                    WHERE phone = ?
                    `
                )
                .bind(
                    phone,
                    name,
                    email,
                    originalPhone
                )
                .run();

                return json(
                    {
                        success: true,
                        updated: true,
                        user: {
                            phone,
                            name,
                            email,
                            email_verified: 1
                        }
                    }
                );

            }


            /* ADD */

            const existing =
                await env.DB.prepare(
                    `
                    SELECT phone
                    FROM users
                    WHERE phone = ?
                    `
                )
                .bind(phone)
                .first();

            if (existing) {

                return json(
                    {
                        error:
                            "That phone number is already registered"
                    },
                    409
                );

            }

            await env.DB.prepare(
                `
                INSERT INTO users
                (
                    phone,
                    name,
                    email,
                    email_verified,
                    device_id,
                    pin
                )
                VALUES
                (?, ?, ?, 1, '', NULL)
                `
            )
            .bind(
                phone,
                name,
                email
            )
            .run();

            return json(
                {
                    success: true,
                    created: true,
                    user: {
                        phone,
                        name,
                        email,
                        email_verified: 1
                    }
                }
            );

        }


        /* =========================
           REGISTER
           ========================= */

        if (
            action === "register"
        ) {

            const {
                name,
                phone,
                email,
                device_id
            } = body;

            if (
                !name ||
                !validPhone(phone)
            ) {

                return json(
                    {
                        error:
                            "Valid name and 10-digit phone required"
                    },
                    400
                );

            }

            const requiresVerification =
                email &&
                email.length > 0;

            const pin =
                requiresVerification
                ?String(
                    Math.floor(
                        100 +
                        Math.random() * 900
                    )
                )
                :null;

            await env.DB.prepare(
                `
                INSERT INTO users
                (
                    phone,
                    name,
                    email,
                    email_verified,
                    device_id,
                    pin
                )
                VALUES
                (?, ?, ?, ?, ?, ?)

                ON CONFLICT(phone)
                DO UPDATE SET
                    name = ?,
                    email = ?,
                    email_verified = ?,
                    device_id = ?,
                    pin = ?
                `
            )
            .bind(
                phone,
                name,
                email || "",
                requiresVerification ? 0 : 1,
                device_id || "",
                pin,

                name,
                email || "",
                requiresVerification ? 0 : 1,
                device_id || "",
                pin
            )
            .run();


            if (
                requiresVerification &&
                email &&
                env.RESEND_API_KEY
            ) {

                await sendResendEmail(

                    env.RESEND_API_KEY,

                    email,

                    "Your axtres Verification Code",

                    `
                    <p>
                        Hello
                        <strong>
                            ${name}
                        </strong>,
                    </p>

                    <p>
                        Your axtres verification code is:
                    </p>

                    <p>
                        <strong
                            style="
                                font-size:28px;
                                letter-spacing:5px;
                            "
                        >
                            ${pin}
                        </strong>
                    </p>
                    `

                );

            }

            return json(
                {
                    success: true,
                    requires_verification:
                        !!requiresVerification
                }
            );

        }


        /* =========================
           VERIFY REGISTER
           ========================= */

        if (
            action === "verify-register"
        ) {

            const {
                phone,
                pin
            } = body;

            const user =
                await env.DB.prepare(
                    `
                    SELECT *
                    FROM users
                    WHERE phone = ?
                    `
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
                `
                UPDATE users
                SET
                    email_verified = 1,
                    pin = NULL
                WHERE phone = ?
                `
            )
            .bind(phone)
            .run();

            return json(
                {
                    success: true
                }
            );

        }


        /* =========================
           LOGIN
           ========================= */

        if (
            action === "login"
        ) {

            const {
                phone
            } = body;

            const user =
                await env.DB.prepare(
                    `
                    SELECT
                        phone,
                        name,
                        email
                    FROM users
                    WHERE phone = ?
                    `
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

            return json(
                {
                    success: true,
                    user
                }
            );

        }


        /* =========================
           UPDATE EMAIL INIT
           ========================= */

        if (
            action === "update-email-init"
        ) {

            const {
                phone,
                email
            } = body;

            const user =
                await env.DB.prepare(
                    `
                    SELECT phone
                    FROM users
                    WHERE phone = ?
                    `
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

            const pin =
                String(
                    Math.floor(
                        100 +
                        Math.random() * 900
                    )
                );

            await env.DB.prepare(
                `
                UPDATE users
                SET
                    email = ?,
                    email_verified = 0,
                    pin = ?
                WHERE phone = ?
                `
            )
            .bind(
                email,
                pin,
                phone
            )
            .run();

            if (
                email &&
                env.RESEND_API_KEY
            ) {

                await sendResendEmail(

                    env.RESEND_API_KEY,

                    email,

                    "Verify New Email - axtres",

                    `
                    <p>
                        Your axtres email verification code is:
                    </p>

                    <p>
                        <strong
                            style="
                                font-size:28px;
                                letter-spacing:5px;
                            "
                        >
                            ${pin}
                        </strong>
                    </p>
                    `

                );

            }

            return json(
                {
                    success: true
                }
            );

        }


        /* =========================
           VERIFY EMAIL UPDATE
           ========================= */

        if (
            action === "verify-email-update"
        ) {

            const {
                phone,
                pin
            } = body;

            const user =
                await env.DB.prepare(
                    `
                    SELECT *
                    FROM users
                    WHERE phone = ?
                    `
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
                `
                UPDATE users
                SET
                    email_verified = 1,
                    pin = NULL
                WHERE phone = ?
                `
            )
            .bind(phone)
            .run();

            return json(
                {
                    success: true
                }
            );

        }


        return json(
            {
                error:
                    "Invalid action"
            },
            400
        );

    } catch (error) {

        console.error(
            "users.js error:",
            error
        );

        return json(
            {
                error:
                    error.message ||
                    "Server error"
            },
            500
        );

    }

}
