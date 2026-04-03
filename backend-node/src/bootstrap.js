const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

// Caminho do .env onde o executável ou o Node.js está rodando localmente
const envPath = path.join(process.cwd(), '.env');

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function bootstrap() {
  if (!fs.existsSync(envPath)) {
    console.log('====================================================');
    console.log('        BEM-VINDO AO SISTEMA OUROBOROS (API)        ');
    console.log('====================================================\n');
    console.log('Detectamos que esta é a primeira vez que você roda o servidor nesta pasta.');
    console.log('Vamos criar as configurações de segurança básicas!\n');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    let adminToken = await prompt(rl, '[>] Crie uma senha (Token) para acesso Administrador: ');
    if (!adminToken || adminToken.trim() === '') {
      adminToken = 'admin123';
      console.log(`  -> Nenhuma digitada. Usando padrão: ${adminToken}\n`);
    } else {
      console.log('  -> Token salvo com sucesso.\n');
    }

    let secretKey = await prompt(rl, '[>] Informe uma Chave Secreta para criptografia (ou pressione ENTER para gerar uma forte automaticamente): ');
    if (!secretKey || secretKey.trim() === '') {
      secretKey = crypto.randomBytes(32).toString('hex');
      console.log('  -> Chave gerada automaticamente com sucesso.\n');
    } else {
      console.log('  -> Chave salva com sucesso.\n');
    }

    let defaultPort = await prompt(rl, '[>] Em qual porta você quer rodar a API? (pressione ENTER para a porta padrão 8000): ');
    if (!defaultPort || isNaN(defaultPort)) {
      defaultPort = '8000';
      console.log(`  -> Usando porta padrão: ${defaultPort}\n`);
    }

    // Gerando o conteúdo do arquivo
    const envContent = `ADMIN_TOKEN=${adminToken}\nSECRET_KEY=${secretKey}\nPORT=${defaultPort}\n`;

    fs.writeFileSync(envPath, envContent, { encoding: 'utf-8' });

    console.log('====================================================');
    console.log('TUDO PRONTO! O ARQUIVO .env FOI CRIADO NESTA PASTA.');
    console.log('====================================================\n');
    rl.close();
  }

  // Depois de toda segurança garantida, puxamos o servidor verdadeiro:
  require('./app.js');
}

bootstrap().catch(err => {
  console.error('Falha crítica na inicialização:', err);
  process.exit(1);
});
