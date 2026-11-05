/* =============================================================================
   NOGAL — Lambda de auto-login al ERP (ERPNext)
   ---------------------------------------------------------------------------
   Propósito: que el botón "Iniciar sesión en ERPNext" de la landing lleve al
   usuario de demo YA autenticado, SIN exponer las credenciales en el HTML/JS
   del cliente. Las credenciales se leen de VARIABLES DE ENTORNO de la Lambda.

   Flujo:
     Navegador → URL de esta Lambda → POST /api/method/login a ERPNext
     → tomamos la cookie de sesión (sid) → 302 al ERP con Set-Cookie.

   IMPORTANTE (cookies): el navegador solo guarda una cookie para el dominio
   que la emite. Si la Lambda responde desde *.lambda-url.<region>.on.aws, la
   cookie NO llegará al ERP. Por eso la Lambda debe exponerse bajo un
   subdominio del mismo dominio del ERP (ej. login.theartificialmachine.com vía
   CloudFront o API Gateway con dominio propio) y COOKIE_DOMAIN debe apuntar al
   dominio padre (ej. .theartificialmachine.com).

   Variables de entorno:
     ERP_URL        URL base de ERPNext, sin barra final          (requerida)
     ERP_USERNAME   usuario de demo                               (requerida)
     ERP_PASSWORD   clave de demo — NUNCA en el repo              (requerida)
     COOKIE_DOMAIN  dominio padre compartido con el ERP           (recomendada)
     ALLOW_ORIGIN   origen de la landing; si se define, solo se
                    acepta tráfico que venga desde ese origen     (opcional)
     REDIRECT_PATH  ruta del ERP tras iniciar sesión (def. /app)  (opcional)

   Nota de seguridad: auto-login con credenciales compartidas es aceptable SOLO
   para un entorno académico/demo. En producción se usaría OAuth/SSO por usuario.
   ========================================================================== */

const TIMEOUT_MS = 8000;

/* Reemplaza (o agrega) el atributo Domain de una cabecera Set-Cookie. */
export function scopeCookie(cookie, domain) {
  if (!domain) return cookie;
  const parts = cookie
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !/^domain=/i.test(p));
  parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

/* ¿La petición viene de la landing? Se usa Origin o, en su defecto, Referer
   (una navegación normal desde un enlace envía Referer con el origen). */
export function isAllowedOrigin(headers, allowOrigin) {
  if (!allowOrigin) return true;
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const source = h.origin || h.referer || "";
  const allowed = allowOrigin.replace(/\/+$/, "");
  return source === allowed || source.startsWith(allowed + "/");
}

function redirect(location, cookies = []) {
  return {
    statusCode: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
    cookies,
    body: "",
  };
}

export const handler = async (event) => {
  const ERP_URL = (process.env.ERP_URL || "").replace(/\/+$/, "");
  const USER = process.env.ERP_USERNAME;
  const PASS = process.env.ERP_PASSWORD;
  const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || "";
  const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "";
  const REDIRECT_PATH = process.env.REDIRECT_PATH || "/app";

  const method = event?.requestContext?.http?.method || event?.httpMethod || "GET";
  if (method !== "GET" && method !== "POST") {
    return { statusCode: 405, headers: { Allow: "GET, POST" }, body: "Método no permitido." };
  }

  if (!ERP_URL) {
    return { statusCode: 500, body: "Config faltante: define ERP_URL como variable de entorno." };
  }

  // Ante cualquier problema el usuario no queda en una página de error:
  // se le envía al login normal del ERP.
  const fallback = redirect(`${ERP_URL}/login`);

  if (!USER || !PASS) {
    console.error("[erp-login] faltan ERP_USERNAME / ERP_PASSWORD");
    return fallback;
  }
  if (!isAllowedOrigin(event?.headers, ALLOW_ORIGIN)) {
    console.warn("[erp-login] origen no permitido");
    return fallback;
  }

  try {
    // ERPNext expone /api/method/login (form-urlencoded).
    const res = await fetch(`${ERP_URL}/api/method/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ usr: USER, pwd: PASS }).toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status !== 200) {
      console.error(`[erp-login] ERP respondió ${res.status}`);
      return fallback;
    }

    const raw = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
    if (!raw.length) {
      console.error("[erp-login] el ERP no devolvió cookies de sesión");
      return fallback;
    }

    // Lambda Function URL / API Gateway v2 aceptan el array "cookies".
    const cookies = raw.map((c) => scopeCookie(c, COOKIE_DOMAIN));
    return redirect(`${ERP_URL}${REDIRECT_PATH}`, cookies);
  } catch (err) {
    console.error("[erp-login] error:", err?.name || err);
    return fallback;
  }
};
