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
  version: '2.1'
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

  // Confirma recebimento imediatamente via TwiML (não depende do limite diário)
  twiml.message('🎙 *Recebi seu áudio!*\nTranscrevendo agora... ⏳');
  res.type('text/xml').send(twiml.toString());

  // Processa em background
  processAudio({ from, to, mediaUrl, mediaType });
});

// ── ENVIA COM FALLBACK (Twilio → CallMeBot) ───────────────────────────────────
async function sendReply(twilioClient, from, to, body) {
  // Tenta Twilio primeiro
  try {
    await twilioClient.messages.create({ from: to, to: from, body });
    return;
  } catch (e) {
    console.log(`  Twilio falhou: ${e.message?.slice(0, 80)}`);
  }

  // Fallback: CallMeBot
  const cbPhone  = process.env.CALLMEBOT_PHONE;
  const cbApiKey = process.env.CALLMEBOT_APIKEY;
  if (!cbPhone || !cbApiKey) {
    console.log('  CallMeBot não configurado — mensagem perdida.');
    return;
  }

  // Extrai número limpo do destinatário (ex: "whatsapp:+5512996631119" → "5512996631119")
  const recipientPhone = from.replace(/^whatsapp:\+?/, '');

  if (recipientPhone !== cbPhone) {
    console.log(`  CallMeBot: número ${recipientPhone} não é o registrado — mensagem perdida.`);
    return;
  }

  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${cbPhone}&text=${encodeURIComponent(body)}&apikey=${cbApiKey}`;
    await axios.get(url);
    console.log('  Enviado via CallMeBot.');
  } catch (e) {
    console.log(`  CallMeBot falhou: ${e.message?.slice(0, 80)}`);
  }
}

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

    // 3. Gera análise com Groq LLaMA
    console.log('  Gerando análise...');
    const analysisRes = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `Você é um assistente de análise de áudios de vendas. Analise o áudio transcrito e responda EXATAMENTE neste formato, sem texto extra:

- INTENÇÃO: [o que a pessoa quer/precisa]
- URGÊNCIA: [alta / média / baixa — e por quê em uma frase]
- FUNIL: [etapa: Descoberta / Consideração / Decisão / Pós-venda]
- Nota/resumo: [resumo direto do conteúdo em 1-2 frases]`,
        },
        {
          role: 'user',
          content: `Analise este áudio transcrito:\n\n"${text}"`,
        },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    const analysis = analysisRes.choices[0]?.message?.content?.trim() || '';

    // 4. Monta e envia mensagem unificada
    const fullMsg = `📝 *TRANSCRIÇÃO*\n\n${text}\n\n📊 *ANÁLISE*\n${analysis}`;

    for (const chunk of splitMsg(fullMsg)) {
      await sendReply(client, from, to, chunk);
      await sleep(600);
    }
    console.log('  Respostas enviadas!');

  } catch (err) {
    console.error('  ERRO:', err.message);
    try {
      await sendReply(client, from, to, '❌ Erro ao transcrever. Tente novamente.');
    } catch (_) {}
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function splitMsg(text, max = 900) {
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
