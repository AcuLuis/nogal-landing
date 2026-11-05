import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handler, sumBins, binsUrl, parseSkus, resetCache } from "./index.mjs";

const ENV = { ...process.env };
const realFetch = globalThis.fetch;
let calls;

beforeEach(() => {
  resetCache();
  calls = [];
  Object.assign(process.env, {
    ERP_URL: "http://erp.example.com/",
    ERP_API_KEY: "key",
    ERP_API_SECRET: "secret",
    SKUS: "MES-NOG, SIL-ROB",
    ALLOW_ORIGIN: "https://landing.example.com",
    CACHE_SECONDS: "60",
  });
});

afterEach(() => {
  process.env = { ...ENV };
  globalThis.fetch = realFetch;
});

function fakeErp(status, data) {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: status >= 200 && status < 300, status, json: async () => data };
  };
}

test("sumBins suma almacenes y descarta filas inválidas", () => {
  assert.deepEqual(
    sumBins([
      { item_code: "MES-NOG", actual_qty: 30 },
      { item_code: "MES-NOG", actual_qty: 12.4 },
      { item_code: "SIL-ROB", actual_qty: -3 },
      { item_code: "X", actual_qty: "abc" },
      null,
    ]),
    [{ sku: "MES-NOG", stock: 42 }, { sku: "SIL-ROB", stock: 0 }]
  );
});

test("binsUrl arma filtros por SKU y almacén", () => {
  const url = new URL(binsUrl("http://erp", ["A", "B"], "Almacén Principal"));
  assert.equal(url.pathname, "/api/resource/Bin");
  assert.deepEqual(JSON.parse(url.searchParams.get("filters")), [
    ["item_code", "in", ["A", "B"]],
    ["warehouse", "=", "Almacén Principal"],
  ]);
  assert.equal(new URL(binsUrl("http://erp", [], "")).searchParams.get("filters"), null);
  assert.deepEqual(parseSkus(" A, ,B "), ["A", "B"]);
});

test("devuelve stock con CORS y autenticación por token", async () => {
  fakeErp(200, { data: [{ item_code: "MES-NOG", actual_qty: 42 }] });
  const res = await handler({ requestContext: { http: { method: "GET" } } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://landing.example.com");
  assert.equal(calls[0].opts.headers.Authorization, "token key:secret");
  const body = JSON.parse(res.body);
  assert.deepEqual(body.products, [{ sku: "MES-NOG", stock: 42 }]);
  assert.ok(body.updatedAt);
});

test("usa la caché en memoria dentro del TTL", async () => {
  fakeErp(200, { data: [{ item_code: "MES-NOG", actual_qty: 1 }] });
  await handler({});
  const second = await handler({});
  assert.equal(calls.length, 1);
  assert.equal(second.headers["X-Cache"], "hit");
});

test("ERP con error: 502 sin filtrar detalles", async () => {
  fakeErp(403, {});
  const res = await handler({});
  assert.equal(res.statusCode, 502);
  assert.deepEqual(JSON.parse(res.body), { error: "No se pudo leer el inventario." });
});

test("sin credenciales: 500 y no llama al ERP", async () => {
  delete process.env.ERP_API_SECRET;
  fakeErp(200, { data: [] });
  const res = await handler({});
  assert.equal(res.statusCode, 500);
  assert.equal(calls.length, 0);
});

test("preflight y métodos no permitidos", async () => {
  assert.equal((await handler({ requestContext: { http: { method: "OPTIONS" } } })).statusCode, 204);
  assert.equal((await handler({ requestContext: { http: { method: "POST" } } })).statusCode, 405);
});
