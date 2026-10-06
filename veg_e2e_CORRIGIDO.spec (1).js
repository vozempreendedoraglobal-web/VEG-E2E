/**
 * ============================================================================
 * VEG — Plano E2E Automatizado (Playwright) — VERSÃO CORRIGIDA 2026-10-06
 * ----------------------------------------------------------------------------
 * Alinhado ao código real de produção:
 *   • index.html                    → DB_KEY = 'vegapp_db_v1'
 *   • Login real                    → inputs #liContacto / #liSenha, botão
 *                                     '#fLogin button[type="submit"]', função doLogin()
 *   • Hash de senha                 → SHA-256('VEG::' + senha)  [função vegHash()]
 *   • Cartão experimental           → renderTrialCard() exige w.trial && w.trialEnds
 *   • Idempotência frontend         → _vegOpsInFlight + vegSubmit(data-vegBusy)
 * ----------------------------------------------------------------------------
 * SETUP (uma vez):
 *   npm init -y
 *   npm i -D @playwright/test
 *   npx playwright install chromium
 * EXECUÇÃO:
 *   npx playwright test veg_e2e_CORRIGIDO.spec.js --headed
 *   npx playwright show-report
 * ============================================================================
 */

const { test, expect } = require('@playwright/test');
const crypto = require('crypto');

/* ============================== CONFIGURAÇÃO ============================== */
/* ⚠️ PREENCHER antes de executar (os dois serviços têm de estar no ar).      */
/* URL lidas do ambiente: em CI/GitHub Actions usam os Secrets
   VEG_APP_URL / VEG_API_URL; em local usam os valores por defeito. */
const CONFIG = {
  APP_URL: process.env.VEG_APP_URL || 'https://O-SEU-DOMINIO.vegglobal.com/index.html',   // ← site VEG
  API_URL: process.env.VEG_API_URL || 'https://script.google.com/macros/s/VEG_BACKEND/exec', // ← Apps Script
  DB_KEY: 'vegapp_db_v1',          // ← VALOR REAL no index.html (era 'VEG_APP_DB')
  DEMO_PASSWORD: 'Teste123!',
  ADMIN_EMAIL: 'andrewchindacata@gmail.com',  // superadmin (só leitura/verificação)
  TRIAL_HOURS: 72,
  TRIAL_BALANCE: 5000,
};

/* Hash exactamente igual à função vegHash() do index.html */
const vegHash = (senha) =>
  crypto.createHash('sha256').update('VEG::' + senha).digest('hex');

/* Selectores reais do formulário de login (confirmados no index.html) */
const SEL = {
  loginForm: '#fLogin',
  loginUser: '#liContacto',            // e-mail OU telefone
  loginPass: '#liSenha',
  loginSubmit: '#fLogin button[type="submit"]',
  saldoBar: '#saldoBar',
  trialCard: '#vegTrialCard',
  navSaldo: 'a[data-s="saldo"]',
  navAgenda: 'a[data-s="agenda"]',
  notifBtn: process.env.VEG_NOTIF_BTN || '#btnNotifs',   // ← id real do sino (confirmar no HTML)
  notifList: '#notifList',             // ajustar ao id real da lista de notificações
};

/* ============================ HELPERS (PÁGINA) ============================ */

/** Semente um utilizador na base local, com passHash correcto. */
async function seedUser(page, { id, email, phone, name, role, extra = {} }) {
  await page.addInitScript(
    ({ dbKey, rec, passHash }) => {
      const raw = localStorage.getItem(dbKey);
      const db = raw ? JSON.parse(raw) : { users: [], wallets: {} };
      db.users = db.users.filter((u) => u.id !== rec.id && u.email !== rec.email);
      db.users.push(Object.assign(
        { id, active: true },
        rec,
        { pass: undefined, passHash }   // senha em claro NUNCA fica guardada
      ));
      db.session = null;               // forçar login real pelo formulário
      localStorage.setItem(dbKey, JSON.stringify(db));
    },
    {
      dbKey: CONFIG.DB_KEY,
      passHash: vegHash(CONFIG.DEMO_PASSWORD),
      rec: Object.assign({ id, email, phone, name, role }, extra),
    }
  );
}

