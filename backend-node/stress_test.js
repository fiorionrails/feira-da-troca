'use strict';

/**
 * Stress test for the Ouroboros Node.js backend.
 *
 * Usage:
 *   node stress_test.js [duration_seconds=60] [num_stores=5]
 *
 * Requires the server to be running:
 *   npm start   (or npm run dev)
 *
 * What it does:
 *   - 1 admin worker creates comandas at ~2/sec
 *   - N store workers each alternate between balance_query and debit_request
 *   - Reports throughput, latency (p50/p95/p99) and success/failure counts every 3s
 *   - Reconnects automatically on disconnect
 *   - Prints a final summary on Ctrl+C or when duration expires
 */

require('dotenv').config();
const WebSocket = require('ws');

const BASE_URL  = 'http://localhost:8000';
const WS_URL    = 'ws://localhost:8000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin_token_change_me';

const DURATION_SEC    = parseInt(process.argv[2] || '60', 10);
const NUM_STORES      = parseInt(process.argv[3] || '5', 10);
// Min sleep between store ops in ms. 0 = fire as fast as the server responds.
// Use with STRESS_NO_RATELIMIT=true on the server to bypass WS rate limiting.
const SLEEP_MS        = parseInt(process.argv[4] ?? '250', 10);
const REPORT_INTERVAL = 3000; // ms

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const activeCodandas = []; // comanda codes available for debit/query
let running = true;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const metrics = {
  comandasCreated:    0,
  debitsConfirmed:    0,
  debitsInsufficient: 0,
  debitsOtherReject:  0,
  balanceQueries:     0,
  rateLimited:        0,
  errors:             0,
  reconnects:         0,
  latencies:          [],   // all-time, for final report
  windowOps:          0,    // ops completed since last report
  windowStart:        Date.now(),
};

function recordLatency(ms) {
  metrics.latencies.push(ms);
  // cap memory: keep last 2000 samples
  if (metrics.latencies.length > 2000) metrics.latencies.shift();
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function latencyStats() {
  if (metrics.latencies.length === 0) return { p50: 0, p95: 0, p99: 0, avg: 0 };
  const sorted = [...metrics.latencies].sort((a, b) => a - b);
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return {
    avg:  avg.toFixed(1),
    p50:  percentile(sorted, 50).toFixed(1),
    p95:  percentile(sorted, 95).toFixed(1),
    p99:  percentile(sorted, 99).toFixed(1),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** HTTP request helper (no extra deps — uses built-in http module). */
function httpRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port:     url.port || 8000,
      path:     url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        token: ADMIN_TOKEN,
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = require('http').request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Connect a WebSocket and wait for the initial 'connected' greeting.
 * Returns { ws, connected }.
 */
function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error(`WS connect timeout: ${url}`)), 5000);
    ws.once('open', () => {});
    ws.once('error', (e) => { clearTimeout(timer); reject(e); });
    ws.once('message', (data) => {
      clearTimeout(timer);
      try { resolve({ ws, connected: JSON.parse(data.toString()) }); }
      catch (e) { reject(e); }
    });
  });
}

/**
 * Wait for the next message whose `type` is in the `acceptTypes` set.
 * Silently discards broadcasts (balance_updated, admin_balance_updated,
 * update_next_code) that arrive while waiting for a direct reply.
 *
 * Always stops on `error` messages (e.g. rate_limit_exceeded) so the
 * caller can handle them instead of waiting until timeout and reconnecting.
 */
