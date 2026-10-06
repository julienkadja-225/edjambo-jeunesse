import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edjambo-hard-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.BACKUP_DIR = path.join(tmp, 'backups');
process.env.SEED_MEMBERS = '60';
process.env.AUTH_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT_ANON = '100000';

let server, base, createApp;
before(async () => {
  await import('../src/seed.js');
  ({ createApp } = await import('../src/app.js'));
  await new Promise((res) => (server = createApp().listen(0, res)));
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

async function call(method, url, { token, body, form, raw, type, host = base } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (type) headers['Content-Type'] = type;
  const res = await fetch(host + url, { method, headers, body: form || raw || (body !== undefined ? JSON.stringify(body) : undefined) });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  return { status: res.status, data, res };
}
const login = async (identifier, password) => (await call('POST', '/auth/login', { body: { identifier, password } })).data;
const registerForm = (o = {}) => {
  const f = new FormData();
  Object.entries({ first_name: 'Awa', last_name: 'Test', email: 'awa@test.org', password: 'Motdepasse1', age: '23', neighborhood: 'Gare', accept_terms: '1', ...o }).forEach(([k, v]) => v !== null && f.append(k, v));
  return f;
};
const activate = async (id) => call('PATCH', `/members/${id}/status`, { token: (await login('aicha@edjambo.org', 'Admin@2026')).accessToken, body: { status: 'active' } });

test('corps de requête absent, mal formé ou trop gros : jamais de 500', async () => {
  assert.equal((await call('POST', '/auth/login', { type: 'text/plain', raw: 'bonjour' })).status, 400); // pas de JSON → champs requis manquants
  assert.equal((await call('POST', '/auth/login', { type: 'application/json', raw: '{"a":' })).status, 400);
  assert.equal((await call('POST', '/auth/logout')).status, 200); // aucun corps
  assert.equal((await call('POST', '/messages/direct', { token: (await login('membre1@edjambo.org', 'Jeunesse2026!')).accessToken, type: 'application/json', raw: JSON.stringify({ body: 'x'.repeat(400_000) }) })).status, 413);
});

test('inscription : consentement exigé et numéro de téléphone unique quel que soit son format', async () => {
  assert.equal((await call('POST', '/auth/register', { form: registerForm({ accept_terms: null }) })).status, 400);
  assert.equal((await call('POST', '/auth/register', { form: registerForm({ accept_terms: '0' }) })).status, 400);
  const a = await call('POST', '/auth/register', { form: registerForm({ email: null, phone: '07 99 00 11 22' }) });
  assert.equal(a.status, 201);
  // même numéro écrit autrement → doublon détecté
  assert.equal((await call('POST', '/auth/register', { form: registerForm({ email: 'autre@test.org', phone: '+225 0799001122' }) })).status, 409);
  await activate(a.data.id);
  assert.ok((await login('0799001122', 'Motdepasse1')).accessToken); // connexion avec n'importe quel format
  assert.ok((await login('+2250799001122', 'Motdepasse1')).accessToken);
  const me = (await call('GET', '/auth/me', { token: (await login('+225 07 99 00 11 22', 'Motdepasse1')).accessToken })).data;
  assert.equal(me.phone, '+2250799001122');
  assert.ok(me.consent_at);
});

test('droits sur les données : export complet puis suppression (anonymisation) du compte', async () => {
  const reg = await call('POST', '/auth/register', { form: registerForm({ first_name: 'Kofi', last_name: 'Départ', email: 'kofi@test.org' }) });
  await activate(reg.data.id);
  const s = await login('kofi@test.org', 'Motdepasse1');
  const t = s.accessToken;
  // quelques données personnelles
  const thread = await call('POST', '/forum/threads', { token: t, body: { type: 'proposal', title: 'Ma proposition', body: 'Une belle idée' } });
  assert.equal(thread.status, 201);
  const other = await login('membre6@edjambo.org', 'Jeunesse2026!');
  const dm = await call('POST', '/messages/direct', { token: t, body: { user_id: other.user.id, body: 'Message privé de Kofi' } });
  assert.equal(dm.status, 201);
  const f = new FormData(); f.append('method_id', '1'); f.append('reference', 'KOFI-REF'); f.append('month', '2025-02');
  assert.equal((await call('POST', '/contributions', { token: t, form: f })).status, 201);

  const exp = await call('GET', '/auth/me/export', { token: t });
  assert.equal(exp.status, 200);
  assert.match(exp.res.headers.get('content-disposition'), /attachment/);
  assert.equal(exp.data.profile.email, 'kofi@test.org');
  assert.equal(exp.data.forum_threads.length, 1);
  assert.equal(exp.data.messages_sent[0].body, 'Message privé de Kofi');
  assert.equal(exp.data.contributions[0].reference, 'KOFI-REF');
  assert.ok(!JSON.stringify(exp.data).includes('password_hash') && !JSON.stringify(exp.data).includes('$2'));

  // suppression : mot de passe exigé
  assert.equal((await call('DELETE', '/auth/me', { token: t, body: { password: 'faux' } })).status, 400);
  assert.equal((await call('DELETE', '/auth/me', { token: t, body: { password: 'Motdepasse1' } })).status, 200);
  assert.equal((await call('POST', '/auth/login', { body: { identifier: 'kofi@test.org', password: 'Motdepasse1' } })).status, 401);
  assert.equal((await call('GET', '/auth/me', { token: t })).status, 401); // session fermée

  // données personnelles effacées, contenu conservé sous « Ancien membre », messages privés supprimés
  const adm = await login('aicha@edjambo.org', 'Admin@2026');
  const profile = (await call('GET', `/members/${reg.data.id}`, { token: adm.accessToken })).data;
  assert.deepEqual([profile.first_name, profile.email, profile.phone, profile.age], ['Ancien', null, null, null]);
  const th = (await call('GET', '/forum/threads?type=proposal&limit=100', { token: other.accessToken })).data.items.find((x) => x.id === thread.data.id);
  assert.equal(th.first_name, 'Ancien');
  const msgs = (await call('GET', `/messages/${dm.data.id}`, { token: other.accessToken }));
  assert.ok([200, 404].includes(msgs.status));
  const contribs = (await call('GET', '/contributions?q=KOFI-REF', { token: adm.accessToken })).data.items;
  assert.equal(contribs.length, 1); // écriture comptable conservée

  // un compte d'administration ne peut pas se supprimer lui-même
  assert.equal((await call('DELETE', '/auth/me', { token: adm.accessToken, body: { password: 'Admin@2026' } })).status, 403);
});

test('admin : suppression refusée si historique, mot de passe temporaire à la création', async () => {
  const sa = await login('superadmin@edjambo.org', 'Admin@2026');
  const nadia = (await call('GET', '/admin/admins', { token: sa.accessToken })).data.find((a) => a.email === 'nadia@edjambo.org');
  const del = await call('DELETE', `/admin/admins/${nadia.id}`, { token: sa.accessToken });
  assert.equal(del.status, 409); // a validé des paiements / saisi des dépenses
  assert.match(del.data.error, /suspendez/);
  const created = await call('POST', '/admin/admins', { token: sa.accessToken, body: { first_name: 'Nouveau', last_name: 'Admin', email: 'nouvel.admin@test.org', password: 'Motdepasse1', permissions: ['forum'] } });
  assert.equal(created.status, 201);
  const s = await login('nouvel.admin@test.org', 'Motdepasse1');
  assert.equal(s.user.must_change_password, true);
  // sans historique : suppression possible
  assert.equal((await call('DELETE', `/admin/admins/${created.data.id}`, { token: sa.accessToken })).status, 200);
});

test('limitation de débit : par compte connecté, sinon par IP', async () => {
  const keep = { u: process.env.API_RATE_LIMIT, a: process.env.API_RATE_LIMIT_ANON };
  process.env.API_RATE_LIMIT = '1000';
  process.env.API_RATE_LIMIT_ANON = '3';
  const srv = await new Promise((res) => { const s = createApp().listen(0, () => res(s)); });
  const host = `http://localhost:${srv.address().port}/api`;
  try {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await call('GET', '/public/announcements/1', { host })).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    assert.equal((await call('GET', '/health', { host })).status, 200); // la supervision n'est jamais bloquée
    // un compte connecté a son propre quota, indépendant de l'IP saturée
    const t = (await call('POST', '/auth/login', { host: base, body: { identifier: 'membre1@edjambo.org', password: 'Jeunesse2026!' } })).data.accessToken;
    assert.equal((await call('GET', '/auth/me', { host, token: t })).status, 200);
  } finally {
    srv.close();
    process.env.API_RATE_LIMIT = keep.u;
    process.env.API_RATE_LIMIT_ANON = keep.a;
  }
});

test('maintenance : purge des données périmées ; sauvegarde = base + fichiers envoyés', async () => {
  const { default: db } = await import('../src/db.js');
  const { purgeOldData } = await import('../src/maintenance.js');
  const uid = db.prepare("SELECT id FROM users WHERE email = 'membre1@edjambo.org'").get().id;
  const old = new Date(Date.now() - 400 * 864e5).toISOString();
  const future = new Date(Date.now() + 864e5).toISOString();
  db.prepare('INSERT INTO refresh_tokens(user_id, token_hash, expires_at) VALUES(?,?,?)').run(uid, 'h-expire', old);
  db.prepare('INSERT INTO refresh_tokens(user_id, token_hash, expires_at) VALUES(?,?,?)').run(uid, 'h-valide', future);
  db.prepare("INSERT INTO outbox(user_id, channel, to_addr, body, status, created_at) VALUES(?, 'sms', '+2250700000000', 'vieux', 'sent', ?)").run(uid, old);
  db.prepare("INSERT INTO outbox(user_id, channel, to_addr, body, status, created_at) VALUES(?, 'sms', '+2250700000000', 'en attente', 'queued', ?)").run(uid, old);
  db.prepare('INSERT INTO notifications(user_id, type, title, is_read, created_at) VALUES(?,?,?,1,?)').run(uid, 'x', 'ancienne lue', old);
  db.prepare('INSERT INTO notifications(user_id, type, title, is_read, created_at) VALUES(?,?,?,0,?)').run(uid, 'x', 'ancienne non lue', old);
  const r = purgeOldData();
  assert.ok(r.refresh_tokens >= 1 && r.outbox === 1 && r.notifications === 1);
  assert.ok(db.prepare("SELECT 1 FROM refresh_tokens WHERE token_hash = 'h-valide'").get()); // les données utiles restent
  assert.ok(db.prepare("SELECT 1 FROM outbox WHERE status = 'queued'").get());
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE title = 'ancienne non lue'").get());

  // sauvegarde : base + photos/preuves
  fs.mkdirSync(path.join(process.env.UPLOAD_DIR, 'proofs'), { recursive: true });
  fs.writeFileSync(path.join(process.env.UPLOAD_DIR, 'proofs', 'preuve-test.png'), 'x');
  const { runBackup } = await import('../src/backup.js');
  const b = runBackup();
  assert.ok(b.size > 0 && b.uploads >= 1);
  assert.ok(fs.existsSync(path.join(process.env.BACKUP_DIR, b.file, 'edjambo.db')));
  assert.ok(fs.existsSync(path.join(process.env.BACKUP_DIR, b.file, 'uploads', 'proofs', 'preuve-test.png')));
});

test('le seed refuse de s\'exécuter en production', () => {
  const dbFile = path.join(tmp, 'prod.db');
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'seed.js')], {
    env: { ...process.env, NODE_ENV: 'production', DB_PATH: dbFile, JWT_SECRET: 'x' }, encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /interdit en production/);
});

