import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHandler, validate, buildEmail, createLimiter } from "./index.mjs";

const ENV = { ...process.env };
let sent;
let handler;

const ok = {
  name: "María López — Amoblados del Sur",
  email: "maria@amoblados.pe",
  interest: "Mesas",
  message: "Necesitamos 40 mesas para marzo.",
};

function post(body, extra = {}) {
  return {
    requestContext: { http: { method: "POST", sourceIp: extra.ip || "1.1.1.1" } },
    headers: { Origin: extra.origin || "https://landing.example.com", "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

beforeEach(() => {
  Object.assign(process.env, {
    CONTACT_TO: "ventas@example.com",
    CONTACT_FROM: "no-reply@example.com",
    ALLOW_ORIGIN: "https://landing.example.com",
    RATE_LIMIT: "2",
  });
  sent = [];
  handler = createHandler({ send: async (p) => { sent.push(p); } });
});

afterEach(() => { process.env = { ...ENV }; });

test("validate limpia saltos de línea en campos de una línea", () => {
  const { data, errors } = validate({ ...ok, name: "Ana\r\nBcc: otro@x.com" });
  assert.deepEqual(errors, {});
  assert.equal(data.name, "Ana Bcc: otro@x.com");
});

test("validate rechaza datos inválidos", () => {
  const { errors } = validate({ name: "A", email: "x@y", interest: "Armas", message: "x".repeat(2001) });
  assert.deepEqual(Object.keys(errors).sort(), ["email", "interest", "message", "name"]);
});

test("buildEmail usa reply-to del cliente y asunto con interés", () => {
  const mail = buildEmail(validate(ok).data, { to: "v@x.com", from: "n@x.com" });
  assert.deepEqual(mail.ReplyToAddresses, ["maria@amoblados.pe"]);
  assert.match(mail.Content.Simple.Subject.Data, /^Nueva solicitud: Mesas — María/);
  assert.match(mail.Content.Simple.Body.Text.Data, /40 mesas/);
});

test("envío correcto: 200 y un correo", async () => {
  const res = await handler(post(ok));
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://landing.example.com");
});

test("campo trampa: 200 sin enviar", async () => {
  const res = await handler(post({ ...ok, website: "http://spam" }));
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 0);
});

test("datos inválidos: 400 con detalle por campo", async () => {
  const res = await handler(post({ ...ok, email: "no-es-correo" }));
  assert.equal(res.statusCode, 400);
  assert.ok(JSON.parse(res.body).fields.email);
});

test("JSON roto, cuerpo enorme y origen ajeno", async () => {
  assert.equal((await handler(post("{"))).statusCode, 400);
  assert.equal((await handler(post({ ...ok, message: "x".repeat(20000) }))).statusCode, 413);
  assert.equal((await handler(post(ok, { origin: "https://otro.com" }))).statusCode, 403);
  assert.equal(sent.length, 0);
});

test("límite por IP: 429 al superar RATE_LIMIT", async () => {
  assert.equal((await handler(post(ok, { ip: "9.9.9.9" }))).statusCode, 200);
  assert.equal((await handler(post(ok, { ip: "9.9.9.9" }))).statusCode, 200);
  assert.equal((await handler(post(ok, { ip: "9.9.9.9" }))).statusCode, 429);
  assert.equal((await handler(post(ok, { ip: "8.8.8.8" }))).statusCode, 200);
});

test("createLimiter libera la ventana con el tiempo", () => {
  const allow = createLimiter(1, 1000);
  assert.ok(allow("a", 0));
  assert.ok(!allow("a", 500));
  assert.ok(allow("a", 1500));
});

test("fallo de SES: 502", async () => {
  const failing = createHandler({ send: async () => { throw new Error("MessageRejected"); } });
  assert.equal((await failing(post(ok))).statusCode, 502);
});

test("preflight y método no permitido", async () => {
  assert.equal((await handler({ requestContext: { http: { method: "OPTIONS" } } })).statusCode, 204);
  assert.equal((await handler({ requestContext: { http: { method: "GET" } } })).statusCode, 405);
});
