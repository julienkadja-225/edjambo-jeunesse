import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edjambo-feat-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.SEED_MEMBERS = '60';
process.env.AUTH_RATE_LIMIT = '1000';
process.env.API_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT_ANON = '100000';
process.env.SMS_PROVIDER = 'console';

let server, base;
before(async () => {
  await import('../src/seed.js');
  const { createApp } = await import('../src/app.js');
  await new Promise((res) => (server = createApp().listen(0, res)));
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

async function call(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  return { status: res.status, data, res };
}
const login = async (identifier, password) => (await call('POST', '/auth/login', { body: { identifier, password } })).data;
const member = (n) => login(`membre${n}@edjambo.org`, 'Jeunesse2026!');
const admin = (name) => login(`${name}@edjambo.org`, 'Admin@2026');
const PNG = () => new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], { type: 'image/png' });
const expenseForm = (o = {}, withReceipt = false) => {
  const f = new FormData();
  const d = { amount: '5000', category: 'materiel', description: 'Achat de ballons', spent_at: new Date().toISOString().slice(0, 10), ...o };
  Object.entries(d).forEach(([k, v]) => f.append(k, v));
  if (withReceipt) f.append('receipt', PNG(), 'recu.png');
  return f;
};
const today = () => { const d = new Date(); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };

/* ===================== Finances ===================== */
test('finances : permissions, double validation, solde et visibilité des membres', async () => {
  const nadia = await admin('nadia'); // finance + payments
  const aicha = await admin('aicha'); // toutes permissions
  const serge = await admin('serge'); // sans « finance »
  const m = await member(1);

  assert.equal((await call('POST', '/finance/expenses', { token: m.accessToken, form: expenseForm() })).status, 403);
  assert.equal((await call('POST', '/finance/expenses', { token: serge.accessToken, form: expenseForm() })).status, 403);
  const before = (await call('GET', '/finance/summary', { token: m.accessToken })).data;
  assert.equal(before.pending_expenses, undefined); // information réservée aux responsables financiers

  // validations de saisie
  assert.equal((await call('POST', '/finance/expenses', { token: nadia.accessToken, form: expenseForm({ amount: '-5' }) })).status, 400);
  assert.equal((await call('POST', '/finance/expenses', { token: nadia.accessToken, form: expenseForm({ category: 'piratage' }) })).status, 400);
  assert.equal((await call('POST', '/finance/expenses', { token: nadia.accessToken, form: expenseForm({ spent_at: '2099-01-01' }) })).status, 400);
  // justificatif obligatoire au-delà du seuil (10 000 FCFA)
  assert.equal((await call('POST', '/finance/expenses', { token: nadia.accessToken, form: expenseForm({ amount: '50000' }) })).status, 400);

  const created = await call('POST', '/finance/expenses', { token: nadia.accessToken, form: expenseForm({ amount: '50000', description: 'Sonorisation du concert' }, true) });
  assert.equal(created.status, 201);
  const id = created.data.id;

  // le créateur ne peut pas valider sa propre dépense ; elle n'est pas comptée tant qu'elle est en attente
  assert.equal((await call('POST', `/finance/expenses/${id}/approve`, { token: nadia.accessToken })).status, 403);
  assert.equal((await call('GET', '/finance/summary', { token: m.accessToken })).data.total_expenses, before.total_expenses);
  // invisible pour un membre, y compris son justificatif
  const memberList = (await call('GET', '/finance/expenses?limit=100', { token: m.accessToken })).data.items;
  assert.ok(!memberList.some((e) => e.id === id));
  assert.equal((await call('GET', `/finance/expenses/${id}/receipt`, { token: m.accessToken })).status, 403);

  // rejet : motif obligatoire
  assert.equal((await call('POST', `/finance/expenses/${id}/reject`, { token: aicha.accessToken, body: {} })).status, 400);
  assert.equal((await call('POST', `/finance/expenses/${id}/reject`, { token: aicha.accessToken, body: { reason: 'Montant à préciser' } })).status, 200);
  assert.equal((await call('POST', `/finance/expenses/${id}/approve`, { token: aicha.accessToken })).status, 409); // déjà traitée
  // correction par son auteur : repasse en attente
  assert.equal((await call('PUT', `/finance/expenses/${id}`, { token: nadia.accessToken, form: expenseForm({ amount: '48000', description: 'Sonorisation (devis corrigé)' }) })).status, 200);
  assert.equal((await call('POST', `/finance/expenses/${id}/approve`, { token: aicha.accessToken })).status, 200);

  // comptée dans la synthèse : solde = solde initial + cotisations validées − dépenses validées
  const after = (await call('GET', '/finance/summary', { token: m.accessToken })).data;
  assert.equal(after.total_expenses, before.total_expenses + 48000);
  assert.equal(after.balance, after.opening_balance + after.total_income - after.total_expenses);
  assert.equal(after.balance, before.balance - 48000);
  assert.ok(after.month_expenses >= 48000);

  // visible des membres sans aucun nom d'administrateur ; justificatif consultable (transparence activée)
  const visible = (await call('GET', '/finance/expenses?limit=100', { token: m.accessToken })).data.items.find((e) => e.id === id);
  assert.equal(visible.creator_first, undefined);
  assert.equal(visible.reviewer_first, undefined);
  assert.equal((await call('GET', `/finance/expenses/${id}/receipt`, { token: m.accessToken })).res.status, 200);
  // …sauf si les responsables désactivent la transparence des justificatifs
  assert.equal((await call('PUT', '/finance/settings', { token: aicha.accessToken, body: { public_receipts: false } })).status, 200);
  assert.equal((await call('GET', `/finance/expenses/${id}/receipt`, { token: m.accessToken })).status, 403);
  assert.equal((await call('GET', `/finance/expenses/${id}/receipt`, { token: aicha.accessToken })).res.status, 200);
  await call('PUT', '/finance/settings', { token: aicha.accessToken, body: { public_receipts: true } });

  // une dépense validée est définitive
  assert.equal((await call('PUT', `/finance/expenses/${id}`, { token: nadia.accessToken, form: expenseForm() })).status, 409);
  assert.equal((await call('DELETE', `/finance/expenses/${id}`, { token: nadia.accessToken })).status, 409);
});

