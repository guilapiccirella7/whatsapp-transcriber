/**
 * WhatsApp Transcriber Bot
 * Twilio Sandbox + Groq Whisper API (cloud, free tier)
 */

const express = require('express');
const twilio  = require('twilio');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const Groq    = require('groq-sdk');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── CREDENCIAIS ───────────────────────────────────────────────────────────────
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const GROQ_KEY    = process.env.GROQ_API_KEY;

const groq = new Groq({ apiKey: GROQ_KEY });

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({
  status: 'online',
  bot: 'WhatsApp Transcriber',
  version: '2.0'
}));

// ── WEBHOOK ───────────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const twiml     = new twilio.twiml.MessagingResponse();
  const numMedia  = parseInt(req.body.NumMedia || '0');
  const mediaType = req.body.MediaContentType0 || '';
  const mediaUrl  = req.body.MediaUrl0;
  const from      = req.body.From;
  const to        = req.body.To;
  const body      = (req.body.Body || '').toLowerCase().trim();

  console.log(`[${new Date().toISOString()}] Mensagem de ${from} | mídia: ${numMedia} | tipo: ${mediaType}`);

  const isAudio = numMedia > 0 && (
    mediaType.includes('audio') ||
    mediaType.includes('ogg')   ||
    mediaType.includes('opus')  ||
    mediaType.includes('mpeg')  ||
    mediaType.includes('mp4')
  );

  if (!isAudio) {
    const msg = (body.includes('oi') || body.includes('olá') || body === 'hi')
      ? '👋 Olá! Sou o *TranscreveBot*.\n\nEnvie qualquer 🎙️ *áudio* e eu transcrevo na hora!'
      : '🎙️ Envie um *áudio* que eu transcrevo e resumo automaticamente!';
    twiml.message(msg);
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // Confirma recebimento imediatamente
  twiml.message('🎙 *Recebi seu áudio!*\nTranscrevendo agora... ⏳');
  res.type('text/xml').send(twiml.toString());

  // Processa em background
  processAudio({ from, to, mediaUrl, mediaType });
});

// ── PROCESSA ÁUDIO ────────────────────────────────────────────────────────────
async function processAudio({ from, to, mediaUrl, mediaType }) {
  const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

  const ext = mediaType.includes('ogg') || mediaType.includes('opus') ? '.ogg'
            : mediaType.includes('mp4') ? '.mp4'
            : mediaType.includes('mpeg') ? '.mp3'
            : '.audio';

  const tmpPath = path.join(os.tmpdir(), `wa_${Date.now()}${ext}`);

  try {
    // 1. Baixa o áudio
    console.log(`  Baixando: ${mediaUrl}`);
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      auth: { username: ACCOUNT_SID, password: AUTH_TOKEN },
    });
    fs.writeFileSync(tmpPath, response.data);
    console.log(`  Salvo: ${tmpPath} (${(response.data.byteLength / 1024).toFixed(1)} KB)`);

    // 2. Transcreve com Groq Whisper
    console.log('  Transcrevendo com Groq Whisper...');
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-large-v3',
      language: 'pt',
      response_format: 'verbose_json',
    });

    const text = transcription.text?.trim() || '';
    if (!text) throw new Error('Transcrição vazia');

    console.log(`  Transcrito: ${text.length} chars`);

    // 3. Gera resumo com Groq LLaMA
    console.log('  Gerando resumo...');
    const summaryRes = await groq.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        {
          role: 'system',
          content: 'Você é um assistente que cria resumos concisos de transcrições de áudio do WhatsApp. Responda sempre em português. Seja direto e objetivo. Destaque os pontos principais em 2-4 frases.',
        },
        {
          role: 'user',
          content: `Faça um resumo desta transcrição:\n\n"${text}"`,
        },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    const summary = summaryRes.choices[0]?.message?.content?.trim() || text.slice(0, 200);

    // 4. Envia transcrição completa
    for (const chunk of splitMsg(`📝 *TRANSCRIÇÃO COMPLETA*\n\n${text}`)) {
      await client.messages.create({ from: to, to: from, body: chunk });
      await sleep(600);
    }

    // 5. Envia resumo inteligente
    await client.messages.create({
      from: to,
      to: from,
      body: `📌 *RESUMO*\n\n${summary}`,
    });

    console.log('  Respostas enviadas!');

  } catch (err) {
    console.error('  ERRO:', err.message);
    try {
      await client.messages.create({
        from: to,
        to: from,
        body: '❌ Erro ao transcrever. Tente novamente.',
      });
    } catch (_) {}
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function splitMsg(text, max = 1500) {
  if (text.length <= max) return [text];
  const parts = [];
  for (let i = 0; i < text.length; i += max) parts.push(text.slice(i, i + max));
  return parts;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[BOT] Servidor na porta ${PORT}`));

// Keep-alive ping (chamado pelo UptimeRobot a cada 5min)
app.get('/ping', (req, res) => res.json({ status: 'alive', ts: Date.now() }));
