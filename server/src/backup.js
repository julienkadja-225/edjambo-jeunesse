import fs from 'node:fs';
import path from 'node:path';
import db, { ROOT } from './db.js';
import { UPLOAD_DIR } from './upload.js';

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'backups');
const KEEP = parseInt(process.env.BACKUP_KEEP || '14');

const countFiles = (dir) => {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  return n;
};

/**
 * Sauvegarde à chaud : une copie cohérente de la base (VACUUM INTO, même pendant l'activité)
 * + une copie des fichiers envoyés (photos, preuves de paiement, justificatifs).
 * Chaque sauvegarde est un dossier « edjambo-<date> » contenant edjambo.db et uploads/.
 */
export function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `edjambo-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const dir = path.join(BACKUP_DIR, name);
  fs.mkdirSync(dir);
  db.prepare('VACUUM INTO ?').run(path.join(dir, 'edjambo.db'));
  let files = 0;
  if (process.env.BACKUP_UPLOADS !== '0' && fs.existsSync(UPLOAD_DIR)) {
    fs.cpSync(UPLOAD_DIR, path.join(dir, 'uploads'), { recursive: true });
    files = countFiles(path.join(dir, 'uploads'));
  }
  const all = fs.readdirSync(BACKUP_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('edjambo-')).map((e) => e.name).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
  return { file: name, size: fs.statSync(path.join(dir, 'edjambo.db')).size, uploads: files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  console.log('Sauvegarde créée :', runBackup());
}
