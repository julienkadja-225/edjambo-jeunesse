import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { auth, requireAdmin, requireSuper } from '../auth.js';
import { runBackup } from '../backup.js';
import { normalizePhone } from '../gateway.js';
import { PERMISSIONS, HttpError, audit, bad, currentMonth, notFound, pageResult, paginate, str, validatePassword } from '../utils.js';

const r = Router();
r.use(auth, requireAdmin);

r.get('/stats', (_req, res) => {
  const m = currentMonth();
  const one = (sql, ...a) => db.prepare(sql).get(...a).n;
  const active = one("SELECT COUNT(*) n FROM users WHERE role='member' AND status='active'");
  const paid = one("SELECT COUNT(DISTINCT user_id) n FROM contributions WHERE status='approved' AND month=?", m);
  res.json({
    members_total: one("SELECT COUNT(*) n FROM users WHERE role='member'"),
    members_active: active,
    members_pending: one("SELECT COUNT(*) n FROM users WHERE status='pending'"),
    members_suspended: one("SELECT COUNT(*) n FROM users WHERE status='suspended'"),
    payments_pending: one("SELECT COUNT(*) n FROM contributions WHERE status='pending'"),
    contribution_rate: active ? Math.round((paid / active) * 100) : 0,
    month_collected: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM contributions WHERE status='approved' AND month=?").get(m).s,
    upcoming_events: one("SELECT COUNT(*) n FROM announcements WHERE type='event' AND event_date >= ?", new Date().toISOString()),
    open_elections: one("SELECT COUNT(*) n FROM elections WHERE status='open' AND end_at >= ?", new Date().toISOString()),
    threads: one('SELECT COUNT(*) n FROM threads'),
    collection_history: db
      .prepare("SELECT month, SUM(amount) total, COUNT(DISTINCT user_id) members FROM contributions WHERE status='approved' GROUP BY month ORDER BY month DESC LIMIT 6")
      .all()
      .reverse(),
    new_members_30d: one('SELECT COUNT(*) n FROM users WHERE created_at >= ?', new Date(Date.now() - 30 * 864e5).toISOString()),
    by_neighborhood: db
      .prepare("SELECT neighborhood, COUNT(*) n FROM users WHERE role='member' AND status='active' GROUP BY neighborhood ORDER BY n DESC LIMIT 8")
      .all(),
    upcoming: db
      .prepare("SELECT id, title, event_date, location FROM announcements WHERE type='event' AND event_date >= ? ORDER BY event_date LIMIT 5")
      .all(new Date().toISOString()),
  });
});

/* ---------- Gestion des administrateurs (Super Admin) ---------- */
const COLS = 'id, role, first_name, last_name, email, phone, status, permissions, last_login, created_at';
const parse = (a) => ({ ...a, permissions: JSON.parse(a.permissions) });

r.get('/admins', requireSuper, (_req, res) => {
  res.json(db.prepare(`SELECT ${COLS} FROM users WHERE role IN ('admin','super_admin') ORDER BY role DESC, id`).all().map(parse));
});

function perms(p) {
  if (!Array.isArray(p)) return [];
  return [...new Set(p.filter((x) => PERMISSIONS.includes(x)))];
}

r.post('/admins', requireSuper, (req, res) => {
  const first_name = str(req.body.first_name, { min: 2, max: 60, label: 'Prénom' });
  const last_name = str(req.body.last_name, { min: 2, max: 60, label: 'Nom' });
  const email = String(req.body.email || '').trim().toLowerCase() || null;
  const phone = normalizePhone(req.body.phone) || null;
  if (!email && !phone) throw bad('Email ou téléphone requis');
  validatePassword(req.body.password);
  if (email && db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'Email déjà utilisé');
  if (phone && db.prepare('SELECT 1 FROM users WHERE phone=?').get(phone)) throw new HttpError(409, 'Téléphone déjà utilisé');
  const count = db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND status='active'").get().n;
  if (count >= 10) throw bad("Limite de 10 administrateurs atteinte");
  const info = db
    .prepare(
      "INSERT INTO users(role, permissions, first_name, last_name, email, phone, password_hash, neighborhood, status, approved_at) VALUES('admin',?,?,?,?,?,?,'Bureau','active',?)"
    )
    .run(JSON.stringify(perms(req.body.permissions)), first_name, last_name, email, phone, bcrypt.hashSync(req.body.password, 10), new Date().toISOString());
  db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(Number(info.lastInsertRowid)); // il choisira son propre mot de passe
  audit(req.user.id, 'admin.create', 'user', Number(info.lastInsertRowid), `${first_name} ${last_name} — ${perms(req.body.permissions).join(',')}`);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

r.put('/admins/:id', requireSuper, (req, res) => {
  const id = parseInt(req.params.id);
  const a = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin'").get(id);
  if (!a) throw notFound('Administrateur introuvable');
  const status = ['active', 'suspended'].includes(req.body.status) ? req.body.status : a.status;
  db.prepare('UPDATE users SET permissions = ?, status = ? WHERE id = ?').run(JSON.stringify(perms(req.body.permissions ?? JSON.parse(a.permissions))), status, id);
  audit(req.user.id, 'admin.update', 'user', id, `${a.first_name} ${a.last_name} — ${status}`);
  if (status !== 'active') db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(id);
  if (req.body.password) {
    validatePassword(req.body.password);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(bcrypt.hashSync(req.body.password, 10), id);
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(id);
  }
  res.json({ ok: true });
});

r.delete('/admins/:id', requireSuper, (req, res) => {
  const id = parseInt(req.params.id);
  let info;
  try {
    info = db.prepare("DELETE FROM users WHERE id = ? AND role = 'admin'").run(id);
  } catch (e) {
    if (/FOREIGN KEY/i.test(e.message)) throw new HttpError(409, 'Cet administrateur a déjà réalisé des actions enregistrées (validations, dépenses, élections…) : suspendez son compte plutôt que de le supprimer.');
    throw e;
  }
  if (!info.changes) throw notFound();
  audit(req.user.id, 'admin.delete', 'user', id);
  res.json({ ok: true });
});

r.post('/backup', requireSuper, (req, res) => {
  const b = runBackup();
  audit(req.user.id, 'system.backup', null, null, b.file);
  res.json(b);
});

r.get('/audit', requireSuper, (req, res) => {
  const p = paginate(req, 25);
  const where = ['1=1'];
  const args = [];
  if (req.query.action) { where.push('l.action LIKE ?'); args.push(`${req.query.action}%`); }
  if (req.query.q) { where.push('(l.detail LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)'); const like = `%${req.query.q}%`; args.push(like, like, like); }
  const w = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) n FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id WHERE ${w}`).get(...args).n;
  const rows = db.prepare(`SELECT l.id, l.action, l.target_type, l.target_id, l.detail, l.created_at, u.first_name, u.last_name
    FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id WHERE ${w} ORDER BY l.id DESC LIMIT ? OFFSET ?`).all(...args, p.limit, p.offset);
  res.json(pageResult(rows, total, p));
});

export default r;
