import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edjambo-msg-'));
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

async function call(method, url, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  return { status: res.status, data };
}
const login = async (identifier, password) => (await call('POST', '/auth/login', { body: { identifier, password } })).data;
const member = (n) => login(`membre${n}@edjambo.org`, 'Jeunesse2026!');

test('messagerie privée : demande, acceptation, échanges, avec contrôles', async () => {
  const a = await member(6);
  const b = await member(7);
  const c = await call('POST', '/messages/direct', { token: a.accessToken, body: { user_id: b.user.id, body: 'Salut, on organise le tournoi ?' } });
  assert.equal(c.status, 201);
  const convId = c.data.id;
  // demande en attente : un seul message possible
  assert.equal((await call('POST', `/messages/${convId}/messages`, { token: a.accessToken, body: { body: 'Relance' } })).status, 409);
  // le destinataire voit la demande (aperçu du premier message) mais ne peut pas écrire
  const inv = (await call('GET', '/messages?tab=invitations', { token: b.accessToken })).data.items;
  assert.equal(inv.find((x) => x.id === convId).preview, 'Salut, on organise le tournoi ?');
  assert.equal((await call('POST', `/messages/${convId}/messages`, { token: b.accessToken, body: { body: 'avant acceptation' } })).status, 404);
  assert.ok((await call('GET', '/messages/unread-count', { token: b.accessToken })).data.invitations >= 1);
  // un tiers n'a aucun accès
  const x = await member(4);
  assert.equal((await call('GET', `/messages/${convId}`, { token: x.accessToken })).status, 404);
  assert.equal((await call('GET', `/messages/${convId}/messages`, { token: x.accessToken })).status, 404);
  // acceptation puis échange
  assert.equal((await call('POST', `/messages/${convId}/accept`, { token: b.accessToken })).status, 200);
  assert.equal((await call('POST', `/messages/${convId}/messages`, { token: b.accessToken, body: { body: 'Avec plaisir !' } })).status, 201);
  const list = (await call('GET', `/messages/${convId}/messages`, { token: a.accessToken })).data.items;
  assert.deepEqual(list.map((m) => m.body), ['Salut, on organise le tournoi ?', 'Avec plaisir !']);
  // non lus, puis lus à l'ouverture
  const sent2 = await call('POST', `/messages/${convId}/messages`, { token: b.accessToken, body: { body: 'Dis-moi quand' } });
  const before = (await call('GET', '/messages', { token: a.accessToken })).data.items.find((i) => i.id === convId);
  assert.ok(before.unread >= 1);
  assert.equal(before.title, `${b.user.first_name} ${b.user.last_name}`);
  await call('GET', `/messages/${convId}/messages?after=${list[1].id}`, { token: a.accessToken });
  assert.equal((await call('GET', '/messages', { token: a.accessToken })).data.items.find((i) => i.id === convId).unread, 0);
  // modification / suppression : uniquement ses propres messages
  assert.equal((await call('PATCH', `/messages/${convId}/messages/${sent2.data.id}`, { token: a.accessToken, body: { body: 'piratage' } })).status, 403);
  assert.equal((await call('PATCH', `/messages/${convId}/messages/${sent2.data.id}`, { token: b.accessToken, body: { body: 'Dis-moi quand tu veux' } })).status, 200);
  assert.equal((await call('DELETE', `/messages/${convId}/messages/${sent2.data.id}`, { token: b.accessToken })).status, 200);
  const last = (await call('GET', `/messages/${convId}/messages`, { token: a.accessToken })).data.items.pop();
  assert.equal(last.deleted, true);
  assert.equal(last.body, '');
});

test('messagerie : refus, blocage, pas de contournement', async () => {
  const a = await member(1);
  const d = await member(4);
  const c = await call('POST', '/messages/direct', { token: d.accessToken, body: { user_id: a.user.id, body: 'Bonjour' } });
  assert.equal(c.status, 201);
  assert.equal((await call('POST', `/messages/${c.data.id}/decline`, { token: a.accessToken })).status, 200);
  // le refus empêche toute nouvelle demande
  assert.equal((await call('POST', '/messages/direct', { token: d.accessToken, body: { user_id: a.user.id, body: 'Allô ?' } })).status, 403);
  // blocage : plus de demande dans les deux sens, plus de recherche
  assert.equal((await call('POST', '/messages/blocks', { token: a.accessToken, body: { user_id: d.user.id } })).status, 200);
  assert.equal((await call('POST', '/messages/direct', { token: d.accessToken, body: { user_id: a.user.id, body: 'x' } })).status, 403);
  const found = await call('GET', `/messages/people?q=${encodeURIComponent(d.user.last_name)}`, { token: a.accessToken });
  assert.ok(!found.data.some((p) => p.id === d.user.id));
  assert.equal((await call('DELETE', `/messages/blocks/${d.user.id}`, { token: a.accessToken })).status, 200);
  assert.equal((await call('POST', '/messages/direct', { token: a.accessToken, body: { user_id: a.user.id, body: 'moi' } })).status, 400);
  assert.equal((await call('POST', '/messages/direct', { token: a.accessToken, body: { user_id: 99999999, body: 'x' } })).status, 404);
});