test('finances : budgets, rapport mensuel cohérent, publication, export CSV', async () => {
  const aicha = await admin('aicha');
  const m = await member(1);
  const year = new Date().getUTCFullYear();
  assert.equal((await call('PUT', '/finance/budgets', { token: aicha.accessToken, body: { year, category: 'materiel', amount: 300000 } })).status, 200);
  assert.equal((await call('PUT', '/finance/budgets', { token: m.accessToken, body: { year, category: 'materiel', amount: 1 } })).status, 403);
  const sum = (await call('GET', '/finance/summary', { token: m.accessToken })).data;
  const mat = sum.budgets.find((b) => b.category === 'materiel');
  assert.equal(mat.planned, 300000);
  assert.ok(mat.spent > 0);
  assert.equal(sum.history.length, 12);

  const rep = (await call('GET', '/finance/report', { token: m.accessToken })).data;
  assert.equal(rep.closing_balance, sum.balance); // le solde du rapport du mois courant = le solde actuel
  assert.equal(rep.closing_balance, rep.opening_balance + rep.income.total - rep.expenses.total);

  const before = (await call('GET', '/notifications/unread-count', { token: m.accessToken })).data.count;
  const pub = await call('POST', '/finance/report/publish', { token: aicha.accessToken, body: {} });
  assert.equal(pub.status, 201);
  assert.equal((await call('POST', '/finance/report/publish', { token: m.accessToken, body: {} })).status, 403);
  assert.ok((await call('GET', '/notifications/unread-count', { token: m.accessToken })).data.count > before);
  const ann = (await call('GET', `/announcements/${pub.data.id}`, { token: m.accessToken })).data;
  assert.match(ann.body, /Solde de clôture/);

  const csv = await fetch(`${base}/finance/expenses.csv`, { headers: { Authorization: `Bearer ${aicha.accessToken}` } });
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /Montant \(FCFA\)/);
  assert.equal((await fetch(`${base}/finance/expenses.csv`, { headers: { Authorization: `Bearer ${m.accessToken}` } })).status, 403);
});