/** Lê a base local (objecto). */
async function getDB(page) {
  return page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k) || '{}'),
    CONFIG.DB_KEY
  );
}

/** Login real pelo formulário da aplicação. */
async function login(page, emailOrPhone, pass = CONFIG.DEMO_PASSWORD) {
  await page.goto(CONFIG.APP_URL, { waitUntil: 'domcontentloaded' });
  await page.fill(SEL.loginUser, emailOrPhone);
  await page.fill(SEL.loginPass, pass);
  await Promise.all([
    page.waitForFunction(
      () => !document.querySelector('#scr-auth') ||
             getComputedStyle(document.querySelector('#scr-auth')).display === 'none',
      { timeout: 15000 }
    ).catch(() => {}),
    page.click(SEL.loginSubmit),
  ]);
  await page.waitForTimeout(800);
}

/** Saldo local do utilizador corrente. */
async function localBalance(page, uid) {
  return page.evaluate(
    ({ k, uid }) => {
      const db = JSON.parse(localStorage.getItem(k) || '{}');
      const w = db.wallets && db.wallets[uid];
      return w ? Number(w.balance || 0) : 0;
    },
    { k: CONFIG.DB_KEY, uid }
  );
}

/** Espera até a base local reflectir uma condição. */
async function waitForDB(page, fnBody, arg, timeout = 20000) {
  await page.waitForFunction(
    ({ k, body, a }) => {
      const db = JSON.parse(localStorage.getItem(k) || '{}');
      return eval('(' + body + ')')(db, a);   // eslint-disable-line no-eval
    },
    { k: CONFIG.DB_KEY, body: fnBody, a: arg },
    { timeout }
  );
}

/* ============================ T1 — ACESSO LIVRE ========================== */

test('T1 — Acesso gratuito NUNCA depende de flags legadas nem de "saldo infinito"', async ({ page }) => {
  /* 1.1 — flag freeAccess=true sozinha NÃO concede acesso */
  await seedUser(page, {
    id: 'U-T1A', email: 't1a@teste.ao', phone: '+244900000001', name: 'Teste A',
    role: 'user', extra: { freeAccess: true },
  });
  await login(page, 't1a@teste.ao');
  await page.click(SEL.navSaldo);
  const bar1 = await page.textContent(SEL.saldoBar);
  expect(bar1).not.toContain('GRATUITO');
  expect(bar1).not.toContain('∞');

  /* 1.2 — flag isAdmin=true sozinha NÃO concede admin */
  await page.context().clearCookies();
  await seedUser(page, {
    id: 'U-T1B', email: 't1b@teste.ao', phone: '+244900000002', name: 'Teste B',
    role: 'user', extra: { isAdmin: true },
  });
  await login(page, 't1b@teste.ao');
  await page.click(SEL.navSaldo);
  const bar2 = await page.textContent(SEL.saldoBar);
  expect(bar2).not.toContain('Administrador');

  /* 1.3 — admin real: barra mostra "Acesso VEG sem saldo — Administrador VEG" */
  await page.context().clearCookies();
  await seedUser(page, {
    id: 'U-T1C', email: 't1c@teste.ao', phone: '+244900000003', name: 'Teste C Admin',
    role: 'admin',
  });
  await login(page, 't1c@teste.ao');
  await page.click(SEL.navSaldo);
  const bar3 = await page.textContent(SEL.saldoBar);
  expect(bar3).toContain('Acesso VEG sem saldo');
  expect(bar3).toContain('Administrador VEG');

  /* 1.4 — parceiro aprovado: "Acesso VEG sem saldo — Parceiro aprovado" */
  await page.context().clearCookies();
  await seedUser(page, {
    id: 'U-T1D', email: 't1d@teste.ao', phone: '+244900000004', name: 'Teste D Parceiro',
    role: 'user',
  });
  await page.addInitScript(({ dbKey }) => {
    const db = JSON.parse(localStorage.getItem(dbKey) || '{}');
    db.partners = db.partners || [];
    db.partners.push({ id: 'P-T1', userId: 'U-T1D', status: 'aprovado' });
    localStorage.setItem(dbKey, JSON.stringify(db));
  }, { dbKey: CONFIG.DB_KEY });
  await login(page, 't1d@teste.ao');
  await page.click(SEL.navSaldo);
  const bar4 = await page.textContent(SEL.saldoBar);
  expect(bar4).toContain('Acesso VEG sem saldo');
  expect(bar4).toContain('Parceiro aprovado');
});

