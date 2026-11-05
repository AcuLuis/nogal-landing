// Servidor estático mínimo para desarrollo local (sin dependencias).
// Uso: node scripts/serve.mjs [puerto]   →   http://localhost:8080
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8080;
  const root = fileURLToPath(new URL("../frontend/", import.meta.url));
  createStaticServer(root).listen(port, "127.0.0.1", () => {
    console.log(`NOGAL en http://localhost:${port}  (Ctrl+C para salir)`);
  });
}
