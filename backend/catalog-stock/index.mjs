/* =============================================================================
   NOGAL — Lambda de stock en vivo para el catálogo
   ---------------------------------------------------------------------------
   Lee las existencias de ERPNext (doctype Bin) con una API key de solo
   lectura y devuelve { products: [{ sku, stock }], updatedAt }.
   La landing fusiona ese stock por SKU con su catálogo local (js/data.js),
   así que aquí no viajan textos ni imágenes.

   Variables de entorno:
     ERP_URL         URL base de ERPNext, sin barra final           (requerida)
     ERP_API_KEY     API key de un usuario con rol de solo lectura  (requerida)
     ERP_API_SECRET  API secret del mismo usuario                   (requerida)
     SKUS            lista separada por comas para filtrar          (opcional)
     WAREHOUSE       almacén a consultar; vacío = todos             (opcional)
     ALLOW_ORIGIN    origen de la landing para CORS                 (recomendada)
     CACHE_SECONDS   segundos de caché en memoria y en CDN (def. 60) (opcional)
   ========================================================================== */

const TIMEOUT_MS = 8000;
let cache = { key: "", at: 0, body: null };

export function parseSkus(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/* Suma actual_qty por item_code (un ítem puede estar en varios almacenes). */
export function sumBins(bins) {
  const totals = new Map();
  for (const b of bins || []) {
    if (!b || typeof b.item_code !== "string") continue;
    const qty = Number(b.actual_qty);
    if (!Number.isFinite(qty)) continue;
    totals.set(b.item_code, (totals.get(b.item_code) || 0) + qty);
  }
  return [...totals].map(([sku, stock]) => ({ sku, stock: Math.max(0, Math.round(stock)) }));
}

export function binsUrl(erpUrl, skus, warehouse) {
  const filters = [];
  if (skus.length) filters.push(["item_code", "in", skus]);
  if (warehouse) filters.push(["warehouse", "=", warehouse]);
  const qs = new URLSearchParams({
    fields: JSON.stringify(["item_code", "actual_qty"]),
    limit_page_length: "0",
  });
  if (filters.length) qs.set("filters", JSON.stringify(filters));
  return `${erpUrl}/api/resource/Bin?${qs}`;
}

export function resetCache() {
  cache = { key: "", at: 0, body: null };
}

export const handler = async (event) => {
  const ERP_URL = (process.env.ERP_URL || "").replace(/\/+$/, "");
  const KEY = process.env.ERP_API_KEY;
  const SECRET = process.env.ERP_API_SECRET;
  const SKUS = parseSkus(process.env.SKUS);
  const WAREHOUSE = process.env.WAREHOUSE || "";
  const ORIGIN = process.env.ALLOW_ORIGIN || "*";
  const TTL = Math.max(0, Number(process.env.CACHE_SECONDS ?? 60) || 0);

  const headers = {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Accept",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
  const json = (statusCode, body, extra = {}) => ({
    statusCode,
    headers: { ...headers, ...extra },
    body: JSON.stringify(body),
  });

  const method = event?.requestContext?.http?.method || event?.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (method !== "GET") return json(405, { error: "Método no permitido." }, { Allow: "GET, OPTIONS" });

  if (!ERP_URL || !KEY || !SECRET) {
    console.error("[catalog-stock] faltan ERP_URL / ERP_API_KEY / ERP_API_SECRET");
    return json(500, { error: "Servicio no configurado." });
  }

  const url = binsUrl(ERP_URL, SKUS, WAREHOUSE);
  const now = Date.now();
  if (cache.body && cache.key === url && now - cache.at < TTL * 1000) {
    return json(200, cache.body, { "Cache-Control": `public, max-age=${TTL}`, "X-Cache": "hit" });
  }

  try {
    const res = await fetch(url, {
      headers: { Authorization: `token ${KEY}:${SECRET}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[catalog-stock] ERP respondió ${res.status}`);
      return json(502, { error: "No se pudo leer el inventario." });
    }
    const data = await res.json();
    const body = { products: sumBins(data?.data), updatedAt: new Date(now).toISOString() };
    cache = { key: url, at: now, body };
    return json(200, body, { "Cache-Control": `public, max-age=${TTL}`, "X-Cache": "miss" });
  } catch (err) {
    console.error("[catalog-stock] error:", err?.name || err);
    return json(502, { error: "No se pudo leer el inventario." });
  }
};
