#!/usr/bin/env bash
# =============================================================================
# NOGAL — Despliegue del frontend a S3 + CloudFront (se ejecuta en local)
#
# Requisitos: AWS CLI v2 configurado (aws configure) y bash.
#
# Variables:
#   BUCKET           bucket de S3 destino                       (requerida)
#   DISTRIBUTION_ID  distribución de CloudFront a invalidar     (opcional)
#   SITE_URL         URL pública del sitio, p. ej.
#                    https://d123.cloudfront.net — vuelve absolutas las URLs
#                    de Open Graph y genera sitemap.xml          (recomendada)
#   DRY_RUN=1        muestra qué se subiría, sin subir nada
#   OUT_DIR=ruta     solo prepara la versión final en esa carpeta y termina
#
# Ejemplo:
#   BUCKET=nogal-landing DISTRIBUTION_ID=E1ABC SITE_URL=https://d123.cloudfront.net \
#     ./scripts/deploy.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/frontend"

if [ -n "${OUT_DIR:-}" ]; then
  BUILD="$OUT_DIR"
  rm -rf "$BUILD"
  mkdir -p "$BUILD"
else
  : "${BUCKET:?Define BUCKET con el nombre del bucket de S3}"
  BUILD="$(mktemp -d)"
  trap 'rm -rf "$BUILD"' EXIT
fi

echo "› Preparando archivos"
cp -R "$SRC/." "$BUILD/"

if [ -n "${SITE_URL:-}" ]; then
  SITE_URL="${SITE_URL%/}"
  sed -i.bak \
    -e "s|content=\"assets/og-image.png\"|content=\"$SITE_URL/assets/og-image.png\"|" \
    -e "s|\"logo\": \"assets/icon-512.png\"|\"logo\": \"$SITE_URL/assets/icon-512.png\", \"url\": \"$SITE_URL/\"|" \
    -e "s|<meta property=\"og:type\" content=\"website\" />|<meta property=\"og:type\" content=\"website\" /> <meta property=\"og:url\" content=\"$SITE_URL/\" /> <link rel=\"canonical\" href=\"$SITE_URL/\" />|" \
    "$BUILD/index.html"
  rm -f "$BUILD/index.html.bak"

  printf 'Sitemap: %s/sitemap.xml\n' "$SITE_URL" >> "$BUILD/robots.txt"
  cat > "$BUILD/sitemap.xml" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>$SITE_URL/</loc><lastmod>$(date +%Y-%m-%d)</lastmod></url>
</urlset>
EOF
else
  echo "  (sin SITE_URL: og:image queda relativa y no se genera sitemap.xml)"
fi

if [ -n "${OUT_DIR:-}" ]; then
  echo "✓ Versión final lista en $BUILD"
  exit 0
fi

DRY=()
[ "${DRY_RUN:-}" = "1" ] && DRY=(--dryrun)
DEST="s3://$BUCKET"

# Caché: fuentes inmutables; imágenes una semana; CSS/JS una hora (no llevan
# hash en el nombre); HTML, configuración y metadatos siempre revalidados.
echo "› Subiendo a $DEST"
aws s3 sync "$BUILD/fonts"  "$DEST/fonts"  --delete "${DRY[@]}" --cache-control "public, max-age=31536000, immutable"
aws s3 sync "$BUILD/assets" "$DEST/assets" --delete "${DRY[@]}" --cache-control "public, max-age=604800"
aws s3 sync "$BUILD/css"    "$DEST/css"    --delete "${DRY[@]}" --cache-control "public, max-age=3600"
aws s3 sync "$BUILD/js"     "$DEST/js"     --delete "${DRY[@]}" --cache-control "public, max-age=3600" --exclude "config.js"

nocache="no-cache, must-revalidate"
aws s3 cp "$BUILD/js/config.js"      "$DEST/js/config.js"      "${DRY[@]}" --cache-control "$nocache" --content-type "text/javascript; charset=utf-8"
aws s3 cp "$BUILD/index.html"        "$DEST/index.html"        "${DRY[@]}" --cache-control "$nocache" --content-type "text/html; charset=utf-8"
aws s3 cp "$BUILD/site.webmanifest"  "$DEST/site.webmanifest"  "${DRY[@]}" --cache-control "$nocache" --content-type "application/manifest+json"
aws s3 cp "$BUILD/robots.txt"        "$DEST/robots.txt"        "${DRY[@]}" --cache-control "$nocache" --content-type "text/plain; charset=utf-8"
if [ -f "$BUILD/sitemap.xml" ]; then
  aws s3 cp "$BUILD/sitemap.xml"     "$DEST/sitemap.xml"       "${DRY[@]}" --cache-control "$nocache" --content-type "application/xml"
fi

if [ -n "${DISTRIBUTION_ID:-}" ] && [ "${DRY_RUN:-}" != "1" ]; then
  echo "› Invalidando CloudFront ($DISTRIBUTION_ID)"
  aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" >/dev/null
fi

echo "✓ Despliegue terminado"