/* ===================== Vérification assistée par SMS ===================== */
test('paiement par SMS : analyse, ré-analyse serveur, validation en masse des seuls cohérents', async () => {
  const m4 = await member(4); // actif, sans cotisation du mois
  const m6 = await member(6);
  const m7 = await member(7);
  const good = `Orange Money: Vous avez envoye 1000 FCFA a 0700000001 (JEUNESSE EDJAMBO) le ${today()}. ID de transaction: CI.GOOD.77421. Frais: 0 FCFA.`;
  const bad = `Orange Money: Vous avez envoye 500 FCFA a 0799999999 le ${today()}. ID de transaction: CI.BAD.99120.`;

  const a = (await call('POST', '/contributions/parse-sms', { token: m4.accessToken, body: { text: good } })).data;
  assert.equal(a.level, 'consistent');
  assert.equal(a.parsed.amount, 1000);
  assert.equal(a.parsed.reference, 'CI.GOOD.77421');
  assert.equal(a.suggested.method_id, 1);
  const b = (await call('POST', '/contributions/parse-sms', { token: m4.accessToken, body: { text: bad } })).data;
  assert.equal(b.level, 'review');
  assert.deepEqual(b.flags.map((f) => f.code).sort(), ['amount_low', 'recipient_mismatch']);
  assert.equal((await call('POST', '/contributions/parse-sms', { token: m4.accessToken, body: { text: 'court' } })).status, 400);

  const submit = (token, sms, extra = {}) => {
    const f = new FormData();
    f.append('method_id', '1');
    f.append('sms_text', sms);
    Object.entries(extra).forEach(([k, v]) => f.append(k, v));
    return call('POST', '/contributions', { token, form: f });
  };
  // aucune référence saisie : elle est lue dans le SMS ; le niveau est recalculé côté serveur
  const c1 = await submit(m4.accessToken, good, { sms_level: 'consistent' });
  const c2 = await submit(m6.accessToken, bad, { sms_level: 'consistent' }); // le client ne peut pas imposer le niveau
  assert.equal(c1.status, 201);
  assert.equal(c2.status, 201);

  const nadia = await admin('nadia');
  const list = (await call('GET', '/contributions?status=pending&limit=100', { token: nadia.accessToken })).data.items;
  const r1 = list.find((x) => x.id === c1.data.id);
  const r2 = list.find((x) => x.id === c2.data.id);
  assert.equal(r1.sms_level, 'consistent');
  assert.equal(r1.reference, 'CI.GOOD.77421');
  assert.equal(r2.sms_level, 'review');
  assert.ok(r2.sms_flags.some((f) => f.code === 'recipient_mismatch'));
  assert.equal((await call('GET', '/contributions?status=pending&level=review&limit=100', { token: nadia.accessToken })).data.items.every((x) => x.sms_level === 'review'), true);

  // la même référence ne peut pas être réutilisée
  assert.equal((await submit(m7.accessToken, good)).status, 409);

  // validation en masse : seul le paiement cohérent passe
  assert.equal((await call('POST', '/contributions/bulk-approve', { token: m4.accessToken, body: { ids: [c1.data.id] } })).status, 403);
  const bulk = await call('POST', '/contributions/bulk-approve', { token: nadia.accessToken, body: { ids: [c1.data.id, c2.data.id] } });
  assert.deepEqual([bulk.data.approved, bulk.data.skipped], [1, 1]);
  assert.equal((await call('GET', '/contributions/mine', { token: m4.accessToken })).data.items[0].status, 'approved');
  assert.equal((await call('GET', '/contributions/mine', { token: m6.accessToken })).data.items[0].status, 'pending');
});