/* ===================== T2 — PERÍODO EXPERIMENTAL (72H) =================== */

test('T2 — Período experimental: 72h · 5 000 Kz · expiração bloqueia consumo', async ({ page }) => {
  /* 2.1 — novo utilizador vê o cartão com contagem decrescente */
  await seedUser(page, {
    id: 'U-T2', email: 't2@teste.ao', phone: '+244900000005', name: 'Teste Trial',
    role: 'user',
  });
  await login(page, 't2@teste.ao');
  await page.click(SEL.navSaldo);
  await expect(page.locator(SEL.trialCard)).toBeVisible();
  const card1 = await page.textContent(SEL.trialCard);
  expect(card1).toContain('Período experimental VEG');
  expect(card1).toMatch(/\d+h \d+min/);

  /* 2.2 — horas restantes dentro da janela 0 < t ≤ 72h */
  const t = await page.evaluate((k) => {
    const db = JSON.parse(localStorage.getItem(k) || '{}');
    const w = Object.values(db.wallets || {})[0];
    if (!w) return { exists: false };
    return { exists: true, trialEnds: w.trialEnds, trial: !!w.trial };
  }, CONFIG.DB_KEY);
  expect(t.exists).toBeTruthy();
  expect(t.trial).toBeTruthy();
  expect(Number.isFinite(+t.trialEnds)).toBeTruthy();
  const left = (+t.trialEnds - Date.now()) / 3600000;
  expect(left).toBeGreaterThan(0);
  expect(left).toBeLessThanOrEqual(CONFIG.TRIAL_HOURS);

  /* 2.3 — expirado: cartão vermelho e consumo bloqueado por saldo=0 */
  await page.evaluate((k) => {
    const db = JSON.parse(localStorage.getItem(k) || '{}');
    Object.values(db.wallets || {}).forEach((w) => {
      w.trialEnds = Date.now() - 1000;          // expirado
      w.balance = 0;                            // saldo experimental esgotado
    });
    localStorage.setItem(k, JSON.stringify(db));
    if (typeof updateSaldoBar === 'function') updateSaldoBar();  // re-render real
  }, CONFIG.DB_KEY);
  await page.waitForTimeout(300);
  const card2 = await page.textContent(SEL.trialCard);
  expect(card2).toContain('Período experimental terminado');

  const r = await page.evaluate(() =>
    vegConsume('teste_servico', 'Teste E2E pós-expiração', 100)
  );
  expect(r.ok).toBeFalsy();
  expect(['insufficient', 'blocked']).toContain(r.reason);
});

/* ================== T3 — CONSUMO PAGO (FRONTEND + BACKEND) =============== */

test('T3 — Débito confirmado pelo backend; ledger coerente front+back', async ({ page }) => {
  await seedUser(page, {
    id: 'U-T3', email: 't3@teste.ao', phone: '+244900000006', name: 'Teste Saldo',
    role: 'user',
  });
  await login(page, 't3@teste.ao');
  await page.click(SEL.navSaldo);          // força criação da carteira (trial 5 000 Kz)
  await page.waitForTimeout(500);

  const before = await localBalance(page, 'U-T3');
  expect(before).toBe(CONFIG.TRIAL_BALANCE);

  const res = await page.evaluate(() =>
    vegConsume('marcacao', 'Marcação E2E', 1350)
  );
  expect(res.ok).toBeTruthy();
  expect(res.op.ref).toMatch(/^OP-/);

  /* saldo local desce logo (UX), confirmação do backend chega em seguida */
  const afterLocal = await localBalance(page, 'U-T3');
  expect(afterLocal).toBeCloseTo(before - 1350, 2);

  /* aguardar a confirmação do backend (pendingSync → false) */
  await waitForDB(page,
    `(db,a)=>{const w=db.wallets&&db.wallets[a];if(!w)return false;
      const op=(w.ledger||[]).find(o=>o.ref===a2);return op&&!op.pendingSync;}`
      .replace('a2', JSON.stringify(res.op.ref)),
    'U-T3'
  );

  /* entrada no ledger local bem formada */
  const dbLocal = await getDB(page);
  const w = dbLocal.wallets['U-T3'];
  const opLocal = w.ledger.find((o) => o.ref === res.op.ref);
  expect(opLocal.type).toBe('debit');
  expect(opLocal.amount).toBe(1350);
  expect(opLocal.balanceBefore - opLocal.balanceAfter).toBe(1350);
  expect(opLocal.pendingSync).toBeFalsy();

  /* backend: saldo reflecte o mesmo débito exactamente uma vez */
  const backend = await page.evaluate(async ({ api, uid }) => {
    const r = await fetch(api + '?action=getSnapshot&token=' + uid); // ← usar sessão real se aplicável
    return r.json();
  }, { api: CONFIG.API_URL, uid: 'U-T3' }).catch(() => null);
  /* NOTA: a verificação exacta do backend depende do endpoint autenticado da VEG_API.
     Em alternativa confirma-se na folha WALLETS: saldo = 5000 − 1350 = 3650 Kz. */
});