function waitForType(ws, acceptTypes, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for [${acceptTypes}]`)),
      timeout
    );
    const handler = (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); }
      catch (e) { clearTimeout(timer); ws.removeListener('message', handler); reject(e); return; }

      if (acceptTypes.includes(msg.type) || msg.type === 'error') {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg);
      }
      // else: broadcast (balance_updated, update_next_code, etc.) — keep waiting
    };
    ws.on('message', handler);
  });
}

// ---------------------------------------------------------------------------
// Admin worker — creates comandas
// ---------------------------------------------------------------------------

const NAMES = ['Pedro', 'Maria', 'João', 'Ana', 'Lucas', 'Julia', 'Marcos', 'Carla', 'Bruno', 'Lara'];
const CATEGORIES = ['Bolo de Pote', 'Refrigerante', 'Fatia de Pizza', 'Pulseira Neon', 'Hambúrguer'];

async function adminWorker() {
  const url = `${WS_URL}/ws/admin?token=${encodeURIComponent(ADMIN_TOKEN)}`;

  while (running) {
    let ws;
    try {
      ({ ws } = await connectWs(url));

      while (running) {
        const holder = `${pick(NAMES)} ${rand(100, 999)}`;
        const balance = rand(50, 200);
        const cart = [{ name: pick(CATEGORIES), quantity: rand(1, 3) }];

        const t0 = Date.now();
        ws.send(JSON.stringify({
          type: 'create_comanda',
          holder_name: holder,
          initial_balance: balance,
          cart_items: cart,
        }));

        const reply = await waitForType(ws, ['comanda_created', 'error']);
        const latency = Date.now() - t0;

        if (reply.type === 'comanda_created') {
          activeCodandas.push(reply.code);
          // cap list to avoid unbounded growth
          if (activeCodandas.length > 500) activeCodandas.shift();
          metrics.comandasCreated++;
          metrics.windowOps++;
          recordLatency(latency);
        } else {
          metrics.errors++;
        }

        await sleep(500); // ~2 comandas/sec
      }

      ws.close();
    } catch (e) {
      if (running) {
        metrics.errors++;
        metrics.reconnects++;
        await sleep(2000);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Store worker — debits + balance queries
// ---------------------------------------------------------------------------

async function storeWorker(token, name) {
  const url = `${WS_URL}/ws/store?token=${encodeURIComponent(token)}`;

  while (running) {
    let ws;
    try {
      ({ ws } = await connectWs(url));

      while (running) {
        if (activeCodandas.length === 0) {
          await sleep(200);
          continue;
        }

        const code   = pick(activeCodandas);
        const doDebit = Math.random() < 0.7; // 70% debit, 30% query

        const t0 = Date.now();

        if (doDebit) {
          const amount = rand(5, 40);
          ws.send(JSON.stringify({ type: 'debit_request', comanda_code: code, amount }));
          const reply = await waitForType(ws, ['debit_confirmed', 'debit_rejected']);
          const latency = Date.now() - t0;
          recordLatency(latency);
          metrics.windowOps++;

          if (reply.type === 'debit_confirmed') {
            metrics.debitsConfirmed++;
          } else if (reply.reason === 'insufficient_balance') {
            metrics.debitsInsufficient++;
          } else if (reply.reason === 'rate_limit_exceeded') {
            metrics.rateLimited++;
          } else {
            metrics.debitsOtherReject++;
          }
        } else {
          ws.send(JSON.stringify({ type: 'balance_query', comanda_code: code }));
          const reply = await waitForType(ws, ['balance_response', 'error']);
          const latency = Date.now() - t0;
          recordLatency(latency);
          metrics.windowOps++;
          if (reply.reason === 'rate_limit_exceeded') {
            metrics.rateLimited++;
          } else {
            metrics.balanceQueries++;
          }
        }

        if (SLEEP_MS > 0) await sleep(rand(SLEEP_MS, SLEEP_MS * 2));
      }

      ws.close();
    } catch (e) {
      if (running) {
        metrics.errors++;
        metrics.reconnects++;
        await sleep(2000);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

function printReport(elapsed, final = false) {
  const windowSec = (Date.now() - metrics.windowStart) / 1000;
  const throughput = (metrics.windowOps / windowSec).toFixed(1);
  const lat = latencyStats();
  const totalOps = metrics.comandasCreated + metrics.debitsConfirmed +
                   metrics.debitsInsufficient + metrics.debitsOtherReject + metrics.balanceQueries;
  const debitTotal = metrics.debitsConfirmed + metrics.debitsInsufficient + metrics.debitsOtherReject;
  const successRate = debitTotal > 0
    ? ((metrics.debitsConfirmed / debitTotal) * 100).toFixed(1)
    : 'N/A';

  const header = final ? '=== RELATÓRIO FINAL ===' : `=== ${elapsed}s ===`;
  console.log('\n' + '─'.repeat(44));
  console.log(header);
  console.log('─'.repeat(44));
  console.log(`Throughput (janela):  ${throughput} ops/s`);
  console.log(`Latência  avg/p50/p95/p99:  ${lat.avg}/${lat.p50}/${lat.p95}/${lat.p99} ms`);
  console.log('─'.repeat(44));
  console.log(`Comandas emitidas:    ${metrics.comandasCreated}`);
  console.log(`Débitos confirmados:  ${metrics.debitsConfirmed}  (${successRate}% de sucesso)`);
  console.log(`  Saldo insuficiente: ${metrics.debitsInsufficient}`);
  console.log(`  Outros rejeites:    ${metrics.debitsOtherReject}`);
  console.log(`Consultas de saldo:   ${metrics.balanceQueries}`);
  console.log(`Rate limited:         ${metrics.rateLimited}`);
  console.log(`Total de operações:   ${totalOps}`);
  console.log(`Erros / reconexões:   ${metrics.errors} / ${metrics.reconnects}`);
  console.log('─'.repeat(44));

  // reset window
  metrics.windowOps = 0;
  metrics.windowStart = Date.now();
}

async function reporterLoop(startTime) {
  while (running) {
    await sleep(REPORT_INTERVAL);
    if (!running) break;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    printReport(elapsed);
  }
}

// ---------------------------------------------------------------------------
// Setup — seed categories and create/reuse stores
// ---------------------------------------------------------------------------

async function setup() {
  const sleepLabel = SLEEP_MS > 0 ? `${SLEEP_MS}ms` : 'SEM SLEEP (máx throughput)';
  const rateLimitLabel = process.env.STRESS_NO_RATELIMIT ? 'DESATIVADO' : '300/min';
  console.log('\nIniciando teste de estresse do backend-node...');
  console.log(`Duração: ${DURATION_SEC}s | Lojas: ${NUM_STORES} | Sleep: ${sleepLabel} | Rate limit WS: ${rateLimitLabel}\n`);

  // Seed categories
  process.stdout.write('Semeando categorias... ');
  for (const name of CATEGORIES) {
    await httpRequest('POST', '/api/categories', { name, price: rand(5, 30) });
  }
  console.log('ok');

  // Fetch or create stores
  process.stdout.write('Preparando lojas... ');
  const { status: getStatus, body: existing } = await httpRequest('GET', '/api/stores');
  if (getStatus !== 200) {
    console.error(`\nFalha ao listar lojas (HTTP ${getStatus}): ${JSON.stringify(existing)}`);
    console.error('Servidor rodando? ADMIN_TOKEN correto?');
    process.exit(1);
  }

  const storeTokens = Array.isArray(existing)
    ? existing.map((s) => ({ token: s.terminal_token, name: s.name }))
    : [];

  const needed = NUM_STORES - storeTokens.length;
  if (needed > 0) {
    process.stdout.write(`\n  criando ${needed} lojas`);
    for (let i = 0; i < needed; i++) {
      const name = `Loja ${storeTokens.length + 1}`;
      let created = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { status, body } = await httpRequest('POST', '/api/stores', { name });
        if (status === 201 && body && body.terminal_token) {
          storeTokens.push({ token: body.terminal_token, name });
          process.stdout.write('.');
          created = true;
          break;
        }
        // 429 ou outro erro: espera e tenta de novo
        await sleep(status === 429 ? 3000 : 500);
      }
      if (!created) {
        console.error(`\n  Não foi possível criar loja após 5 tentativas. Continuando com ${storeTokens.length} lojas.`);
        break;
      }
      // ~15 criações/s para ficar sob o limite de 300/min do REST
      await sleep(70);
    }
    console.log(' ok');
  }

  console.log(`${storeTokens.length} lojas prontas`);
  return storeTokens.slice(0, NUM_STORES);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const stores = await setup();
  const startTime = Date.now();

  console.log('\nDisparando workers... (Ctrl+C para parar)\n');

  const tasks = [
    adminWorker(),
    reporterLoop(startTime),
    ...stores.map(({ token, name }) => storeWorker(token, name)),
  ];

  // Stop after DURATION_SEC
  const deadline = sleep(DURATION_SEC * 1000).then(() => {
    running = false;
  });

  process.on('SIGINT', () => {
    running = false;
  });

  await Promise.race([deadline, ...tasks.map((t) => t.catch(() => {}))]);
  running = false;

  // Give workers a moment to finish current ops
  await sleep(500);

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  printReport(elapsed, true);
  process.exit(0);
}

main().catch((e) => {
  console.error('Erro fatal:', e.message);
  process.exit(1);
});
