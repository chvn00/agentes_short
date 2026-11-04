#!/bin/bash
# Arranca el taller en este computador para que el salón entre desde la misma red Wi-Fi.
# Uso:  ./clase.sh        (la primera vez: chmod +x clase.sh)
cd "$(dirname "$0")" || exit 1

# Variables desde .env si existe (los valores con espacios van entre comillas)
if [ -f .env ]; then set -a; . ./.env; set +a; fi

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
PUERTO=${PORT:-3000}

echo
echo "  Taller de Agentes de IA"
echo "  ------------------------"
echo "  En este equipo:     http://localhost:$PUERTO"
[ -n "$IP" ] && echo "  Para el salón:      http://$IP:$PUERTO   (escríbela en la pantalla o hazla QR)"
echo
OLLAMA_MODELOS=$(curl -s -m 2 "${OLLAMA_URL:-http://localhost:11434}/api/tags" | python3 -c "import sys,json; print(', '.join(m['name'] for m in json.load(sys.stdin)['models']))" 2>/dev/null)
if [ -n "$OLLAMA_MODELOS" ]; then echo "  Modelos locales (Ollama): $OLLAMA_MODELOS"; else echo "  ! No encuentro Ollama en este equipo: abre la app de Ollama (los estudiantes solo tendrían Groq)."; fi
[ -z "$ADMIN_USERNAME" ] && echo "  ! Falta ADMIN_USERNAME / ADMIN_PASSWORD en .env: no habrá cuenta de administrador."
[ -z "$APP_SECRET" ]     && echo "  ! Falta APP_SECRET en .env: las sesiones se cerrarán al reiniciar."
[ -z "$DATABASE_URL" ]   && echo "  ! Sin DATABASE_URL: las cuentas viven en memoria y se pierden si apagas el servidor."
echo

# caffeinate evita que el Mac se duerma mientras el servidor corre
exec caffeinate -i node server.js
