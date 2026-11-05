// Servidor estático mínimo para desarrollo local (sin dependencias).
// Uso: node scripts/serve.mjs [puerto] [--open]   →   http://localhost:8080
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

/**
 * Crea el servidor. `routes` permite a las pruebas añadir respuestas
 * simuladas: { "/ruta": (req, res) => {...} }. `headers` se agrega a cada
 * archivo servido (p. ej. la misma CSP que usa CloudFront).
 */
export function createStaticServer(root, routes = {}, headers = {}) {
  const base = resolve(root);
  return createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (routes[path]) return routes[path](req, res);

    let file = normalize(join(base, path));
    if (file !== base && !file.startsWith(base + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
        ...headers,
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("No encontrado");
    }
  });
}

function openBrowser(url) {
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  try { spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref(); }
  catch { /* sin navegador: basta con la URL en consola */ }
}

/* Uso: node scripts/serve.mjs [puerto] [--open]
   Si el puerto está ocupado prueba los 10 siguientes. --open abre el
   navegador (se omite si NOGAL_NO_OPEN está definido). */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const first = Number(args.find((a) => /^\d+$/.test(a))) || 8080;
  const shouldOpen = args.includes("--open") && !process.env.NOGAL_NO_OPEN;
  const root = fileURLToPath(new URL("../frontend/", import.meta.url));

  const tryListen = (port) => {
    const server = createStaticServer(root);
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE" && port < first + 10) {
        console.log(`El puerto ${port} está ocupado, probando ${port + 1}…`);
        tryListen(port + 1);
      } else {
        console.error(`No se pudo iniciar el servidor: ${err.message}`);
        process.exit(1);
      }
    });
    server.listen(port, "127.0.0.1", () => {
      const url = `http://localhost:${port}`;
      console.log(`\nNOGAL está corriendo en ${url}`);
      console.log("Cierra esta ventana o pulsa Ctrl+C para detenerlo.\n");
      if (shouldOpen) openBrowser(url);
    });
  };
  tryListen(first);
}