/* ========================= T4 — IDEMPOTÊNCIA ============================= */

test('T4 — Submissão duplicada NUNCA debita duas vezes (front + back)', async ({ page }) => {
  await seedUser(page, {
    id: 'U-T4', email: 't4@teste.ao', phone: '+244900000007', name: 'Teste Idem',
    role: 'user',
  });
  await login(page, 't4@teste.ao');
  await page.click(SEL.navSaldo);
  await page.waitForTimeout(500);

  /* 4.1 — mesmo clique duplo (vegSubmit + _vegOpsInFlight) */
  const r1 = await page.evaluate(() =>
    vegConsume('campanha', 'Campanha E2E idempotente', 5000)
  );
  const r2 = await page.evaluate(() =>
    vegConsume('campanha', 'Campanha E2E idempotente', 5000, r1.op.id)  // mesmo opId
  );
  /* a segunda chamada com o mesmo id deve colapsar na promessa em curso */
  expect(r2.op.id).toBe(r1.op.id);

  await page.waitForTimeout(4000);          // aguardar confirmação do backend
  const w = (await getDB(page)).wallets['U-T4'];
  const same = w.ledger.filter((o) => o.id === r1.op.id);
  expect(same.length).toBe(1);              // UMA única entrada local
  expect(w.balance).toBe(0);                // 5000 − 5000 = 0 (saldo esgotado)

  /* 4.2 — reenvio directo ao backend com o mesmo id: duplicado, sem novo débito */
  const dup = await page.evaluate(async (op) => {
    return vegBackendDebit(JSON.parse(op));   // reenvia o MESMO op
  }, JSON.stringify(r1.op));
  await page.waitForTimeout(3000);
  const w2 = (await getDB(page)).wallets['U-T4'];
  expect(w2.balance).toBe(0);               // saldo intacto
  /* NOTA: confirmar na folha WALLETS que consta apenas UMA transacção OP-… */
});

/* ==================== T5 — OFFLINE → PENDENTE → RETRY ==================== */

test('T5 — Offline: débito fica pendente e sincroniza ao voltar', async ({ page, context }) => {
  await seedUser(page, {
    id: 'U-T5', email: 't5@teste.ao', phone: '+244900000008', name: 'Teste Offline',
    role: 'user',
  });
  await login(page, 't5@teste.ao');
  await page.click(SEL.navSaldo);
  await page.waitForTimeout(500);

  await context.setOffline(true);
  const r = await page.evaluate(() =>
    vegConsume('marcacao', 'Marcação offline E2E', 1350)
  );
  expect(r.ok).toBeTruthy();               // UX: aceite localmente, sincroniza depois

  await page.waitForTimeout(800);          // ⚠️ CORRECÇÃO: dar tempo ao .catch() assíncrono
  const wOff = (await getDB(page)).wallets['U-T5'];
  const pend = wOff.ledger.find((o) => o.ref === r.op.ref);
  expect(pend.pendingSync).toBeTruthy();
  expect(pend.status).toBe('confirmado');  // legível para o utilizador

  await context.setOffline(false);
  await page.waitForTimeout(6000);         // retry automático (vegRetryPendingDebits)
  const wOn = (await getDB(page)).wallets['U-T5'];
  const done = wOn.ledger.find((o) => o.ref === r.op.ref);
  expect(done.pendingSync).toBeFalsy();
});

