import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edjambo-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.SEED_MEMBERS = '60';
process.env.AUTH_RATE_LIMIT = '1000';

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
  return { status: res.status, data };
}
const login = async (identifier, password) => (await call('POST', '/auth/login', { body: { identifier, password } })).data;

test('inscription → en attente → refus de connexion → approbation → connexion', async () => {
  const form = new FormData();
  Object.entries({ first_name: 'Test', last_name: 'Jeune', email: 'nouveau@test.org', password: 'Motdepasse1', age: '22', neighborhood: 'Centre-ville' }).forEach(([k, v]) => form.append(k, v));
  const reg = await call('POST', '/auth/register', { form });
  assert.equal(reg.status, 201);
  assert.equal((await call('POST', '/auth/login', { body: { identifier: 'nouveau@test.org', password: 'Motdepasse1' } })).status, 403);
  const admin = await login('aicha@edjambo.org', 'Admin@2026');
  const ok = await call('PATCH', `/members/${reg.data.id}/status`, { token: admin.accessToken, body: { status: 'active' } });
  assert.equal(ok.status, 200);
  const s = await login('nouveau@test.org', 'Motdepasse1');
  assert.ok(s.accessToken);
  // le membre reçoit sa notification d'approbation
  const n = await call('GET', '/notifications', { token: s.accessToken });
  assert.ok(n.data.items.some((x) => x.title.includes('approuvée')));
});

test('contrôle d\'accès : un membre ne peut pas accéder au back-office', async () => {
  const m = await login('membre1@edjambo.org', 'Jeunesse2026!');
  assert.equal((await call('GET', '/admin/stats', { token: m.accessToken })).status, 403);
  assert.equal((await call('GET', '/contributions', { token: m.accessToken })).status, 403);
  assert.equal((await call('GET', '/members')).status, 401);
  // admin sans permission « elections »
  const nadia = await login('nadia@edjambo.org', 'Admin@2026');
  assert.equal((await call('POST', '/elections', { token: nadia.accessToken, body: {} })).status, 403);
});

