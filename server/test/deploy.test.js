import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edjambo-deploy-'));

test('hébergeur sans terminal : le premier Super Admin peut venir des variables d\'environnement', async () => {
  const dbFile = path.join(tmp, 'paas.db');
  const mod = new URL('../src/maintenance.js', import.meta.url).href;
  const run = (env) => spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `import('${mod}').then((m) => console.log('RESULT=' + m.bootstrapAdminFromEnv()))`], {
    env: { ...process.env, DB_PATH: dbFile, BOOTSTRAP_ADMIN_EMAIL: '', BOOTSTRAP_ADMIN_PASSWORD: '', ...env }, encoding: 'utf8',
  });
  assert.match(run({}).stdout, /RESULT=null/); // rien de défini : rien n'est créé
  assert.match(run({ BOOTSTRAP_ADMIN_EMAIL: 'moi@exemple.org', BOOTSTRAP_ADMIN_PASSWORD: 'faible' }).stderr, /refusé/); // mot de passe trop faible
  const ok = run({ BOOTSTRAP_ADMIN_EMAIL: 'Moi@Exemple.org', BOOTSTRAP_ADMIN_PASSWORD: 'MotDePasse2026', BOOTSTRAP_ADMIN_FIRST: 'Awa', BOOTSTRAP_ADMIN_LAST: 'Koné' });
  assert.match(ok.stdout, /RESULT=moi@exemple\.org/);
  // idempotent : un Super Admin existe déjà, un redémarrage ne crée rien
  assert.match(run({ BOOTSTRAP_ADMIN_EMAIL: 'autre@exemple.org', BOOTSTRAP_ADMIN_PASSWORD: 'MotDePasse2026' }).stdout, /RESULT=null/);
  const { DatabaseSync } = await import('node:sqlite');
  const d = new DatabaseSync(dbFile);
  const rows = d.prepare('SELECT role, email, first_name, must_change_password FROM users').all().map((r) => ({ ...r }));
  d.close();
  assert.deepEqual(rows, [{ role: 'super_admin', email: 'moi@exemple.org', first_name: 'Awa', must_change_password: 1 }]);
});

test('démarrage en production sans JWT_SECRET : refus explicite (protection voulue)', () => {
  const dbFile = path.join(tmp, 'noenv.db');
  const entry = new URL('../src/index.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const env = { ...process.env, NODE_ENV: 'production', DB_PATH: dbFile, PORT: '0' };
  delete env.JWT_SECRET;
  const r = spawnSync(process.execPath, ['--no-warnings', decodeURIComponent(entry)], { env, encoding: 'utf8', timeout: 20000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /JWT_SECRET doit être défini en production/);
});
