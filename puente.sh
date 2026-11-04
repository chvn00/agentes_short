#!/bin/bash
# Publica los modelos de Ollama de este Mac para que el taller en Railway los use.
# Uso:  ./puente.sh      (necesita cloudflared:  brew install cloudflared)
cd "$(dirname "$0")" || exit 1
command -v cloudflared >/dev/null || { echo "Falta cloudflared. Instálalo con:  brew install cloudflared"; exit 1; }
curl -s -m 2 http://127.0.0.1:11434/api/tags >/dev/null || { echo "No encuentro Ollama en este Mac: ábrelo primero."; exit 1; }

[ -f .puente-token ] || node -e "console.log(require('crypto').randomBytes(24).toString('hex'))" > .puente-token
export PUENTE_TOKEN=$(cat .puente-token)
PUERTO=${PUENTE_PORT:-11435}; export PUENTE_PORT=$PUERTO

node puente-ollama.js &
PUENTE_PID=$!
cloudflared tunnel --url "http://127.0.0.1:$PUERTO" > /tmp/cloudflared-taller.log 2>&1 &
TUNEL_PID=$!
trap 'kill $PUENTE_PID $TUNEL_PID 2>/dev/null' EXIT INT TERM

URL=""
for i in $(seq 1 40); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/cloudflared-taller.log | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
[ -z "$URL" ] && { echo "No pude abrir el túnel. Revisa /tmp/cloudflared-taller.log"; exit 1; }

echo
echo "  Puente listo. En Railway, en las Variables del servicio web, pon:"
echo
echo "    OLLAMA_URL=$URL"
echo "    OLLAMA_TOKEN=$PUENTE_TOKEN"
echo
echo "  Guarda y espera a que Railway reinicie. Deja esta ventana abierta durante la clase (Ctrl+C la cierra)."
echo "  Nota: esta dirección cambia cada vez que reinicias el túnel."
echo
wait $TUNEL_PID