/* ===================== Passerelle SMS / WhatsApp ===================== */
test('passerelle : numéros, consentement obligatoire, canaux, événements et plafond', async () => {
  const { normalizePhone, maskPhone } = await import('../src/gateway.js');
  assert.equal(normalizePhone('0700100001'), '+2250700100001');
  assert.equal(normalizePhone('+225 07 00 10 00 01'), '+2250700100001');
  assert.equal(normalizePhone('00225 0700100001'), '+2250700100001');
  assert.equal(normalizePhone('abc'), null);
  assert.ok(!maskPhone('+2250700100001').includes('0700100'));

  const sa = await admin('superadmin');
  const aicha = await admin('aicha');
  const m = await member(1);
  // réservé au Super Admin
  assert.equal((await call('GET', '/admin/sms/status', { token: m.accessToken })).status, 403);
  assert.equal((await call('GET', '/admin/sms/status', { token: aicha.accessToken })).status, 403);
  const st = (await call('GET', '/admin/sms/status', { token: sa.accessToken })).data;
  assert.equal(st.provider.simulated, true);
  assert.ok(st.events.includes('election'));

  // ouverture d'une élection → notification de masse : seuls les membres consentants reçoivent un SMS/WhatsApp
  const lea = await admin('lea');
  const draft = (await call('GET', '/elections', { token: lea.accessToken })).data.find((e) => e.status === 'draft');
  assert.equal((await call('POST', `/elections/${draft.id}/open`, { token: lea.accessToken })).status, 200);
  const out = (await call('GET', '/admin/sms/outbox?limit=100', { token: sa.accessToken })).data;
  const election = out.items.filter((o) => o.event_type === 'election');
  assert.equal(election.length, 6); // 4 en SMS + 2 en WhatsApp (seed), personne d'autre
  assert.equal(election.filter((o) => o.channel === 'whatsapp').length, 2);
  assert.ok(election.every((o) => o.status === 'queued' && !o.to_addr.includes('0700')));
  assert.ok(election.every((o) => o.body.length <= 320 && /Élection ouverte/.test(o.body)));
  assert.ok((await call('POST', '/admin/sms/process', { token: sa.accessToken })).data.processed >= 6); // + le SMS « paiement » des tests précédents
  assert.equal((await call('GET', '/admin/sms/outbox?status=simulated&limit=100', { token: sa.accessToken })).data.items.filter((o) => o.event_type === 'election').length, 6);

  // rappels activés : membre7 (WhatsApp, cotisation du mois non réglée) en reçoit un ; chaque rappel n'est envoyé qu'une fois par mois
  await call('PUT', '/admin/sms/settings', { token: sa.accessToken, body: { events: ['reminder', 'payment'], daily_cap: 1000 } });
  const nadia0 = await admin('nadia');
  // un membre tout juste inscrit (donc sans cotisation) consent à WhatsApp
  const rf = new FormData();
  Object.entries({ first_name: 'Rappel', last_name: 'Test', phone: '+2250799001122', password: 'Motdepasse1', age: '22', neighborhood: 'Gare', accept_terms: '1' }).forEach(([k, v]) => rf.append(k, v));
  const reg = await call('POST', '/auth/register', { form: rf });
  await call('PATCH', `/members/${reg.data.id}/status`, { token: aicha.accessToken, body: { status: 'active' } });
  const rt = await login('+2250799001122', 'Motdepasse1');
  assert.equal((await call('PUT', '/auth/me/notification-prefs', { token: rt.accessToken, body: { whatsapp_optin: true } })).status, 200);
  await call('POST', '/contributions/reminders', { token: nadia0.accessToken });
  const reminders = (await call('GET', '/admin/sms/outbox?limit=100', { token: sa.accessToken })).data.items.filter((o) => o.event_type === 'reminder');
  assert.ok(reminders.some((o) => o.channel === 'whatsapp'));
  const nReminders = reminders.length;
  await call('POST', '/contributions/reminders', { token: nadia0.accessToken });
  assert.equal((await call('GET', '/admin/sms/outbox?limit=100', { token: sa.accessToken })).data.items.filter((o) => o.event_type === 'reminder').length, nReminders);

  // événement désactivé → rien n'est envoyé (ici : « paiement » retiré de la liste)
  await call('PUT', '/admin/sms/settings', { token: sa.accessToken, body: { events: ['election'] } });
  const total1 = (await call('GET', '/admin/sms/outbox', { token: sa.accessToken })).data.total;
  const m5 = await member(5);
  const f5 = new FormData(); f5.append('method_id', '1'); f5.append('reference', 'FILTRE-1'); f5.append('month', '2025-06');
  const c5 = await call('POST', '/contributions', { token: m5.accessToken, form: f5 });
  assert.equal((await call('POST', `/contributions/${c5.data.id}/approve`, { token: nadia0.accessToken })).status, 200);
  assert.equal((await call('GET', '/admin/sms/outbox', { token: sa.accessToken })).data.total, total1);

  // plafond journalier : au-delà, les messages sont « ignorés » et non envoyés
  await call('PUT', '/admin/sms/settings', { token: sa.accessToken, body: { daily_cap: 0, events: ['payment'] } });
  const nadia = await admin('nadia');
  const c = await call('POST', '/contributions', {
    token: (await member(7)).accessToken,
    form: (() => { const f = new FormData(); f.append('method_id', '1'); f.append('reference', 'PLAFOND-1'); f.append('month', '2025-07'); return f; })(),
  });
  assert.equal(c.status, 201);
  assert.equal((await call('POST', `/contributions/${c.data.id}/approve`, { token: nadia.accessToken })).status, 200);
  const skipped = (await call('GET', '/admin/sms/outbox?status=skipped', { token: sa.accessToken })).data;
  assert.ok(skipped.total >= 1);
  assert.match(skipped.items[0].error, /Plafond/);
});

