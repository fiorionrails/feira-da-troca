'use strict';

/**
 * CLI logger for the Ouroboros backend.
 * Pure ANSI escape codes — zero extra dependencies.
 */

const os = require('os');

// ---------------------------------------------------------------------------
// ANSI palette
// ---------------------------------------------------------------------------
const C = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  red:      '\x1b[31m',
  green:    '\x1b[32m',
  yellow:   '\x1b[33m',
  blue:     '\x1b[34m',
  magenta:  '\x1b[35m',
  cyan:     '\x1b[36m',
  gray:     '\x1b[90m',
  bRed:     '\x1b[91m',
  bGreen:   '\x1b[92m',
  bYellow:  '\x1b[93m',
  bBlue:    '\x1b[94m',
  bMagenta: '\x1b[95m',
  bCyan:    '\x1b[96m',
  bWhite:   '\x1b[97m',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ts() {
  return new Date().toLocaleTimeString('pt-BR', { hour12: false });
}

function pad(s, n)  { return String(s).padEnd(n); }
function rpad(s, n) { return String(s).padStart(n); }

function emit(tag, tagColor, ...parts) {
  process.stdout.write(
    `${C.gray}${ts()}${C.reset}  ${tagColor}${pad(tag, 9)}${C.reset}  ${parts.join('')}\n`
  );
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------
function banner(config) {
  const W = 56;
  const bar  = (ch, l, r) => `${l}${ch.repeat(W - 2)}${r}`;
  const row  = (s = '') => `│  ${(s + C.reset).padEnd(W + 30)}│`;

  const nets = os.networkInterfaces();
  const ips  = [];
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    }
  }

  const mask = config.adminToken.length > 3
    ? config.adminToken.slice(0, 3) + '•'.repeat(Math.min(config.adminToken.length - 3, 5))
    : '••••••';

  const lines = [
    bar('─', '┌', '┐'),
    row(),
    row(`   ${C.bold}${C.bYellow}◆  OUROBOROS${C.reset}   ${C.dim}${config.eventName}`),
    row(),
    bar('─', '├', '┤'),
    row(`   ${C.cyan}Porta    ${C.reset}${C.bold}${config.port}${C.reset}`),
    row(`   ${C.cyan}Banco    ${C.reset}${config.databaseUrl}`),
    row(`   ${C.cyan}Token    ${C.reset}${mask}`),
    row(`   ${C.cyan}Limite   ${C.reset}${config.maxComandas} comandas`),
    ...(ips.length > 0 ? [
      bar('─', '├', '┤'),
      ...ips.map(ip =>
        row(`   ${C.bGreen}↗  rede  ${C.reset}${C.bold}http://${ip}:${config.port}${C.reset}`)
      ),
    ] : []),
    row(),
    bar('─', '└', '┘'),
  ];

  console.log('\n' + lines.join('\n') + '\n');
  emit('PRONTO', C.bGreen, `${C.bGreen}servidor ouvindo em todas as interfaces${C.reset}`);
  console.log();
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------
function rest(method, path, status, ms) {
  const mColor = { GET: C.bBlue, POST: C.bGreen, PUT: C.bYellow, DELETE: C.bRed }[method] || C.reset;
  const sColor = status < 300 ? C.bGreen : status < 400 ? C.bYellow : C.bRed;

  emit(
    'REST',
    C.blue,
    `${mColor}${pad(method, 7)}${C.reset}`,
    `${C.dim}${pad(path, 34)}${C.reset}`,
    `${sColor}${status}${C.reset}`,
    `  ${C.gray}${ms}ms${C.reset}`
  );
}

// ---------------------------------------------------------------------------
// WebSocket — conexões
// ---------------------------------------------------------------------------
function wsConnect(role, name, activeCount) {
  const cfg = {
    admin:   ['ADMIN ↑',   C.bMagenta],
    store:   ['LOJA ↑',    C.bCyan],
    packing: ['PACK ↑',    C.bCyan],
  }[role] || ['WS ↑', C.cyan];

  emit(cfg[0], cfg[1],
    `${C.bold}${name}${C.reset}`,
    `  ${C.gray}(${activeCount} ativa${activeCount !== 1 ? 's' : ''})${C.reset}`
  );
}

