import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handler, scopeCookie, isAllowedOrigin } from "./index.mjs";

const ENV = { ...process.env };
const realFetch = globalThis.fetch;

beforeEach(() => {
  Object.assign(process.env, {
    ERP_URL: "http://erp.example.com/",
    ERP_USERNAME: "demo@example.com",
    ERP_PASSWORD: "secret",
    COOKIE_DOMAIN: ".example.com",
    ALLOW_ORIGIN: "https://landing.example.com",
  });
});

afterEach(() => {
  process.env = { ...ENV };
  globalThis.fetch = realFetch;
});

function fakeErp(status, cookies) {
  globalThis.fetch = async () => ({
    status,
    headers: { getSetCookie: () => cookies, get: () => null },
  });
}

const fromLanding = { headers: { Referer: "https://landing.example.com/" } };

test("scopeCookie reemplaza el dominio existente", () => {
  assert.equal(
    scopeCookie("sid=abc; Domain=erp.example.com; Path=/; HttpOnly", ".example.com"),
    "sid=abc; Path=/; HttpOnly; Domain=.example.com"
  );
  assert.equal(scopeCookie("sid=abc; Path=/", ""), "sid=abc; Path=/");
});

test("isAllowedOrigin acepta el origen exacto y rechaza dominios parecidos", () => {
  const allow = "https://landing.example.com";
  assert.ok(isAllowedOrigin({ Origin: allow }, allow));
  assert.ok(isAllowedOrigin({ referer: allow + "/#acceso" }, allow));
  assert.ok(!isAllowedOrigin({ referer: "https://landing.example.com.evil.io/" }, allow));
  assert.ok(!isAllowedOrigin({}, allow));
  assert.ok(isAllowedOrigin({}, ""));
});

test("login correcto: 302 al ERP con cookies en el dominio compartido", async () => {
  fakeErp(200, ["sid=abc; Path=/; HttpOnly"]);
  const res = await handler(fromLanding);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, "http://erp.example.com/app");
  assert.deepEqual(res.cookies, ["sid=abc; Path=/; HttpOnly; Domain=.example.com"]);
});

test("credenciales rechazadas: redirige al login normal", async () => {
  fakeErp(401, []);
  const res = await handler(fromLanding);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, "http://erp.example.com/login");
  assert.deepEqual(res.cookies, []);
});

test("ERP caído: redirige al login normal", async () => {
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
  const res = await handler(fromLanding);
  assert.equal(res.headers.Location, "http://erp.example.com/login");
});

test("origen no permitido: no intenta iniciar sesión", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const res = await handler({ headers: { referer: "https://otro-sitio.com/" } });
  assert.equal(called, false);
  assert.equal(res.headers.Location, "http://erp.example.com/login");
});

test("método no soportado: 405", async () => {
  const res = await handler({ requestContext: { http: { method: "DELETE" } } });
  assert.equal(res.statusCode, 405);
});