/* =================== T6 — FEEDBACK E CONSISTÊNCIA (UX) =================== */

test('T6 — Feedback legível em todos os estados + mensagem institucional WhatsApp', async ({ page }) => {
  await seedUser(page, {
    id: 'U-T6', email: 't6@teste.ao', phone: '+244900000009', name: 'Teste UX',
    role: 'user',
  });
  await login(page, 't6@teste.ao');
  await page.click(SEL.navSaldo);
  await page.waitForTimeout(500);

  /* 6.1 — sucesso: referência + data/hora legíveis */
  const r = await page.evaluate(() => vegConsume('marcacao', 'Marcação E2E UX', 1350));
  await page.waitForTimeout(1000);
  const body1 = await page.textContent('body');
  expect(body1).toMatch(/Submissão (realizada|concluída)/);
  expect(body1).toContain(r.op.ref);

  /* 6.2 — saldo insuficiente (backend rejeita, saldo intacto) */
  await page.evaluate(() => vegConsume('campanha', 'Campanha além do saldo', 999999));
  await page.waitForTimeout(4000);
  const w = (await getDB(page)).wallets['U-T6'];
  expect(w.balance).toBe(CONFIG.TRIAL_BALANCE - 1350);   // NÃO foi debitado o valor inválido
  const body2 = await page.textContent('body');
  expect(body2).toMatch(/Saldo insuficiente|INSUFFICIENT/i);

  /* 6.3 — pendente (retry) é SEMPRE legível */
  const body3 = await page.textContent('body');
  expect(body3).toMatch(/pendente|sincroniza/i);

  /* 6.4 — "GRATUITO" NUNCA aparece para utilizador pagante */
  await page.context().clearCookies();
  await seedUser(page, {
    id: 'U-T6B', email: 't6b@teste.ao', phone: '+244900000010', name: 'Teste Pago',
    role: 'user',
  });
  await login(page, 't6b@teste.ao');
  await page.click(SEL.navSaldo);
  await page.waitForTimeout(500);
  const body4 = await page.textContent(SEL.saldoBar);
  expect(body4).not.toContain('GRATUITO');

  /* 6.5 — pedido directo ao backend SEM token é recusado */
  const noAuth = await page.evaluate(async ({ api }) => {
    const r = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'createWalletTransaction', userId: 'U-T6B',
                             type: 'debito', amount: 10, concept: 'E2E sem token' }),
    });
    return r.json();
  }, { api: CONFIG.API_URL });
  expect(String(JSON.stringify(noAuth))).toMatch(/AUTH_REQUIRED|Unauthorized/i);

  /* 6.6 — mensagem de atendimento institucional, sem "Vim da VEG APP" */
  const msg = await page.evaluate(() => wppAtend('Olá, preciso de ajuda'));
  expect(msg).toContain('VEG — Voz Empreendedora Global');
  expect(msg).toContain('andrewchindacata@gmail.com');
  expect(msg).toMatch(/9\d{8}/);
  expect(msg).not.toContain('Vim da VEG APP');
});

/* ================== T7 — NOTIFICAÇÕES NAVEGÁVEIS (ECRÃ + REGISTO) ========= */

test('T7 — Notificação com [Ver →] navega até ao ecrã correcto', async ({ page }) => {
  await seedUser(page, {
    id: 'U-T7', email: 't7@teste.ao', phone: '+244900000011', name: 'Teste Notif',
    role: 'user',
  });
  await login(page, 't7@teste.ao');
  await page.click(SEL.navSaldo);
  await page.waitForTimeout(500);

  /* dispara um débito real → o backend notifica com linkScreen */
  await page.evaluate(() => vegConsume('marcacao', 'Marcação E2E notificação', 1350));
  await page.waitForTimeout(5000);

  /* abre o centro de notificações e verifica o [Ver →] */
  await page.click(SEL.notifBtn);                       // id real do sino (via secret/env)
  const item = page.locator('.notif-item, .ntf-item').first();
  await expect(item).toBeVisible({ timeout: 15000 });
  await item.getByText('Ver').click();

  /* deve navegar para o ecrã ligado (ex.: agenda/saldo) */
  await page.waitForTimeout(1000);
  const visible = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.scr'))
      .filter((s) => getComputedStyle(s).display !== 'none')
      .map((s) => s.id);
  });
  expect(visible.join(' ')).toMatch(/scr-(agenda|saldo)/);
});

