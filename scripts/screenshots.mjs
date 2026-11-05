// Regenera las capturas del README en docs/screenshots/.
// Uso: npm run screenshots              (sitio local)
//      SITE_URL=https://... npm run screenshots   (sitio desplegado)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "./serve.mjs";
import { launchBrowser, sleep } from "../tests/cdp.mjs";

const out = fileURLToPath(new URL("../docs/screenshots/", import.meta.url));
mkdirSync(out, { recursive: true });

let server = null;
let BASE = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, "/") : "";
if (!BASE) {
  server = createStaticServer(fileURLToPath(new URL("../frontend/", import.meta.url)));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  BASE = `http://127.0.0.1:${server.address().port}/`;
}

const b = await launchBrowser({ port: 9335 });
const { ev } = b;
const NAV = 72;

// Las animaciones de aparición se completan antes de capturar.
const revealAll = () => ev(`document.querySelectorAll('.reveal').forEach(e => e.classList.add('in')); true`);
async function shot(name) { await b.screenshot(join(out, name)); console.log("  " + name); }
async function showSection(sel, offset = NAV) {
  const h = await ev(`document.querySelector('${sel}').offsetHeight`);
  await b.viewport(1440, Math.max(820, h + NAV));
  await ev(`window.scrollTo(0, document.querySelector('${sel}').offsetTop - ${offset}); true`);
  await revealAll();
  await sleep(900);
}
async function ask(input, form, text) {
  await ev(`(() => { ${input}.value = ${JSON.stringify(text)}; ${form}.requestSubmit(); return true; })()`);
  await sleep(1300);
}

try {
  console.log("Capturando " + BASE);
  await b.viewport(1440, 900);
  await b.goto(BASE);
  await ev(`sessionStorage.clear(); true`);
  await b.goto(BASE);
  await revealAll(); await sleep(900);
  await shot("01-inicio.png");

  await showSection("#sistema");
  await shot("02-como-trabajamos.png");

  await ask("demoInput", "demoForm", "¿Cuántos tablones de roble quedan?");
  await ask("demoInput", "demoForm", "Pedidos pendientes de hoy");
  await showSection("#asistente");
  await shot("03-asistente.png");
  await ev(`demoReset.click(); true`);

  await showSection("#catalogo");
  await shot("04-catalogo.png");
  await ev(`document.querySelectorAll('#catalogGrid .card-ask')[2].click(); true`);
  await sleep(1400);
  await shot("05-widget-flotante.png");
  await ev(`fabClose.click(); demoReset.click(); true`);
  await sleep(400);

  await showSection("#acceso");
  await shot("06-acceso-erp.png");

  await showSection("#contacto", 8);
  await ev(`contactForm.requestSubmit(); window.scrollTo(0, document.querySelector('#contacto').offsetTop - 8); true`);
  await sleep(400);
  await shot("07-contacto.png");

  await b.viewport(390, 844, true, 2);
  await b.goto(BASE);
  await revealAll(); await sleep(900);
  await shot("08-movil-inicio.png");
  await ev(`fab.click(); true`);
  await sleep(400);
  await ask("fabInput", "fabForm", "Stock de sillas de roble");
  await shot("09-movil-chat.png");
  await ev(`demoReset.click(); true`);
} finally {
  await b.close();
  if (server) server.close();
}
