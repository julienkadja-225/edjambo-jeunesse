import bcrypt from 'bcryptjs';
import db from './db.js';
import { audit, validatePassword } from './utils.js';

/** Données de départ indispensables sur une base neuve (idempotent) : catégories du forum. */
export function bootstrap() {
  if (db.prepare('SELECT COUNT(*) n FROM forum_categories').get().n) return false;
  const ins = db.prepare('INSERT INTO forum_categories(name, description) VALUES(?,?)');
  [['Général', 'Discussions libres entre jeunes'], ['Emploi & Formation', 'Opportunités, stages, formations'], ['Sport & Culture', 'Tournois, concerts, talents'], ['Vie de la cité', 'Environnement, salubrité, sécurité']].forEach(([n, d]) => ins.run(n, d));
  return true;
}

/**
 * Hébergeurs sans accès au terminal (ex. offre gratuite de Render) : crée le premier Super Admin au démarrage
 * si BOOTSTRAP_ADMIN_EMAIL et BOOTSTRAP_ADMIN_PASSWORD sont définis ET qu'aucun Super Admin n'existe encore.
 * Le changement du mot de passe est exigé à la première connexion ; retirez ensuite ces variables.
 */
export function bootstrapAdminFromEnv() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  if (!email || !password) return null;
  if (db.prepare("SELECT 1 FROM users WHERE role = 'super_admin' LIMIT 1").get()) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('BOOTSTRAP_ADMIN_EMAIL invalide : aucun compte créé.'); return null; }
  try { validatePassword(password); } catch (e) { console.error(`BOOTSTRAP_ADMIN_PASSWORD refusé (${e.message}) : aucun compte créé.`); return null; }
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO users(role, permissions, first_name, last_name, email, password_hash, neighborhood, status, approved_at, consent_at, must_change_password)
       VALUES('super_admin', '[]', ?, ?, ?, ?, 'Bureau', 'active', ?, ?, 1)`
    )
    .run((process.env.BOOTSTRAP_ADMIN_FIRST || 'Super').trim(), (process.env.BOOTSTRAP_ADMIN_LAST || 'Admin').trim(), email, bcrypt.hashSync(password, 10), now, now);
  audit(Number(info.lastInsertRowid), 'admin.create', 'user', Number(info.lastInsertRowid), 'Premier Super Admin créé au démarrage (variables BOOTSTRAP_ADMIN_*)');
  return email;
}

/** Nettoyage périodique : supprime les données techniques périmées (jetons, files d'envoi, notifications lues…). */
export function purgeOldData() {
  const iso = (days) => new Date(Date.now() - days * 864e5).toISOString();
  const run = (sql, ...a) => db.prepare(sql).run(...a).changes;
  return {
    refresh_tokens: run('DELETE FROM refresh_tokens WHERE expires_at < ?', iso(0)),
    password_resets: run('DELETE FROM password_resets WHERE expires_at < ?', iso(1)),
    outbox: run("DELETE FROM outbox WHERE status IN ('sent','simulated','skipped') AND created_at < ?", iso(90)),
    notifications: run('DELETE FROM notifications WHERE is_read = 1 AND created_at < ?', iso(180)),
  };
}
