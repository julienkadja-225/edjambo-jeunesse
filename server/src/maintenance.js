import db from './db.js';

/** Données de départ indispensables sur une base neuve (idempotent) : catégories du forum. */
export function bootstrap() {
  if (db.prepare('SELECT COUNT(*) n FROM forum_categories').get().n) return false;
  const ins = db.prepare('INSERT INTO forum_categories(name, description) VALUES(?,?)');
  [['Général', 'Discussions libres entre jeunes'], ['Emploi & Formation', 'Opportunités, stages, formations'], ['Sport & Culture', 'Tournois, concerts, talents'], ['Vie de la cité', 'Environnement, salubrité, sécurité']].forEach(([n, d]) => ins.run(n, d));
  return true;
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
