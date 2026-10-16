#!/bin/sh
# Inicia la tienda en tu computadora (Mac / Linux). Uso:  sh iniciar.sh
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Falta instalar Node.js (https://nodejs.org, version LTS)."; exit 1; }
[ -f .env ] || { cp .env.example .env; echo "Se creó .env con los datos de ejemplo."; }
[ -d node_modules ] || npm install || exit 1
echo "Tienda: http://localhost:3000   Panel: http://localhost:3000/admin.html  (usuario admin / clave cambiaesta123)"
(command -v open >/dev/null && open http://localhost:3000) || (command -v xdg-open >/dev/null && xdg-open http://localhost:3000) || true
node server.js