function wsDisconnect(role, name, activeCount) {
  const cfg = {
    admin:   ['ADMIN ↓',   C.magenta],
    store:   ['LOJA ↓',    C.cyan],
    packing: ['PACK ↓',    C.cyan],
  }[role] || ['WS ↓', C.gray];

  emit(cfg[0], cfg[1],
    `${C.dim}${name}${C.reset}`,
    `  ${C.gray}(${activeCount} ativa${activeCount !== 1 ? 's' : ''})${C.reset}`
  );
}

function wsAuthFail(role) {
  emit('AUTH ✗', C.bRed, `${C.bRed}tentativa sem token válido${C.reset}  ${C.gray}(${role})${C.reset}`);
}

// ---------------------------------------------------------------------------
// Transações
// ---------------------------------------------------------------------------
function comandaCriada(code, holderName, balance) {
  emit(
    'COMANDA',
    C.bYellow,
    `${C.bold}${pad(code, 6)}${C.reset}  ${C.bWhite}${pad(holderName, 18)}${C.reset}`,
    balance > 0
      ? `${C.bGreen}+${rpad(balance, 4)} ETC${C.reset}  ${C.gray}saldo: ${balance}${C.reset}`
      : `${C.gray}sem saldo inicial${C.reset}`
  );
}

function debitoConfirmado(code, holderName, amount, newBalance, storeName) {
  emit(
    'DÉBITO ✔',
    C.bGreen,
    `${C.bold}${pad(code, 6)}${C.reset}  ${pad(holderName, 18)}`,
    `${C.bRed}-${rpad(amount, 4)} ETC${C.reset}`,
    `  ${C.gray}→ ${rpad(newBalance, 5)} ETC  ${storeName}${C.reset}`
  );
}

function debitoRejeitado(code, reason, requested, currentBalance, storeName) {
  const detail = reason === 'insufficient_balance'
    ? `saldo insuficiente  req:${C.bold}${requested}${C.reset}${C.yellow}  atual:${currentBalance}`
    : reason === 'invalid_amount'
    ? `valor inválido (${requested})`
    : reason === 'comanda_not_found'
    ? `comanda não encontrada (${code})`
    : reason;

  emit(
    'DÉBITO ✗',
    C.bYellow,
    `${C.bold}${pad(code || '?', 6)}${C.reset}  `,
    `${C.yellow}${detail}${C.reset}`,
    `  ${C.gray}${storeName}${C.reset}`
  );
}

function creditoConfirmado(code, holderName, amount, newBalance) {
  emit(
    'CRÉDITO',
    C.bGreen,
    `${C.bold}${pad(code, 6)}${C.reset}  ${pad(holderName, 18)}`,
    `${C.bGreen}+${rpad(amount, 4)} ETC${C.reset}`,
    `  ${C.gray}→ ${rpad(newBalance, 5)} ETC${C.reset}`
  );
}

// ---------------------------------------------------------------------------
// Outros eventos
// ---------------------------------------------------------------------------
function broadcast(type, count) {
  emit(
    'BROAD.',
    C.gray,
    `${C.dim}${pad(type, 30)}→ ${count} conexão(ões)${C.reset}`
  );
}

function rateLimited(role, name) {
  emit('RATE ✗', C.yellow,
    `${C.yellow}limite atingido${C.reset}  ${C.gray}${role}${name ? ` (${name})` : ''}${C.reset}`
  );
}

function dbConnect(dbPath) {
  emit('DB', C.cyan, `${C.dim}conectado → ${dbPath}${C.reset}`);
}

function serverError(context, message) {
  emit('ERRO', C.bRed, `${C.bRed}[${context}]${C.reset}  ${C.red}${message}${C.reset}`);
}

module.exports = {
  banner,
  rest,
  wsConnect,
  wsDisconnect,
  wsAuthFail,
  comandaCriada,
  debitoConfirmado,
  debitoRejeitado,
  creditoConfirmado,
  broadcast,
  rateLimited,
  dbConnect,
  serverError,
};
