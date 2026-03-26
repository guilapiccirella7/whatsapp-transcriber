/**
 * Setup interativo — salva as credenciais Twilio e mostra as instruções.
 */

const readline = require('readline');
const fs       = require('fs');
const path     = require('path');
const { exec } = require('child_process');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const q  = (prompt) => new Promise(r => rl.question(prompt, r));

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   🤖  WhatsApp Transcriber Bot — Setup               ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  console.log('📋 PASSO 1 — Criar conta gratuita na Twilio');
  console.log('   👉 Acesse: https://www.twilio.com/try-twilio');
  console.log('   • Crie a conta (email + senha)');
  console.log('   • Confirme o email');
  console.log('   • NÃO precisa de cartão de crédito para o sandbox\n');

  await q('   ✅ Conta criada? Pressione ENTER para continuar...');

  console.log('\n📋 PASSO 2 — Pegar as credenciais');
  console.log('   👉 No painel da Twilio: https://console.twilio.com');
  console.log('   • Copie o "Account SID"  (começa com AC...)');
  console.log('   • Copie o "Auth Token"   (clique no olhinho para ver)\n');

  const accountSid = (await q('   Cole seu Account SID: ')).trim();
  const authToken  = (await q('   Cole seu Auth Token:  ')).trim();

  if (!accountSid.startsWith('AC') || accountSid.length < 30) {
    console.log('\n❌ Account SID inválido. Tente novamente.');
    rl.close(); return;
  }

  const config = { accountSid, authToken };
  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
  console.log('\n✅ Credenciais salvas em config.json\n');

  console.log('📋 PASSO 3 — Ativar o WhatsApp Sandbox');
  console.log('   👉 Acesse: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn');
  console.log('   • Clique em "WhatsApp Sandbox"');
  console.log('   • Anote o número do sandbox (ex: +1 415 523 8886)');
  console.log('   • Anote o código de ativação (ex: join <palavra-palavra>)\n');

  const sandboxNum  = (await q('   Número do Sandbox (ex: +14155238886): ')).trim();
  const joinCode    = (await q('   Código de ativação (ex: join cold-river): ')).trim();

  config.sandboxNumber = sandboxNum;
  config.joinCode = joinCode;
  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   📱  ATIVE O BOT NO SEU WHATSAPP AGORA              ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\n   1. Abra o WhatsApp no celular`);
  console.log(`   2. Salve este número: ${sandboxNum}`);
  console.log(`   3. Envie esta mensagem EXATAMENTE: ${joinCode}`);
  console.log(`   4. Aguarde a confirmação da Twilio\n`);

  await q('   ✅ Mensagem enviada e confirmada? Pressione ENTER...');

  console.log('\n🚀 Iniciando servidor e túnel ngrok...\n');
  rl.close();

  // Inicia o servidor + ngrok
  startBot(accountSid, authToken, sandboxNum);
}

function startBot(accountSid, authToken, sandboxNum) {
  const { spawn } = require('child_process');

  // Inicia server.js
  const server = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: authToken },
  });

  // Aguarda 2s e inicia ngrok
  setTimeout(() => {
    const ngrokBin = require('which').sync('ngrok', { nothrow: true })
                  || '/Users/guilapiccirella/.npm-global/bin/ngrok';

    const ngrok = spawn(ngrokBin, ['http', '3000'], { stdio: 'pipe' });

    let ngrokUrl = '';

    setTimeout(async () => {
      // Pega a URL do ngrok via API local
      try {
        const http = require('http');
        http.get('http://localhost:4040/api/tunnels', (res) => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => {
            try {
              const tunnels = JSON.parse(data).tunnels;
              ngrokUrl = tunnels.find(t => t.proto === 'https')?.public_url;
              if (ngrokUrl) {
                showInstructions(ngrokUrl, accountSid, authToken, sandboxNum);
              }
            } catch (_) {
              console.log('\n⚠️  Pegue a URL do ngrok manualmente em: http://localhost:4040');
            }
          });
        }).on('error', () => {
          console.log('\n⚠️  Acesse http://localhost:4040 para ver a URL do ngrok');
        });
      } catch (_) {}
    }, 3000);

  }, 2000);
}

function showInstructions(ngrokUrl, accountSid, authToken, sandboxNum) {
  const webhookUrl = `${ngrokUrl}/webhook`;

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   ✅  BOT ONLINE! CONFIGURE O WEBHOOK AGORA          ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log(`   🔗 URL do Webhook:`);
  console.log(`   ${webhookUrl}\n`);
  console.log('   📋 ÚLTIMO PASSO — Configurar na Twilio:');
  console.log('   1. Acesse: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn');
  console.log('   2. Clique em "Sandbox Settings"');
  console.log('   3. No campo "WHEN A MESSAGE COMES IN" cole:');
  console.log(`      ${webhookUrl}`);
  console.log('   4. Método: HTTP POST');
  console.log('   5. Clique em Save\n');
  console.log('   ─────────────────────────────────────────────────────');
  console.log(`   📱 Número do Bot:  ${sandboxNum}`);
  console.log(`   📤 Envie um áudio para esse número e teste!\n`);
  console.log('   ⚠️  Mantenha este terminal aberto enquanto usar o bot.');
  console.log('   ─────────────────────────────────────────────────────\n');

  // Salva a URL no config
  const configPath = path.join(__dirname, 'config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    cfg.webhookUrl = webhookUrl;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  } catch (_) {}
}

main().catch(console.error);
