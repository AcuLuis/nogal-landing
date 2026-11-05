/* =============================================================================
   NOGAL — Lambda del formulario de contacto
   ---------------------------------------------------------------------------
   Recibe POST JSON { name, email, interest, message, website } desde la
   landing, valida en servidor y envía la solicitud a ventas con Amazon SES.
   "website" es el campo trampa: si llega con contenido se responde 200 sin
   enviar nada.

   Variables de entorno:
     CONTACT_TO     correo que recibe las solicitudes             (requerida)
     CONTACT_FROM   remitente verificado en SES                   (requerida)
     ALLOW_ORIGIN   origen de la landing (CORS y verificación)    (recomendada)
     RATE_LIMIT     envíos por IP cada 10 min (def. 5)            (opcional)

   El SDK de SES (@aws-sdk/client-sesv2) ya viene incluido en el runtime
   Node.js 20 de Lambda: no hay dependencias que empaquetar.
   ========================================================================== */

const MAX_BODY = 10 * 1024;
const WINDOW_MS = 10 * 60 * 1000;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INTERESTS = [
  "Mesas", "Sillas", "Cómodas / cajoneras", "Estanterías / libreros",
  "Escritorios", "Mobiliario a medida", "Otro",
];

/* Quita saltos de línea y caracteres de control (evita inyección en cabeceras). */
const oneLine = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

export function validate(input) {
  const data = {
    name: oneLine(input?.name),
    email: oneLine(input?.email),
    interest: oneLine(input?.interest) || "Otro",
    message: String(input?.message ?? "").replace(/\r\n?/g, "\n").trim(),
  };
  const errors = {};
  if (data.name.length < 3 || data.name.length > 120) errors.name = "Nombre inválido.";
  if (!EMAIL_RX.test(data.email) || data.email.length > 160) errors.email = "Correo inválido.";
  if (!INTERESTS.includes(data.interest)) errors.interest = "Opción no válida.";
  if (data.message.length > 2000) errors.message = "Mensaje demasiado largo.";
  return { data, errors };
}

export function buildEmail({ name, email, interest, message }, { to, from }) {
  return {
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    ReplyToAddresses: [email],
    Content: {
      Simple: {
        Subject: { Data: `Nueva solicitud: ${interest} — ${name}`.slice(0, 200), Charset: "UTF-8" },
        Body: {
          Text: {
            Charset: "UTF-8",
            Data: [
              "Nueva solicitud desde la landing de NOGAL",
              "",
              `Nombre y empresa: ${name}`,
              `Correo: ${email}`,
              `Producto de interés: ${interest}`,
              "",
              "Mensaje:",
              message || "(sin mensaje)",
            ].join("\n"),
          },
        },
      },
    },
  };
}

/* Límite simple por IP. Vive mientras el contenedor de Lambda siga activo;
   para un límite global usa AWS WAF (ver docs/produccion.md). */
export function createLimiter(max, windowMs = WINDOW_MS) {
  const hits = new Map();
  return (ip, now = Date.now()) => {
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) { hits.set(ip, recent); return false; }
    recent.push(now);
    hits.set(ip, recent);
    return true;
  };
}

async function sesSend(params) {
  const { SESv2Client, SendEmailCommand } = await import("@aws-sdk/client-sesv2");
  const client = new SESv2Client({});
  return client.send(new SendEmailCommand(params));
}

export function createHandler({ send = sesSend } = {}) {
  const allow = createLimiter(Number(process.env.RATE_LIMIT) || 5);

  return async (event) => {
    const ORIGIN = process.env.ALLOW_ORIGIN || "";
    const headers = {
      "Access-Control-Allow-Origin": ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

    const method = event?.requestContext?.http?.method || event?.httpMethod || "POST";
    if (method === "OPTIONS") return { statusCode: 204, headers, body: "" };
    if (method !== "POST") return json(405, { error: "Método no permitido." });

    const reqHeaders = Object.fromEntries(
      Object.entries(event?.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
    );
    if (ORIGIN && reqHeaders.origin && reqHeaders.origin !== ORIGIN.replace(/\/+$/, "")) {
      return json(403, { error: "Origen no permitido." });
    }

    const to = process.env.CONTACT_TO;
    const from = process.env.CONTACT_FROM;
    if (!to || !from) {
      console.error("[contact] faltan CONTACT_TO / CONTACT_FROM");
      return json(500, { error: "Servicio no configurado." });
    }

    let raw = event?.body || "";
    if (event?.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY) return json(413, { error: "Solicitud demasiado grande." });

    let input;
    try { input = JSON.parse(raw); } catch { return json(400, { error: "JSON inválido." }); }

    // Bot: se responde como si todo hubiera ido bien.
    if (input && input.website) return json(200, { ok: true });

    const { data, errors } = validate(input);
    if (Object.keys(errors).length) return json(400, { error: "Datos inválidos.", fields: errors });

    const ip = event?.requestContext?.http?.sourceIp || event?.requestContext?.identity?.sourceIp || "desconocida";
    if (!allow(ip)) return json(429, { error: "Demasiadas solicitudes. Inténtalo más tarde." });

    try {
      await send(buildEmail(data, { to, from }));
      return json(200, { ok: true });
    } catch (err) {
      console.error("[contact] error al enviar:", err?.name || err);
      return json(502, { error: "No se pudo enviar la solicitud." });
    }
  };
}

export const handler = createHandler();
