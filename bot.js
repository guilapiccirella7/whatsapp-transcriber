const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const PYTHON_BIN = 'python3';
const TRANSCRIBE_SCRIPT = path.join(__dirname, 'transcribe.py');
const TMP_DIR = os.tmpdir();

// Only respond to messages from yourself (self-bot) OR from anyone (open bot).
// Set to true to only transcribe your own audios sent to yourself.
const SELF_ONLY = false;
// ─────────────────────────────────────────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

// ── QR CODE ──────────────────────────────────────────────────────────────────
client.on('qr', (qr) => {
  console.log('\n📱 Escaneie o QR Code abaixo com o WhatsApp:\n');
  qrcode.generate(qr, { small: true });
});

// ── READY ────────────────────────────────────────────────────────────────────
client.on('ready', () => {
  console.log('\n✅ Bot conectado ao WhatsApp! Aguardando áudios...\n');
});

// ── AUTH FAILURE ─────────────────────────────────────────────────────────────
client.on('auth_failure', (msg) => {
  console.error('❌ Falha de autenticação:', msg);
});

// ── MESSAGE HANDLER ───────────────────────────────────────────────────────────
client.on('message', async (message) => {
  const isAudio = message.type === 'ptt' || message.type === 'audio';
  if (!isAudio) return;

  const chatId = message.from;
  const chat = await message.getChat();

  console.log(`\n🎙  Áudio recebido de: ${chatId}`);

  // 1. Acknowledge immediately
  await chat.sendMessage('🎙 *Recebi seu áudio e vou transcrever!*\nAguarde um momento...');

  // 2. Download audio
  let audioPath;
  try {
    const media = await message.downloadMedia();
    const ext = media.mimetype.includes('ogg') ? '.ogg'
               : media.mimetype.includes('opus') ? '.opus'
               : media.mimetype.includes('mp4') ? '.mp4'
               : '.audio';

    audioPath = path.join(TMP_DIR, `wa_audio_${Date.now()}${ext}`);
    fs.writeFileSync(audioPath, Buffer.from(media.data, 'base64'));
    console.log(`   💾 Áudio salvo: ${audioPath}`);
  } catch (err) {
    console.error('   ❌ Erro ao baixar áudio:', err.message);
    await chat.sendMessage('❌ Não consegui baixar o áudio. Tente novamente.');
    return;
  }

  // 3. Transcribe via Python + Whisper
  transcribeAudio(audioPath, async (err, result) => {
    // Clean up temp file
    try { fs.unlinkSync(audioPath); } catch (_) {}

    if (err || result.error) {
      console.error('   ❌ Erro na transcrição:', err || result.error);
      await chat.sendMessage('❌ Ocorreu um erro na transcrição. Tente novamente.');
      return;
    }

    const { transcription, summary } = result;
    console.log(`   ✅ Transcrição concluída (${transcription.length} chars)`);

    // 4. Send full transcription
    const transcriptionMsg =
      `📝 *TRANSCRIÇÃO COMPLETA*\n\n${transcription}`;

    // 5. Send summary
    const summaryMsg =
      `📌 *RESUMO*\n\n${summary}`;

    // WhatsApp has a ~65k char limit per message; chunk if needed
    for (const chunk of splitMessage(transcriptionMsg)) {
      await chat.sendMessage(chunk);
    }
    await chat.sendMessage(summaryMsg);
  });
});

// ── HELPERS ───────────────────────────────────────────────────────────────────

function transcribeAudio(audioPath, callback) {
  execFile(
    PYTHON_BIN,
    [TRANSCRIBE_SCRIPT, audioPath],
    { maxBuffer: 10 * 1024 * 1024, timeout: 5 * 60 * 1000 }, // 5 min timeout
    (err, stdout, stderr) => {
      if (err) {
        return callback(err, null);
      }
      try {
        const result = JSON.parse(stdout);
        callback(null, result);
      } catch (parseErr) {
        console.error('   ⚠️  stdout raw:', stdout.slice(0, 500));
        callback(parseErr, null);
      }
    }
  );
}

function splitMessage(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return parts;
}

// ── START ─────────────────────────────────────────────────────────────────────
console.log('🚀 Iniciando bot de transcrição do WhatsApp...');
client.initialize();
