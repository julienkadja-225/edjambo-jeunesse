import fs from 'node:fs';
import path from 'node:path';
import db, { ROOT } from './db.js';

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'backups');
const KEEP = parseInt(process.env.BACKUP_KEEP || '14');

/** Sauvegarde à chaud (VACUUM INTO produit une copie cohérente même pendant l'activité). */
export function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `edjambo-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  const file = path.join(BACKUP_DIR, name);
  db.prepare('VACUUM INTO ?').run(file);
  const all = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) fs.unlinkSync(path.join(BACKUP_DIR, old));
  return { file: name, size: fs.statSync(file).size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  console.log('Sauvegarde créée :', runBackup());
}
