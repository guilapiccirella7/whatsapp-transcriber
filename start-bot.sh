#!/bin/bash
# Inicia o bot SEM precisar rodar o setup novamente

cd "$(dirname "$0")"

# Adiciona ffmpeg ao PATH
FFMPEG_PATH=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())" 2>/dev/null)
if [ -n "$FFMPEG_PATH" ]; then
  export PATH="$(dirname "$FFMPEG_PATH"):$HOME:$PATH"
fi

# Lê config
if [ ! -f config.json ]; then
  echo "❌ config.json não encontrado. Rode primeiro: node setup.js"
  exit 1
fi

ACCOUNT_SID=$(python3 -c "import json,sys; d=json.load(open('config.json')); print(d['accountSid'])")
AUTH_TOKEN=$(python3  -c "import json,sys; d=json.load(open('config.json')); print(d['authToken'])")
SANDBOX=$(python3     -c "import json,sys; d=json.load(open('config.json')); print(d.get('sandboxNumber',''))")

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   🤖  WhatsApp Transcriber Bot           ║"
echo "╚══════════════════════════════════════════╝"
echo "   Número do Bot: $SANDBOX"
echo ""

# Inicia servidor em background
TWILIO_ACCOUNT_SID="$ACCOUNT_SID" TWILIO_AUTH_TOKEN="$AUTH_TOKEN" node server.js &
SERVER_PID=$!

sleep 2

# Inicia ngrok
echo "🌐 Iniciando túnel ngrok..."
NGROK_BIN="/Users/guilapiccirella/.npm-global/bin/ngrok"
$NGROK_BIN http 3000 &
NGROK_PID=$!

sleep 3

# Pega URL do ngrok
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
  | python3 -c "import sys,json; t=json.load(sys.stdin)['tunnels']; print(next(x['public_url'] for x in t if x['proto']=='https'))" 2>/dev/null)

if [ -n "$NGROK_URL" ]; then
  WEBHOOK="${NGROK_URL}/webhook"
  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║   ✅  BOT ONLINE                                     ║"
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""
  echo "   🔗 Webhook URL:"
  echo "   $WEBHOOK"
  echo ""
  echo "   📋 Cole essa URL em:"
  echo "   console.twilio.com → WhatsApp Sandbox → Sandbox Settings"
  echo "   Campo: WHEN A MESSAGE COMES IN → POST"
  echo ""
  echo "   📱 Número do Bot: $SANDBOX"
  echo "   ⚠️  Mantenha este terminal aberto!"
  echo ""
else
  echo "⚠️  Acesse http://localhost:4040 para ver a URL do ngrok"
fi

# Aguarda
trap "kill $SERVER_PID $NGROK_PID 2>/dev/null; echo 'Bot encerrado.'" EXIT
wait $SERVER_PID