test('refresh token : rotation, ancien jeton invalidé', async () => {
  const s = await login('membre1@edjambo.org', 'Jeunesse2026!');
  const r1 = await call('POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } });
  assert.equal(r1.status, 200);
  assert.equal((await call('POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } })).status, 401);
});

test('cotisation : soumission, doublon refusé, rejet puis validation', async () => {
  const m = await login('membre4@edjambo.org', 'Jeunesse2026!');
  const send = (ref) => {
    const f = new FormData();
    f.append('method_id', '1'); f.append('reference', ref);
    return call('POST', '/contributions', { token: m.accessToken, form: f });
  };
  const c = await send('REF-001');
  assert.equal(c.status, 201);
  assert.equal((await send('REF-002')).status, 409); // déjà en attente
  const admin = await login('nadia@edjambo.org', 'Admin@2026');
  assert.equal((await call('POST', `/contributions/${c.data.id}/reject`, { token: admin.accessToken, body: {} })).status, 400); // motif obligatoire
  assert.equal((await call('POST', `/contributions/${c.data.id}/reject`, { token: admin.accessToken, body: { reason: 'Capture illisible' } })).status, 200);
  assert.equal((await call('POST', `/contributions/${c.data.id}/approve`, { token: admin.accessToken })).status, 409); // déjà traité
  const c2 = await send('REF-003');
  assert.equal((await call('POST', `/contributions/${c2.data.id}/approve`, { token: admin.accessToken })).status, 200);
  const mine = await call('GET', '/contributions/mine', { token: m.accessToken });
  assert.equal(mine.data.up_to_date, true);
});

test('upload : format et signature vérifiés', async () => {
  const m = await login('membre3@edjambo.org', 'Jeunesse2026!');
  const f = new FormData();
  f.append('method_id', '1'); f.append('month', '2020-01');
  f.append('proof', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
  assert.equal((await call('POST', '/contributions', { token: m.accessToken, form: f })).status, 400);
  const g = new FormData();
  g.append('method_id', '1');
  g.append('proof', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'virus.exe');
  assert.equal((await call('POST', '/contributions', { token: m.accessToken, form: g })).status, 400);
});

test('élection : un vote par membre, cotisation exigée, audit vérifiable', async () => {
  const admin = await login('lea@edjambo.org', 'Admin@2026');
  const list = (await call('GET', '/elections', { token: admin.accessToken })).data;
  const open = list.find((e) => e.status === 'open');
  const detail = (await call('GET', `/elections/${open.id}`, { token: admin.accessToken })).data;
  const cand = detail.candidates[0].id;

  const late = await login('membre4@edjambo.org', 'Jeunesse2026!');
  // membre4 est à jour après le test précédent ; on utilise donc un membre sans paiement validé : membre3 (preuve en attente)
  const pending = await login('membre3@edjambo.org', 'Jeunesse2026!');
  assert.equal((await call('POST', `/elections/${open.id}/vote`, { token: pending.accessToken, body: { candidate_id: cand } })).status, 403);

  const m = await login('membre1@edjambo.org', 'Jeunesse2026!');
  const v = await call('POST', `/elections/${open.id}/vote`, { token: m.accessToken, body: { candidate_id: cand } });
  assert.equal(v.status, 201);
  assert.ok(v.data.receipt);
  assert.equal((await call('POST', `/elections/${open.id}/vote`, { token: m.accessToken, body: { candidate_id: cand } })).status, 409);
  assert.equal((await call('POST', `/elections/${open.id}/vote`, { token: late.accessToken, body: { candidate_id: 999999 } })).status, 400);

  const ver = await call('POST', `/elections/${open.id}/verify-receipt`, { token: m.accessToken, body: { receipt: v.data.receipt } });
  assert.equal(ver.data.found, true);
  // résultats cachés aux membres tant que non publiés, visibles à l'admin
  const asMember = (await call('GET', `/elections/${open.id}`, { token: m.accessToken })).data;
  assert.equal(asMember.candidates[0].votes, undefined);
  assert.equal((await call('GET', `/elections/${open.id}/audit`, { token: m.accessToken })).status, 403);
  const audit = (await call('GET', `/elections/${open.id}/audit`, { token: admin.accessToken })).data;
  assert.equal(audit.chain_valid, true);
  assert.equal(audit.consistent, true);
  // aucun identifiant de votant dans l'audit
  assert.ok(!JSON.stringify(audit).includes('user_id'));
});

test('forum : réponse, notification, propositions, modération', async () => {
  const m = await login('membre1@edjambo.org', 'Jeunesse2026!');
  const t = await call('POST', '/forum/threads', { token: m.accessToken, body: { type: 'proposal', title: 'Proposition test', body: 'Une idée pour la ville' } });
  assert.equal(t.status, 201);
  const v1 = await call('POST', `/forum/threads/${t.data.id}/vote`, { token: m.accessToken, body: { value: 1 } });
  assert.equal(v1.data.score, 1);
  const v2 = await call('POST', `/forum/threads/${t.data.id}/vote`, { token: m.accessToken, body: { value: 1 } });
  assert.equal(v2.data.score, 0); // annulation
  const boris = await login('boris@edjambo.org', 'Admin@2026');
  await call('PATCH', `/forum/threads/${t.data.id}`, { token: boris.accessToken, body: { closed: true } });
  assert.equal((await call('POST', `/forum/threads/${t.data.id}/posts`, { token: m.accessToken, body: { body: 'salut' } })).status, 403);
  await call('PATCH', `/forum/threads/${t.data.id}`, { token: boris.accessToken, body: { hidden: true } });
  assert.equal((await call('GET', `/forum/threads/${t.data.id}`, { token: m.accessToken })).status, 404);
});

test('annonces : le HTML est assaini, notification de masse, page publique', async () => {
  const boris = await login('boris@edjambo.org', 'Admin@2026');
  const f = new FormData();
  f.append('type', 'announcement'); f.append('title', 'Annonce test');
  f.append('body', '<p>Bonjour</p><script>alert(1)</script><img src=x onerror=alert(1)>');
  const a = await call('POST', '/announcements', { token: boris.accessToken, form: f });
  assert.equal(a.status, 201);
  const pub = await call('GET', `/public/announcements/${a.data.id}`);
  assert.equal(pub.status, 200);
  assert.ok(!pub.data.body.includes('script') && !pub.data.body.includes('onerror'));
  const m = await login('membre1@edjambo.org', 'Jeunesse2026!');
  assert.equal((await call('GET', '/notifications/unread-count', { token: m.accessToken })).data.count > 0, true);
});

test('annuaire : pagination et confidentialité', async () => {
  const m = await login('membre1@edjambo.org', 'Jeunesse2026!');
  const dir = (await call('GET', '/members?limit=10', { token: m.accessToken })).data;
  assert.equal(dir.items.length, 10);
  assert.equal(dir.items[0].email, undefined); // pas de coordonnées pour un simple membre
  const admin = await login('serge@edjambo.org', 'Admin@2026');
  const adm = (await call('GET', '/members?payment=unpaid&status=active', { token: admin.accessToken })).data;
  assert.ok(adm.total > 0 && adm.items[0].email);
});

test('mot de passe oublié : lien à usage unique, réponse neutre, anciennes sessions révoquées', async () => {
  const unknown = await call('POST', '/auth/forgot', { body: { identifier: 'inconnu@test.org' } });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.dev_link, undefined); // aucun lien pour un compte inexistant
  const s = await login('membre3@edjambo.org', 'Jeunesse2026!');
  const f = await call('POST', '/auth/forgot', { body: { identifier: 'membre3@edjambo.org' } });
  assert.equal(f.status, 200);
  assert.equal(f.data.message, unknown.data.message);
  const token = f.data.dev_link.split('/').pop();
  assert.equal((await call('GET', `/auth/reset/${token}`)).data.valid, true);
  assert.equal((await call('POST', '/auth/reset', { body: { token, password: 'court' } })).status, 400);
  assert.equal((await call('POST', '/auth/reset', { body: { token, password: 'seulementdeslettres' } })).status, 400);
  assert.equal((await call('POST', '/auth/reset', { body: { token, password: 'NouveauPass42' } })).status, 200);
  assert.equal((await call('POST', '/auth/reset', { body: { token, password: 'AutrePass4242' } })).status, 400); // jeton déjà utilisé
  assert.equal((await call('POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } })).status, 401);
  assert.ok((await login('membre3@edjambo.org', 'NouveauPass42')).accessToken);
});

test('verrouillage après 5 échecs puis déverrouillage par un admin', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/login', { body: { identifier: 'membre6@edjambo.org', password: 'mauvais123' } })).status, 401);
  const locked = await call('POST', '/auth/login', { body: { identifier: 'membre6@edjambo.org', password: 'Jeunesse2026!' } });
  assert.equal(locked.status, 423);
  const admin = await login('serge@edjambo.org', 'Admin@2026');
  const id = (await call('GET', '/members?q=membre6@', { token: admin.accessToken })).data.items[0].id;
  assert.equal((await call('POST', `/members/${id}/unlock`, { token: admin.accessToken })).status, 200);
  assert.ok((await login('membre6@edjambo.org', 'Jeunesse2026!')).accessToken);
});

test('réinitialisation par un admin : mot de passe temporaire, changement obligatoire', async () => {
  const admin = await login('serge@edjambo.org', 'Admin@2026');
  const id = (await call('GET', '/members?q=membre7@', { token: admin.accessToken })).data.items[0].id;
  const r = await call('POST', `/members/${id}/reset-password`, { token: admin.accessToken });
  assert.equal(r.status, 200);
  const temp = r.data.temporary_password;
  assert.equal((await call('POST', '/auth/login', { body: { identifier: 'membre7@edjambo.org', password: 'Jeunesse2026!' } })).status, 401);
  const s = await login('membre7@edjambo.org', temp);
  assert.equal(s.user.must_change_password, true);
  // tant que le mot de passe n'est pas changé, le reste de l'API est bloqué
  const blocked = await call('GET', '/members', { token: s.accessToken });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await call('PUT', '/auth/me/password', { token: s.accessToken, body: { current: temp, next: temp } })).status, 400);
  const changed = await call('PUT', '/auth/me/password', { token: s.accessToken, body: { current: temp, next: 'MonNouveauPass7' } });
  assert.equal(changed.status, 200);
  assert.equal((await call('GET', '/members', { token: changed.data.accessToken })).status, 200);
  // un admin « payments » seul ne peut pas réinitialiser ; le journal d'activité est réservé au Super Admin
  const nadia = await login('nadia@edjambo.org', 'Admin@2026');
  assert.equal((await call('POST', `/members/${id}/reset-password`, { token: nadia.accessToken })).status, 403);
  assert.equal((await call('GET', '/admin/audit', { token: admin.accessToken })).status, 403);
  const sa = await login('superadmin@edjambo.org', 'Admin@2026');
  const log = await call('GET', '/admin/audit?action=member.reset', { token: sa.accessToken });
  assert.equal(log.data.items[0].action, 'member.reset_password');
});

test('export CSV : permission, BOM Excel, neutralisation des formules, téléphones conservés', async () => {
  const form = new FormData();
  Object.entries({ first_name: '=CMD()', last_name: 'Pirate', phone: '+2250799000111', password: 'Motdepasse1', age: '20', neighborhood: 'Gare' }).forEach(([k, v]) => form.append(k, v));
  assert.equal((await call('POST', '/auth/register', { form })).status, 201);
  const m = await login('membre1@edjambo.org', 'Jeunesse2026!');
  const denied = await fetch(`${base}/members/export.csv`, { headers: { Authorization: `Bearer ${m.accessToken}` } });
  assert.equal(denied.status, 403);
  const admin = await login('serge@edjambo.org', 'Admin@2026');
  const res = await fetch(`${base}/members/export.csv?q=Pirate`, { headers: { Authorization: `Bearer ${admin.accessToken}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]); // BOM UTF-8 pour Excel
  const text = await res.text();
  assert.ok(text.includes("'=CMD()"), 'formule neutralisée');
  assert.ok(text.includes(';+2250799000111;'), 'téléphone intact');
  const nadia = await login('nadia@edjambo.org', 'Admin@2026');
  const pay = await fetch(`${base}/contributions/export.csv`, { headers: { Authorization: `Bearer ${nadia.accessToken}` } });
  assert.equal(pay.status, 200);
  assert.equal((await fetch(`${base}/members/export.csv`, { headers: { Authorization: `Bearer ${nadia.accessToken}` } })).status, 403);
});

test('validation en masse des inscriptions', async () => {
  const admin = await login('aicha@edjambo.org', 'Admin@2026');
  const pending = (await call('GET', '/members?status=pending&limit=5', { token: admin.accessToken })).data.items;
  assert.ok(pending.length >= 3);
  const ids = pending.map((p) => p.id);
  const r = await call('POST', '/members/bulk-approve', { token: admin.accessToken, body: { ids } });
  assert.equal(r.data.approved, ids.length);
  assert.equal((await call('POST', '/members/bulk-approve', { token: admin.accessToken, body: { ids } })).data.approved, 0); // déjà traités
  assert.equal((await call('POST', '/members/bulk-approve', { token: admin.accessToken, body: { ids: [] } })).status, 400);
  const nadia = await login('nadia@edjambo.org', 'Admin@2026');
  assert.equal((await call('POST', '/members/bulk-approve', { token: nadia.accessToken, body: { ids } })).status, 403);
});

test('CSP : les aperçus blob: (preuves) sont autorisés', async () => {
  const res = await fetch(`${base}/health`);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /img-src[^;]*blob:/);
  assert.match(csp, /frame-src[^;]*blob:/);
});
