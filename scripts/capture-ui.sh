#!/usr/bin/env bash
# Captura screenshots del UI de Projex usando agent-browser.
# Requiere: dev server corriendo (npm run dev) + sesión Clerk iniciada
# en la instancia de Chrome que maneja agent-browser.
#
# Uso:
#   1. npm run dev   (en otra terminal)
#   2. npx agent-browser open http://localhost:3000/sign-in
#   3. Inicia sesión manualmente en la ventana que se abre
#   4. bash scripts/capture-ui.sh
#
# Los screenshots quedan en docs/screenshots/.

set -e
BASE="http://localhost:3000"
OUT="docs/screenshots"
mkdir -p "$OUT"

capture() {
  local path="$1"
  local name="$2"
  echo "→ $path"
  npx agent-browser open "$BASE$path" >/dev/null
  sleep 2
  npx agent-browser screenshot "$OUT/$name.png" >/dev/null
}

# Públicas (no requieren login)
capture "/sign-in"              "01-sign-in"
capture "/q/invalid-token-demo" "03-q-not-found"

# Autenticadas (requieren sesión iniciada)
capture "/"                     "10-dashboard"
capture "/clientes"             "20-clientes-list"
capture "/clientes/nuevo"       "21-clientes-nuevo"
capture "/proyecciones"         "30-proyecciones-list"
capture "/proyecciones/nueva"   "31-proyecciones-nueva-paso-1"
capture "/cuestionarios"        "40-cuestionarios-list"
capture "/cotizaciones"         "50-cotizaciones-list"
capture "/contratos"            "60-contratos-list"
capture "/entregables"          "70-entregables-list"
capture "/facturacion"          "80-facturacion"
capture "/servicios"            "90-servicios"
capture "/configuracion"        "95-configuracion"

# Super Admin (opcional)
capture "/platform"             "A0-platform"
capture "/platform/templates"   "A1-platform-templates"
capture "/platform/servicios"   "A2-platform-servicios"

echo ""
echo "✓ Capturas guardadas en $OUT/"
echo "  Refresca docs/guia-de-uso.html para ver los screenshots actualizados."