test('déploiement : création du premier Super Admin en ligne de commande', async () => {
  const dbFile = path.join(tmp, 'fresh.db');
  const run = (...args) => spawnSync(process.execPath, ['--no-warnings', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'create-admin.js'), ...args], {
    env: { ...process.env, DB_PATH: dbFile }, encoding: 'utf8',
  });
  assert.notEqual(run('--email', 'invalide').status, 0); // arguments manquants
  const ok = run('--email', 'Premier.Admin@Exemple.org', '--first', 'Premier', '--last', 'Admin', '--phone', '0700112233');
  assert.equal(ok.status, 0, ok.stderr);
  const password = ok.stdout.match(/Mot de passe temporaire : (\S+)/)[1];
  assert.ok(password.length >= 10);
  assert.notEqual(run('--email', 'autre@exemple.org', '--first', 'A', '--last', 'B').status, 0); // un Super Admin existe déjà
  assert.equal(run('--email', 'autre@exemple.org', '--first', 'A', '--last', 'B', '--force', '--password', 'court').status, 1); // mot de passe trop faible
  // la base créée est utilisable : connexion, changement obligatoire du mot de passe
  const prev = process.env.DB_PATH;
  const { DatabaseSync } = await import('node:sqlite');
  const d = new DatabaseSync(dbFile);
  const u = d.prepare("SELECT role, email, phone, must_change_password FROM users").get();
  assert.deepEqual({ ...u }, { role: 'super_admin', email: 'premier.admin@exemple.org', phone: '+2250700112233', must_change_password: 1 });
  d.close();
  assert.equal(process.env.DB_PATH, prev);
});