test('groupe : invitations à approuver, historique masqué aux nouveaux, rôles et départ', async () => {
  const owner = await member(1);
  const m3 = await member(3);
  const m4 = await member(4);
  const g = await call('POST', '/messages/groups', {
    token: owner.accessToken,
    body: { title: 'Comité sport', description: 'Tournoi', member_ids: [m3.user.id, m4.user.id, owner.user.id, 99999999] },
  });
  assert.equal(g.status, 201);
  assert.equal(g.data.invited, 2); // soi-même et l'inexistant sont ignorés
  const gid = g.data.id;
  // invité : voit l'invitation, jamais le contenu, ne peut pas écrire
  assert.equal((await call('GET', `/messages/${gid}/messages`, { token: m3.accessToken })).data.items.length, 0);
  assert.equal((await call('POST', `/messages/${gid}/messages`, { token: m3.accessToken, body: { body: 'coucou' } })).status, 404);
  const invs = (await call('GET', '/messages?tab=invitations', { token: m3.accessToken })).data.items;
  assert.ok(invs.some((i) => i.id === gid && i.inviter.id === owner.user.id));
  await call('POST', `/messages/${gid}/messages`, { token: owner.accessToken, body: { body: 'Message avant arrivée' } });
  assert.equal((await call('POST', `/messages/${gid}/accept`, { token: m3.accessToken })).status, 200);
  await call('POST', `/messages/${gid}/messages`, { token: owner.accessToken, body: { body: 'Message après arrivée' } });
  const seen = (await call('GET', `/messages/${gid}/messages`, { token: m3.accessToken })).data.items.filter((m) => m.kind === 'text').map((m) => m.body);
  assert.deepEqual(seen, ['Message après arrivée']);
  // un simple membre ne peut ni inviter ni retirer
  assert.equal((await call('POST', `/messages/${gid}/invite`, { token: m3.accessToken, body: { user_ids: [m4.user.id] } })).status, 403);
  assert.equal((await call('DELETE', `/messages/${gid}/members/${owner.user.id}`, { token: m3.accessToken })).status, 403);
  // promotion : seul le créateur promeut ; l'admin peut inviter
  assert.equal((await call('PATCH', `/messages/${gid}/members/${m3.user.id}`, { token: owner.accessToken, body: { role: 'admin' } })).status, 200);
  assert.equal((await call('PATCH', `/messages/${gid}/members/${m3.user.id}`, { token: m3.accessToken, body: { role: 'member' } })).status, 403);
  assert.equal((await call('POST', `/messages/${gid}/invite`, { token: m3.accessToken, body: { user_ids: [m4.user.id] } })).data.invited, 0); // déjà invité
  // refus puis pas de ré-invitation immédiate (anti-harcèlement)
  assert.equal((await call('POST', `/messages/${gid}/decline`, { token: m4.accessToken })).status, 200);
  assert.equal((await call('POST', `/messages/${gid}/invite`, { token: owner.accessToken, body: { user_ids: [m4.user.id] } })).data.invited, 0);
  // départ du créateur : la propriété passe à l'admin
  assert.equal((await call('POST', `/messages/${gid}/leave`, { token: owner.accessToken })).status, 200);
  assert.equal((await call('GET', `/messages/${gid}`, { token: m3.accessToken })).data.is_owner, true);
  assert.equal((await call('GET', `/messages/${gid}`, { token: owner.accessToken })).status, 404);
  assert.equal((await call('DELETE', `/messages/${gid}`, { token: m3.accessToken })).status, 200);
});

test('signalement : remonte à la modération, qui peut supprimer le message', async () => {
  const a = await member(6);
  const b = await member(7);
  const c = await call('POST', '/messages/direct', { token: b.accessToken, body: { user_id: a.user.id, body: 'Message abusif' } });
  await call('POST', `/messages/${c.data.id}/accept`, { token: a.accessToken });
  const mid = (await call('GET', `/messages/${c.data.id}/messages`, { token: a.accessToken })).data.items.at(-1).id; // la discussion existe déjà (test 1)
  assert.equal((await call('POST', `/messages/${c.data.id}/messages/${mid}/report`, { token: b.accessToken, body: {} })).status, 400); // son propre message
  assert.equal((await call('POST', `/messages/${c.data.id}/messages/${mid}/report`, { token: a.accessToken, body: { reason: 'Insultes' } })).status, 200);
  assert.equal((await call('GET', '/messages/reports', { token: a.accessToken })).status, 403);
  const boris = await login('boris@edjambo.org', 'Admin@2026');
  const rep = (await call('GET', '/messages/reports', { token: boris.accessToken })).data.items.find((x) => x.message_id === mid);
  assert.equal(rep.body, 'Message abusif');
  assert.equal((await call('PATCH', `/messages/reports/${rep.id}`, { token: boris.accessToken, body: { action: 'delete_message' } })).status, 200);
  assert.equal((await call('GET', `/messages/${c.data.id}/messages`, { token: a.accessToken })).data.items.at(-1).deleted, true);
  assert.equal((await call('GET', '/messages/reports', { token: boris.accessToken })).data.items.some((x) => x.id === rep.id), false);
});