test('passerelle : préférences (téléphone requis) et reprise sur incident du prestataire', async () => {
  const sa = await admin('superadmin');
  // sans numéro de téléphone, impossible de consentir
  const f = new FormData();
  Object.entries({ first_name: 'Sans', last_name: 'Téléphone', email: 'sans.tel@test.org', password: 'Motdepasse1', age: '21', neighborhood: 'Gare', accept_terms: '1' }).forEach(([k, v]) => f.append(k, v));
  const reg = await call('POST', '/auth/register', { form: f });
  await call('PATCH', `/members/${reg.data.id}/status`, { token: (await admin('aicha')).accessToken, body: { status: 'active' } });
  const nt = await login('sans.tel@test.org', 'Motdepasse1');
  assert.equal((await call('PUT', '/auth/me/notification-prefs', { token: nt.accessToken, body: { sms_optin: true } })).status, 400);
  // un membre avec téléphone peut consentir puis se rétracter
  const m = await member(8);
  const on = await call('PUT', '/auth/me/notification-prefs', { token: m.accessToken, body: { sms_optin: true, whatsapp_optin: false } });
  assert.equal(on.data.sms_optin, true);
  assert.equal((await call('PUT', '/auth/me/notification-prefs', { token: m.accessToken, body: {} })).data.sms_optin, false);
  assert.ok(Array.isArray((await call('GET', '/notifications/channels', { token: m.accessToken })).data.events));

  // prestataire webhook : 1re tentative en échec, 2e réussie ; échec définitif après 3 essais, puis reprise manuelle
  let calls = 0;
  let failAll = false;
  const hook = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      calls++;
      if (failAll || calls === 1) { res.statusCode = 503; return res.end('{}'); }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id: 'prov-' + calls, echo: JSON.parse(b).to }));
    });
  });
  await new Promise((r) => hook.listen(0, r));
  await call('POST', '/admin/sms/process', { token: sa.accessToken }); // vide la file laissée par le test précédent (mode simulation)
  process.env.SMS_PROVIDER = 'webhook';
  process.env.SMS_WEBHOOK_URL = `http://localhost:${hook.address().port}`;
  try {
    await call('PUT', '/admin/sms/settings', { token: sa.accessToken, body: { events: ['payment'], daily_cap: 1000 } });
    await call('PUT', '/auth/me/notification-prefs', { token: m.accessToken, body: { sms_optin: true } });
    const mk = async (ref) => {
      const form = new FormData(); form.append('method_id', '1'); form.append('reference', ref); form.append('month', '2025-03');
      const c = await call('POST', '/contributions', { token: m.accessToken, form });
      await call('POST', `/contributions/${c.data.id}/approve`, { token: (await admin('nadia')).accessToken });
    };
    await mk('HOOK-1');
    await call('POST', '/admin/sms/process', { token: sa.accessToken }); // échec (503) → reste en file
    let q = (await call('GET', '/admin/sms/outbox?status=queued', { token: sa.accessToken })).data;
    assert.equal(q.total, 1);
    assert.equal(q.items[0].attempts, 1);
    await call('POST', '/admin/sms/process', { token: sa.accessToken }); // réussite
    const sent = (await call('GET', '/admin/sms/outbox?status=sent', { token: sa.accessToken })).data;
    assert.equal(sent.total, 1);
    assert.match(sent.items[0].body, /Cotisation valid/);

    // échec définitif après 3 tentatives, puis reprise manuelle
    failAll = true;
    const m9 = await member(9);
    await call('PUT', '/auth/me/notification-prefs', { token: m9.accessToken, body: { sms_optin: true } });
    const form = new FormData(); form.append('method_id', '1'); form.append('reference', 'HOOK-2'); form.append('month', '2025-04');
    const c = await call('POST', '/contributions', { token: m9.accessToken, form });
    await call('POST', `/contributions/${c.data.id}/approve`, { token: (await admin('nadia')).accessToken });
    for (let i = 0; i < 3; i++) await call('POST', '/admin/sms/process', { token: sa.accessToken });
    assert.equal((await call('GET', '/admin/sms/outbox?status=failed', { token: sa.accessToken })).data.total, 1);
    failAll = false;
    assert.equal((await call('POST', '/admin/sms/retry-failed', { token: sa.accessToken })).data.requeued, 1);
    await call('POST', '/admin/sms/process', { token: sa.accessToken });
    assert.equal((await call('GET', '/admin/sms/outbox?status=failed', { token: sa.accessToken })).data.total, 0);
    assert.equal((await call('GET', '/admin/sms/outbox?status=sent', { token: sa.accessToken })).data.total, 2);
  } finally {
    process.env.SMS_PROVIDER = 'console';
    delete process.env.SMS_WEBHOOK_URL;
    hook.close();
  }
});
