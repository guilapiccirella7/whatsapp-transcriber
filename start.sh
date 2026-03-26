#!/bin/bash
# ── WhatsApp Transcriber Bot ────────────────────────────────
# Execute: bash ~/whatsapp-transcriber/start.sh

cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   🎙  WhatsApp Transcriber Bot           ║"
echo "║   Powered by Whisper + whatsapp-web.js   ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Add ffmpeg to PATH
FFMPEG_PATH=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())" 2>/dev/null)
if [ -n "$FFMPEG_PATH" ]; then
  export PATH="$(dirname "$FFMPEG_PATH"):$HOME:$PATH"
  echo "✅ ffmpeg encontrado: $FFMPEG_PATH"
fi

echo "🚀 Iniciando bot..."
echo ""
node bot.js
