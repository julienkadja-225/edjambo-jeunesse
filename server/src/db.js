import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'edjambo.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

// Migrations légères : colonnes ajoutées après la première version du schéma
function addColumns(table, columns) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  for (const [name, def] of Object.entries(columns)) {
    if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}
addColumns('users', {
  failed_attempts: 'INTEGER NOT NULL DEFAULT 0',
  locked_until: 'TEXT',
  must_change_password: 'INTEGER NOT NULL DEFAULT 0',
  password_changed_at: 'TEXT',
  sms_optin: 'INTEGER NOT NULL DEFAULT 0',       // consentement aux SMS
  whatsapp_optin: 'INTEGER NOT NULL DEFAULT 0',  // consentement à WhatsApp
  consent_at: 'TEXT',        // acceptation de la politique de confidentialité à l\'inscription
  anonymized_at: 'TEXT',     // compte supprimé à la demande du membre (données personnelles effacées)
});
addColumns('contributions', {
  sms_text: 'TEXT',                 // SMS de confirmation collé par le membre
  sms_flags: "TEXT NOT NULL DEFAULT '[]'", // incohérences détectées (JSON)
  sms_level: "TEXT NOT NULL DEFAULT 'none'", // none | consistent | review
});

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

export default db;
