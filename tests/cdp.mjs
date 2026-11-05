// Control mínimo de Chrome/Edge vía DevTools Protocol, sin dependencias.
// Requiere Node 22+ (WebSocket global) y Chrome, Chromium o Edge instalado.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchBrowser({ port = 9333 } = {}) {
  const bin = CANDIDATES.find((p) => p && existsSync(p));
  if (!bin) throw new Error("No se encontró Chrome/Edge. Define CHROME_PATH con la ruta del navegador.");
  if (typeof WebSocket === "undefined") throw new Error("Se necesita Node 22 o superior.");

  const profile = mkdtempSync(join(tmpdir(), "nogal-e2e-"));
  const proc = spawn(bin, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
    "--force-color-profile=srgb", "about:blank",
  ], { stdio: "ignore" });

  let targets;
  for (let i = 0; i < 75 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
    catch { await sleep(200); }
  }
  if (!targets) { proc.kill(); throw new Error("El navegador no respondió."); }

  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let seq = 0;
  const pending = new Map();
  const waiters = [];
  const problems = [];

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      problems.push("excepción: " + (d.exception?.description || d.text));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      problems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
    }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      problems.push("log: " + m.params.entry.text + " " + (m.params.entry.url || ""));
    }
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].method === m.method) { waiters[i].res(m.params); waiters.splice(i, 1); }
    }
  };

  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const once = (method) => new Promise((res) => waiters.push({ method, res }));

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");

  const api = {
    problems,
    send,
    async ev(expression) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    viewport(width, height, mobile = false, dpr = 1) {
      return send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile });
    },
    async goto(url) {
      const loaded = once("Page.loadEventFired");
      await send("Page.navigate", { url });
      await loaded;
      await api.ev("document.fonts.ready.then(() => true)");
      await sleep(300);
    },
    async addInitScript(source) {
      return (await send("Page.addScriptToEvaluateOnNewDocument", { source })).identifier;
    },
    removeInitScript(identifier) {
      return send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    },
    async screenshot(file) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(file, Buffer.from(r.data, "base64"));
    },
    async close() {
      try { ws.close(); } catch { /* ya cerrado */ }
      proc.kill();
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* archivos en uso */ }
    },
  };
  return api;
}