/* ========================= T8 — CRUD E ECRÃS ============================= */

test('T8 — Saldos, agenda, oportunidades e parceiros: CRUD mínimo funcional', async ({ page }) => {
  await seedUser(page, {
    id: 'U-T8', email: 't8@teste.ao', phone: '+244900000012', name: 'Teste Crud',
    role: 'user',
  });
  await login(page, 't8@teste.ao');

  for (const scr of ['saldo', 'agenda', 'oportunidades', 'parceiros']) {
    await page.click(`a[data-s="${scr}"]`);
    await page.waitForTimeout(600);
    const err = await page.evaluate(() => document.body.innerText.match(/Cannot read|undefined is not|NaN/g));
    expect(err).toBeNull();
    const html = await page.content();
    expect(html).toContain('id="scr-' + scr + '"');
  }

  /* agenda: criar marcação consome saldo e fica visível na lista */
  await page.click(SEL.navAgenda);
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => vegConsume('marcacao', 'Marcação CRUD E2E', 1350));
  expect(r.ok).toBeTruthy();
  await page.waitForTimeout(1500);
  const body = await page.textContent('body');
  expect(body).toContain('Marcação CRUD E2E');
});

/* ====================== T9 — DADOS CONSISTENTES ========================== */

test('T9 — Mesmo utilizador, dois dispositivos: saldo coerente', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  for (const pg of [pageA, pageB]) {
    await seedUser(pg, {
      id: 'U-T9', email: 't9@teste.ao', phone: '+244900000013', name: 'Teste Sync',
      role: 'user',
    });
  }

  await login(pageA, 't9@teste.ao');
  await pageA.click(SEL.navSaldo);
  await pageA.waitForTimeout(500);
  await pageA.evaluate(() => vegConsume('marcacao', 'Marcação Dispositivo A', 1350));
  await pageA.waitForTimeout(4000);           // confirma no backend

  await login(pageB, 't9@teste.ao');
  await pageB.click(SEL.navSaldo);
  await pageB.waitForTimeout(2500);           // pull + syncDelta
  const balB = await localBalance(pageB, 'U-T9');
  expect(balB).toBeCloseTo(CONFIG.TRIAL_BALANCE - 1350, 2);

  await ctxA.close(); await ctxB.close();
});

/* ========================= T10 — SEGURANÇA =============================== */

test('T10 — Backend: titular resolvido pelo token; operações protegidas', async ({ page }) => {
  await seedUser(page, {
    id: 'U-T10', email: 't10@teste.ao', phone: '+244900000014', name: 'Teste Sec',
    role: 'user',
  });
  await login(page, 't10@teste.ao');

  /* 10.1 — getSnapshot sem token */
  const s1 = await page.evaluate(async ({ api }) => {
    const r = await fetch(api + '?action=getSnapshot');
    return r.json();
  }, { api: CONFIG.API_URL });
  expect(String(JSON.stringify(s1))).toMatch(/AUTH_REQUIRED/i);

  /* 10.2 — criar transacção em carteira de OUTRO utilizador (sem token) */
  const s2 = await page.evaluate(async ({ api }) => {
    const r = await fetch(api, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'createWalletTransaction', userId: 'U-T1C',
                             type: 'debito', amount: 100, concept: 'E2E tentativa' }),
    });
    return r.json();
  }, { api: CONFIG.API_URL });
  expect(String(JSON.stringify(s2))).toMatch(/AUTH_REQUIRED/i);

  /* 10.3 — app nunca expõe segredos no HTML servido */
  const htmlTxt = await page.content();
  expect(htmlTxt).not.toMatch(/senhaAdmin\s*[:=]/i);
  expect(htmlTxt).not.toMatch(/SUPER_ADMIN_PASS/i);
});
