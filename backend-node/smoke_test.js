#!/usr/bin/env node
'use strict';

/**
 * smoke_test.js — Validação de produção para o Ouroboros
 *
 * Bate em todos os endpoints REST de um servidor real e reporta pass/fail.
 * Rode ANTES da feira para garantir que tudo está funcionando.
 *
 * Uso:
 *   node smoke_test.js
 *   BASE_URL=http://192.168.1.10:8000 ADMIN_TOKEN=meu_token node smoke_test.js
 */

require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin_token_change_me';

// ── Cores ─────────────────────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

let passed = 0;
let failed = 0;

function ok(label)   { console.log(`  ${GREEN}✓${RESET}  ${label}`); passed++; }
function fail(label, reason) {
  console.log(`  ${RED}✗${RESET}  ${label}`);
  console.log(`       ${RED}↳ ${reason}${RESET}`);
  failed++;
}
function section(title) {
  console.log(`\n${CYAN}${BOLD}── ${title}${RESET}`);
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function req(method, path, body, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}

function admin() { return { token: ADMIN_TOKEN }; }

// ── Assertions ────────────────────────────────────────────────────────────────
function assertStatus(label, res, expected) {
  if (res.status === expected) {
    ok(`${label} → ${expected}`);
    return true;
  }
  fail(`${label} → esperado ${expected}, recebeu ${res.status}`, JSON.stringify(res.body));
  return false;
}

function assertField(label, obj, field) {
  if (obj && field in obj) {
    ok(`${label} tem campo "${field}"`);
    return true;
  }
  fail(`${label} sem campo "${field}"`, JSON.stringify(obj));
  return false;
}

// ── IDs criados durante o teste (para reuso) ──────────────────────────────────
let storeId, storeToken, catId, distId, distToDeleteId, boxId;

// =============================================================================
async function main() {
  console.log(`\n${BOLD}Ouroboros — Smoke Test / Validação de Produção${RESET}`);
  console.log(`${CYAN}Server:${RESET} ${BASE_URL}`);
  console.log(`${CYAN}Token: ${RESET} ${ADMIN_TOKEN === 'admin_token_change_me' ? `${YELLOW}PADRÃO (troque!)${RESET}` : '(configurado)'}`);

  // ── 1. Health check ─────────────────────────────────────────────────────────
  section('GET /  — Health check');
  try {
    const res = await req('GET', '/');
    if (assertStatus('GET /', res, 200)) {
      if (res.body?.status === 'online') ok('status = "online"');
      else fail('status esperado "online"', res.body?.status);
    }
  } catch (e) {
    fail('GET / — servidor inacessível', e.message);
    console.log(`\n${RED}${BOLD}SERVIDOR NÃO RESPONDEU. Verifique se o backend está rodando em ${BASE_URL}${RESET}\n`);
    process.exit(1);
  }

  // ── 2. Economy State ────────────────────────────────────────────────────────
  section('GET /api/reports/economy_state');
  {
    const noAuth = await req('GET', '/api/reports/economy_state');
    assertStatus('sem token → 401', noAuth, 401);

    const wrongAuth = await req('GET', '/api/reports/economy_state', undefined, { token: 'errado' });
    assertStatus('token errado → 401', wrongAuth, 401);

    const res = await req('GET', '/api/reports/economy_state', undefined, admin());
    if (assertStatus('com token válido → 200', res, 200)) {
      for (const f of ['total_issued', 'total_circulating', 'comandas_active', 'stores_registered']) {
        assertField('economy_state', res.body, f);
      }
    }
  }

  // ── 3. Analytics (público) ──────────────────────────────────────────────────
  section('GET /api/reports/analytics  — público');
  {
    const res = await req('GET', '/api/reports/analytics');
    if (assertStatus('sem token → 200 (público)', res, 200)) {
      assertField('analytics', res.body, 'kpis');
      assertField('analytics', res.body, 'transactions_per_minute');
      assertField('analytics', res.body, 'top_stores');
      assertField('analytics', res.body, 'category_distribution');
    }
  }

  // ── 4. Stores ───────────────────────────────────────────────────────────────
  section('POST /api/stores  — criar loja');
  {
    const noAuth = await req('POST', '/api/stores', { name: '[SMOKE] Test Store' });
    assertStatus('sem token → 401', noAuth, 401);

    const noName = await req('POST', '/api/stores', {}, admin());
    assertStatus('sem nome → 400', noName, 400);

    const res = await req('POST', '/api/stores', { name: '[SMOKE] Test Store' }, admin());
    if (assertStatus('criar loja → 201', res, 201)) {
      storeId    = res.body?.id;
      storeToken = res.body?.terminal_token;
      ok(`id: ${storeId}`);
      if (/^[A-Z2-9]{6}$/.test(storeToken)) ok(`token válido: ${storeToken}`);
      else fail('token fora do formato esperado', storeToken);
    }
  }

  section('GET /api/stores  — listar lojas');
  {
    const noAuth = await req('GET', '/api/stores');
    assertStatus('sem token → 401', noAuth, 401);

    const res = await req('GET', '/api/stores', undefined, admin());
    if (assertStatus('listar lojas → 200', res, 200)) {
      if (Array.isArray(res.body)) ok(`array com ${res.body.length} loja(s)`);
      else fail('resposta não é array', res.body);
    }
  }

  section('PUT /api/stores/:id  — renomear loja');
  {
    if (!storeId) { fail('pulado — storeId não disponível', 'criação falhou'); }
    else {
      const noAuth = await req('PUT', `/api/stores/${storeId}`, { name: 'X' });
      assertStatus('sem token → 401', noAuth, 401);

      const noName = await req('PUT', `/api/stores/${storeId}`, {}, admin());
      assertStatus('sem nome → 400', noName, 400);

      const notFound = await req('PUT', '/api/stores/id-inexistente', { name: 'X' }, admin());
      assertStatus('id inválido → 404', notFound, 404);

      const res = await req('PUT', `/api/stores/${storeId}`, { name: '[SMOKE] Store Renomeada' }, admin());
      assertStatus('renomear → 200', res, 200);
    }
  }

  section('POST /api/stores/:id/revoke_token  — novo token');
  {
    if (!storeId) { fail('pulado — storeId não disponível', 'criação falhou'); }
    else {
      const notFound = await req('POST', '/api/stores/id-inexistente/revoke_token', {}, admin());
      assertStatus('id inválido → 404', notFound, 404);

      const res = await req('POST', `/api/stores/${storeId}/revoke_token`, {}, admin());
      if (assertStatus('revogar token → 200', res, 200)) {
        if (res.body?.new_token !== storeToken) ok('novo token diferente do anterior');
        else fail('novo token igual ao anterior', res.body?.new_token);
        storeToken = res.body?.new_token;
      }
    }
  }

  // ── 5. Categories ───────────────────────────────────────────────────────────
  section('POST /api/categories  — criar categoria');
  {
    const noAuth = await req('POST', '/api/categories', { name: '[SMOKE] Cat', price: 100 });
    assertStatus('sem token → 401', noAuth, 401);

    const noName = await req('POST', '/api/categories', { price: 100 }, admin());
    assertStatus('sem nome → 400', noName, 400);

    const badPrice = await req('POST', '/api/categories', { name: '[SMOKE] Cat', price: 0 }, admin());
    assertStatus('price 0 → 400', badPrice, 400);

    const res = await req('POST', '/api/categories', { name: '[SMOKE] Cat Teste', price: 500 }, admin());
    if (assertStatus('criar categoria → 201', res, 201)) {
      catId = res.body?.id;
      ok(`id: ${catId}`);
    }

    // Duplicata
    const dup = await req('POST', '/api/categories', { name: '[SMOKE] Cat Teste', price: 500 }, admin());
    assertStatus('duplicata → 400', dup, 400);
  }

  section('GET /api/categories  — listar (público)');
  {
    const res = await req('GET', '/api/categories');
    if (assertStatus('sem token → 200 (público)', res, 200)) {
      if (Array.isArray(res.body)) ok(`array com ${res.body.length} categoria(s)`);
      else fail('resposta não é array', res.body);
    }
  }

  // ── 6. Comanda ──────────────────────────────────────────────────────────────
  section('GET /api/comanda/:code  — buscar comanda');
  {
    const noAuth = await req('GET', '/api/comanda/F001');
    assertStatus('sem token → 401', noAuth, 401);

    const notFound = await req('GET', '/api/comanda/ZZZZ', undefined, admin());
    assertStatus('código inexistente → 404', notFound, 404);

    // Tenta buscar F001 (pode não existir em produção nova)
    const res = await req('GET', '/api/comanda/F001', undefined, admin());
    if (res.status === 200) {
      assertField('comanda', res.body, 'code');
      assertField('comanda', res.body, 'balance');
      ok('F001 encontrada com balance');
    } else if (res.status === 404) {
      ok('F001 não existe ainda (banco vazio — esperado em instalação nova)');
    } else {
      fail('GET /api/comanda/F001 retornou inesperado', `${res.status}: ${JSON.stringify(res.body)}`);
    }
  }

  // ── 7. Distribution ─────────────────────────────────────────────────────────
  section('POST /api/distribution  — criar rodada');
  {
    const noAuth = await req('POST', '/api/distribution', { name: '[SMOKE] Rodada', num_boxes: 1 });
    assertStatus('sem token → 401', noAuth, 401);

    const noName = await req('POST', '/api/distribution', { num_boxes: 1 }, admin());
    assertStatus('sem nome → 400', noName, 400);

    const badBoxes = await req('POST', '/api/distribution', { name: '[SMOKE] Rodada', num_boxes: -1 }, admin());
    assertStatus('num_boxes negativo → 400', badBoxes, 400);

    const res = await req('POST', '/api/distribution', { name: '[SMOKE] Rodada', num_boxes: 1 }, admin());
    if (assertStatus('criar rodada → 201', res, 201)) {
      distId = res.body?.id;
      ok(`id: ${distId}, status: ${res.body?.status}`);
    }

    // Segunda rodada para usar no DELETE
    const res2 = await req('POST', '/api/distribution', { name: '[SMOKE] Rodada para Deletar', num_boxes: 1 }, admin());
    if (res2.status === 201) distToDeleteId = res2.body?.id;
  }

  section('GET /api/distribution  — listar rodadas');
  {
    const noAuth = await req('GET', '/api/distribution');
    assertStatus('sem token → 401', noAuth, 401);

    const res = await req('GET', '/api/distribution', undefined, admin());
    if (assertStatus('listar → 200', res, 200)) {
      ok(`array com ${res.body?.length} rodada(s)`);
    }
  }

  section('GET /api/distribution/suggest  — sugestão');
  {
    const noAuth = await req('GET', '/api/distribution/suggest');
    assertStatus('sem token → 401', noAuth, 401);

    const res = await req('GET', '/api/distribution/suggest', undefined, admin());
    if (assertStatus('sugestão → 200', res, 200)) {
      assertField('suggest', res.body, 'suggested');
      assertField('suggest', res.body, 'reasoning');
    }
  }

  section(`GET /api/distribution/:id  — detalhe`);
  {
    if (!distId) { fail('pulado — distId não disponível', 'criação falhou'); }
    else {
      const notFound = await req('GET', '/api/distribution/id-inexistente', undefined, admin());
      assertStatus('id inválido → 404', notFound, 404);

      const res = await req('GET', `/api/distribution/${distId}`, undefined, admin());
      if (assertStatus('detalhe → 200', res, 200)) {
        assertField('distribution detail', res.body, 'distribution');
        assertField('distribution detail', res.body, 'boxes');
      }
    }
  }

  section('POST /api/distribution/:id/calculate  — calcular caixas');
  {
    if (!distId || !storeId) {
      fail('pulado — distId ou storeId não disponível', 'criação falhou');
    } else {
      const notFound = await req('POST', '/api/distribution/id-inexistente/calculate', {}, admin());
      assertStatus('id inválido → 404', notFound, 404);

      const res = await req('POST', `/api/distribution/${distId}/calculate`, {}, admin());
      if (res.status === 200) {
        assertStatus('calcular → 200', res, 200);
        assertField('calculate result', res.body, 'warnings');

        // Busca boxId para usar nas etapas seguintes
        const detail = await req('GET', `/api/distribution/${distId}`, undefined, admin());
        boxId = detail.body?.boxes?.[0]?.id;
        ok(`${detail.body?.boxes?.length} caixa(s) criada(s), boxId: ${boxId}`);
      } else if (res.status === 400) {
        // Pode falhar se categoria não tiver total_entries > 0
        ok('calculate → 400 (sem produtos cadastrados com estoque — esperado em banco vazio)');
      } else {
        fail('POST calculate', `${res.status}: ${JSON.stringify(res.body)}`);
      }
    }
  }

  section('PUT /api/distribution/:id/activate  — ativar rodada');
  {
    if (!distId) { fail('pulado — distId não disponível', 'criação falhou'); }
    else {
      const notFound = await req('PUT', '/api/distribution/id-inexistente/activate', {}, admin());
      assertStatus('id inválido → 404', notFound, 404);

      const res = await req('PUT', `/api/distribution/${distId}/activate`, {}, admin());
      assertStatus('ativar → 200', res, 200);
    }
  }

  // ── 8. Packing ──────────────────────────────────────────────────────────────
  section('GET /api/packing/active  — distribuição ativa');
  {
    const noAuth = await req('GET', '/api/packing/active');
    assertStatus('sem token → 401', noAuth, 401);

    const res = await req('GET', '/api/packing/active', undefined, admin());
    if (assertStatus('packing active → 200', res, 200)) {
      assertField('packing active', res.body, 'distribution');
      assertField('packing active', res.body, 'boxes');
      assertField('packing active', res.body, 'stats');
    }
  }

  if (boxId) {
    section('POST /api/packing/boxes/:boxId/claim  — assumir caixa');
    {
      const noAuth = await req('POST', `/api/packing/boxes/${boxId}/claim`, { responsible_name: 'Smoke Test' });
      assertStatus('sem token → 401', noAuth, 401);

      const noName = await req('POST', `/api/packing/boxes/${boxId}/claim`, {}, admin());
      assertStatus('sem nome → 400', noName, 400);

      const res = await req('POST', `/api/packing/boxes/${boxId}/claim`, { responsible_name: 'Smoke Test' }, admin());
      assertStatus('assumir caixa → 200', res, 200);

      // Tentar assumir de novo deve dar 409
      const dup = await req('POST', `/api/packing/boxes/${boxId}/claim`, { responsible_name: 'Outro' }, admin());
      assertStatus('caixa já assumida → 409', dup, 409);
    }

    section('POST /api/packing/boxes/:boxId/complete  — concluir caixa');
    {
      const noAuth = await req('POST', `/api/packing/boxes/${boxId}/complete`, {});
      assertStatus('sem token → 401', noAuth, 401);

      const res = await req('POST', `/api/packing/boxes/${boxId}/complete`, {}, admin());
      if (assertStatus('concluir caixa → 200', res, 200)) {
        assertField('complete result', res.body, 'recalc_triggered');
      }
    }
  } else {
    section('Packing boxes — pulado');
    ok('não há caixas disponíveis (calculate não criou caixas — banco vazio)');
  }

  // ── 9. DELETE distribution ──────────────────────────────────────────────────
  section('DELETE /api/distribution/:id  — excluir rodada');
  {
    if (!distToDeleteId) {
      fail('pulado — distToDeleteId não disponível', 'criação falhou');
    } else {
      const noAuth = await req('DELETE', `/api/distribution/${distToDeleteId}`);
      assertStatus('sem token → 401', noAuth, 401);

      const notFound = await req('DELETE', '/api/distribution/id-inexistente', undefined, admin());
      assertStatus('id inválido → 404', notFound, 404);

      const res = await req('DELETE', `/api/distribution/${distToDeleteId}`, undefined, admin());
      assertStatus('excluir → 200', res, 200);

      const check = await req('GET', `/api/distribution/${distToDeleteId}`, undefined, admin());
      assertStatus('rodada excluída não existe mais → 404', check, 404);
    }
  }

  // ── Resultado final ─────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'─'.repeat(55)}`);
  if (failed === 0) {
    console.log(`${GREEN}${BOLD}  PASSOU  ${passed}/${total} verificações ✓${RESET}`);
  } else {
    console.log(`${RED}${BOLD}  FALHOU  ${failed}/${total} verificações ✗${RESET}  (${passed} OK)`);
  }

  if (storeId || catId || distId) {
    console.log(`\n${YELLOW}Dados de teste criados no banco:${RESET}`);
    if (storeId)  console.log(`  • Loja:       [SMOKE] Store Renomeada (id: ${storeId})`);
    if (catId)    console.log(`  • Categoria:  [SMOKE] Cat Teste (id: ${catId})`);
    if (distId)   console.log(`  • Rodada:     [SMOKE] Rodada (id: ${distId}) — status: active`);
    console.log(`  ${YELLOW}→ Remova manualmente se não quiser estes registros na feira.${RESET}`);
  }
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}Erro fatal: ${err.message}${RESET}`);
  process.exit(1);
});
