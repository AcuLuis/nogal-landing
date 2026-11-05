// Pruebas de extremo a extremo de la landing en un navegador real (local).
// Uso: npm run test:e2e
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "../scripts/serve.mjs";
import { launchBrowser, sleep } from "./cdp.mjs";

const root = fileURLToPath(new URL("../frontend/", import.meta.url));

// Respuestas simuladas de los servicios externos.
const json = (status, body) => (req, res) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const server = createStaticServer(root, {
  "/__test/catalog": json(200, { products: [{ sku: "MES-NOG", stock: 5 }, { sku: "DESCONOCIDO", stock: 3 }] }),
  "/__test/contact-400": json(400, { error: "Datos inválidos.", fields: { email: "Correo inválido." } }),
  "/__test/contact-429": json(429, { error: "Demasiadas solicitudes." }),
  "/__test/contact-ok": json(200, { ok: true }),
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const b = await launchBrowser();
const { ev } = b;
let failed = 0;
function check(name, ok, info = "") {
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FALLA"} ${name}${!ok && info ? "  → " + info : ""}`);
}
const lastMsg = (log) => ev(`document.querySelector('#${log} .msg:last-child').textContent`);
async function ask(text) {
  await ev(`(() => { demoInput.value = ${JSON.stringify(text)}; demoForm.requestSubmit(); return true; })()`);
  await sleep(1200);
}
// Ajusta NOGAL_CONFIG antes de que se ejecute main.js.
function configOverride(patch) {
  return `(() => {
    let cfg;
    Object.defineProperty(window, "NOGAL_CONFIG", {
      configurable: true,
      get() { return cfg; },
      set(v) { cfg = Object.assign(v, ${JSON.stringify(patch)}); }
    });
  })();`;
}

try {
  console.log("\nPágina y recursos");
  await b.viewport(1440, 900);
  await b.goto(BASE);
  check("6 tarjetas en el catálogo", (await ev(`document.querySelectorAll('#catalogGrid .card').length`)) === 6);
  check("1 producto con stock bajo", (await ev(`document.querySelectorAll('#catalogGrid .stock.low').length`)) === 1);
  check("fuentes locales cargadas", await ev(`document.fonts.check('600 20px Fraunces') && document.fonts.check('400 16px Inter') && [...document.fonts].some(f => f.family.includes('Fraunces') && f.status === 'loaded')`));
  check("sin peticiones a Google Fonts", await ev(`!performance.getEntriesByType('resource').some(r => r.name.includes('fonts.g'))`));
  check("manifest, robots e iconos disponibles", await ev(`Promise.all(['site.webmanifest','robots.txt','assets/og-image.png','assets/apple-touch-icon.png','assets/favicon-32.png'].map(u => fetch(u).then(r => r.ok))).then(a => a.every(Boolean))`));
  check("JSON-LD válido", await ev(`JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@type'] === 'Organization'`));
  check("sin estilos inline (compatible con CSP)", await ev(`document.querySelectorAll('[style]').length === 0`));

  console.log("\nAsistente");
  check("panel flotante cerrado es inert", await ev(`fabPanel.inert === true`));
  await ask("¿Cuántos tablones de roble quedan?");
  check("responde stock de tablones", (await lastMsg("demoLog")).includes("1,240"));
  check("conversación compartida con el widget", (await ev(`document.querySelectorAll('#fabLog .msg').length`)) === 3);
  await ask("COMODA");
  check("ignora tildes y mayúsculas", (await lastMsg("demoLog")).includes("38"));
  await ask("¿qué hay que reponer?");
  check("lista productos por reponer", (await lastMsg("demoLog")).includes("COM-CED"));

  const users = await ev(`document.querySelectorAll('#demoLog .msg.user').length`);
  await ev(`(() => { demoInput.value = 'mesa'; demoForm.requestSubmit(); demoInput.value = 'silla'; demoForm.requestSubmit(); return true; })()`);
  check("botón deshabilitado mientras responde", await ev(`demoForm.querySelector('.chat-send').disabled`));
  await sleep(1300);
  check("sin envíos en paralelo", (await ev(`document.querySelectorAll('#demoLog .msg.user').length`)) === users + 1);

  await b.goto(BASE);
  check("historial persiste al recargar", (await ev(`document.querySelectorAll('#demoLog .msg.user').length`)) === users + 1);
  check("badge oculto con historial", await ev(`document.querySelector('#fab .badge').hidden`));
  await ev(`demoReset.click(); true`);
  check("nueva conversación limpia ambos chats", (await ev(`document.querySelectorAll('#demoLog .msg, #fabLog .msg').length`)) === 2);

  const known = b.problems.length;
  await ev(`NOGAL_CONFIG.chatWebhookUrl = 'data:application/json,' + encodeURIComponent(JSON.stringify({ reply: '<img src=x onerror="window.__pwned=1"> **ok**' })); true`);
  await ask("hola");
  check("HTML remoto escapado (sin XSS)", await ev(`!document.querySelector('#demoLog img') && !window.__pwned && document.querySelector('#demoLog .msg:last-child strong')?.textContent === 'ok'`));
  await ev(`NOGAL_CONFIG.chatWebhookUrl = '${BASE}__test/no-existe'; true`);
  await ask("hola");
  check("webhook con error muestra aviso", await ev(`document.querySelector('#demoLog .msg:last-child').classList.contains('error')`));
  b.problems.length = known; // errores provocados a propósito
  await ev(`NOGAL_CONFIG.chatWebhookUrl = ''; demoReset.click(); true`);

  await ev(`document.querySelector('#catalogGrid .card-ask').click(); true`);
  await sleep(1300);
  check("'Consultar' abre el widget", await ev(`fabPanel.classList.contains('open') && !fabPanel.inert`));
  check("'Consultar' pregunta por el producto", (await lastMsg("fabLog")).includes("MES-NOG"));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);
  check("Esc cierra el widget", await ev(`!fabPanel.classList.contains('open')`));
  await ev(`demoReset.click(); true`);

  console.log("\nFormulario de contacto");
  await ev(`contactForm.requestSubmit(); true`);
  check("marca campos vacíos", await ev(`cName.getAttribute('aria-invalid') === 'true' && cEmailError.textContent.length > 0`));
  check("enfoca el primer error", await ev(`document.activeElement.id === 'cName'`));
  await ev(`(() => { cName.value = 'María López — Amoblados del Sur'; cEmail.value = 'maria@amoblados'; contactForm.requestSubmit(); return true; })()`);
  check("rechaza correo sin dominio", await ev(`cEmail.getAttribute('aria-invalid') === 'true' && cName.getAttribute('aria-invalid') === 'false'`));
  await ev(`(() => { cEmail.value = 'maria@amoblados.pe'; contactForm.requestSubmit(); return true; })()`);
  check("confirmación en modo demo", (await ev(`contactStatus.textContent`)).startsWith("¡Gracias, María!"));

  const fill = `cName.value = 'María López'; cEmail.value = 'maria@amoblados.pe';`;
  const before = b.problems.length;
  await ev(`(() => { NOGAL_CONFIG.contactEndpoint = '${BASE}__test/contact-400'; ${fill} contactForm.requestSubmit(); return true; })()`);
  await sleep(500);
  check("error 400 del servidor se marca en el campo", await ev(`cEmail.getAttribute('aria-invalid') === 'true' && contactStatus.classList.contains('is-error')`));
  await ev(`(() => { NOGAL_CONFIG.contactEndpoint = '${BASE}__test/contact-429'; ${fill} contactForm.requestSubmit(); return true; })()`);
  await sleep(500);
  check("límite 429 con mensaje propio", (await ev(`contactStatus.textContent`)).includes("varias solicitudes"));
  b.problems.length = before; // 400/429 provocados a propósito
  await ev(`(() => { NOGAL_CONFIG.contactEndpoint = '${BASE}__test/contact-ok'; ${fill} contactForm.requestSubmit(); return true; })()`);
  await sleep(500);
  check("envío al endpoint correcto", await ev(`contactStatus.classList.contains('is-success') && !contactForm.querySelector('[type=submit]').disabled`));

  console.log("\nCatálogo en vivo");
  const id = await b.addInitScript(configOverride({ catalogEndpoint: "/__test/catalog" }));
  await b.goto(BASE);
  await sleep(300);
  check("fusiona stock remoto por SKU", (await ev(`document.querySelector('#catalogGrid .stock').textContent`)).includes("Stock bajo · 5"));
  check("ignora SKU desconocido sin ficha", (await ev(`document.querySelectorAll('#catalogGrid .card').length`)) === 6);
  check("indica hora de sincronización", (await ev(`catalogNote.textContent`)).startsWith("Stock sincronizado"));
  await ask("stock de mesas");
  check("el asistente usa el stock remoto", (await lastMsg("demoLog")).includes("5 unidades"));
  await ev(`demoReset.click(); true`);
  await b.removeInitScript(id);

  console.log("\nCabeceras de seguridad (misma CSP que CloudFront)");
  const policy = JSON.parse(readFileSync(new URL("../infra/cloudfront-security-headers.json", import.meta.url), "utf8"));
  const csp = policy.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
  const secure = createStaticServer(root, {}, { "Content-Security-Policy": csp });
  await new Promise((r) => secure.listen(0, "127.0.0.1", r));
  const cspId = await b.addInitScript(`window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));`);
  await b.goto(`http://127.0.0.1:${secure.address().port}/`);
  await ask("stock de sillas");
  const violations = await ev(`window.__csp`);
  check("la página funciona sin violaciones de CSP", violations.length === 0, violations.join(" | "));
  check("con CSP: catálogo y chat operativos", (await ev(`document.querySelectorAll('#catalogGrid .card').length`)) === 6 && (await lastMsg("demoLog")).includes("SIL-ROB"));
  await ev(`demoReset.click(); true`);
  await b.removeInitScript(cspId);
  secure.close();

  console.log("\nMóvil");
  await b.viewport(390, 844, true, 2);
  await b.goto(BASE);
  await ev(`navToggle.click(); true`);
  check("menú abre", await ev(`mobileMenu.classList.contains('open') && navToggle.getAttribute('aria-expanded') === 'true'`));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);
  check("Esc cierra el menú", await ev(`!mobileMenu.classList.contains('open')`));
  await ev(`navToggle.click(); document.body.click(); true`);
  check("clic fuera cierra el menú", await ev(`!mobileMenu.classList.contains('open')`));
  check("sin desbordamiento horizontal", await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));

  console.log("");
  check("sin errores en consola", b.problems.length === 0, b.problems.join(" | "));
} catch (err) {
  failed++;
  console.error("\nError inesperado:", err);
} finally {
  await b.close();
  server.close();
}

console.log(failed ? `\n${failed} prueba(s) fallaron.` : "\nTodas las pruebas pasaron.");
process.exit(failed ? 1 : 0);
