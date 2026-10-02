import { Router } from 'express';
import db from '../db.js';
import { auth, requirePerm } from '../auth.js';
import bcrypt from 'bcryptjs';
import { audit, bad, currentMonth, forbidden, hasPerm, notFound, notify, pageResult, paginate, sendCsv, str, tempPassword } from '../utils.js';

const r = Router();
r.use(auth);

const STATUSES = ['pending', 'active', 'suspended', 'inactive'];
const PUBLIC_COLS = 'u.id, u.first_name, u.last_name, u.neighborhood, u.photo, u.created_at';
const ADMIN_COLS =
  `u.id, u.role, u.first_name, u.last_name, u.email, u.phone, u.age, u.neighborhood, u.photo, u.status, u.status_reason, u.created_at, u.approved_at, u.last_login, u.must_change_password, (u.locked_until IS NOT NULL AND u.locked_until > strftime('%Y-%m-%dT%H:%M:%SZ','now')) AS locked`;

r.get('/neighborhoods', (_req, res) => {
  res.json(
    db
      .prepare("SELECT DISTINCT neighborhood FROM users WHERE neighborhood IS NOT NULL AND role = 'member' AND status = 'active' ORDER BY neighborhood")
      .all()
      .map((x) => x.neighborhood)
  );
});

/** Construit les filtres de l'annuaire (partagés par la liste et l'export CSV). */
function memberFilters(req, admin) {
  const where = ["u.role = 'member'"];
  const args = [];
  if (!admin) where.push("u.status = 'active'");
  else if (STATUSES.includes(req.query.status)) {
    where.push('u.status = ?');
    args.push(req.query.status);
  }
  if (req.query.q) {
    const like = `%${String(req.query.q).trim()}%`;
    where.push(admin ? '(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)' : '(u.first_name LIKE ? OR u.last_name LIKE ?)');
    args.push(like, like);
    if (admin) args.push(like, like);
  }
  if (req.query.neighborhood) {
    where.push('u.neighborhood = ?');
    args.push(String(req.query.neighborhood));
  }
  if (admin) {
    if (req.query.from) {
      where.push('u.created_at >= ?');
      args.push(String(req.query.from));
    }
    if (req.query.to) {
      where.push('u.created_at <= ?');
      args.push(String(req.query.to) + 'T23:59:59Z');
    }
    const paid = `EXISTS (SELECT 1 FROM contributions c WHERE c.user_id = u.id AND c.month = ? AND c.status = 'approved')`;
    if (req.query.payment === 'paid') {
      where.push(paid);
      args.push(currentMonth());
    } else if (req.query.payment === 'unpaid') {
      where.push('NOT ' + paid);
      args.push(currentMonth());
    }
  }
  return { w: where.join(' AND '), args };
}

const PAID_COL = `EXISTS (SELECT 1 FROM contributions c WHERE c.user_id = u.id AND c.month = ? AND c.status = 'approved') AS paid_current`;

/** Annuaire. Les membres voient les profils actifs ; l'équipe « members » voit tout, avec statut de cotisation. */
r.get('/', (req, res) => {
  const admin = hasPerm(req.user, 'members');
  const p = paginate(req, 20);
  const { w, args } = memberFilters(req, admin);
  const total = db.prepare(`SELECT COUNT(*) n FROM users u WHERE ${w}`).get(...args).n;
  const cols = admin ? `${ADMIN_COLS}, ${PAID_COL}` : PUBLIC_COLS;
  const order = admin ? 'u.created_at DESC, u.id DESC' : 'u.last_name, u.first_name';
  const rows = db
    .prepare(`SELECT ${cols} FROM users u WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...(admin ? [currentMonth()] : []), ...args, p.limit, p.offset);
  res.json(pageResult(rows, total, p));
});

const STATUS_FR = { pending: 'En attente', active: 'Actif', suspended: 'Suspendu', inactive: 'Inactif' };

/** Export CSV de l'annuaire (mêmes filtres que la liste), ouvrable directement dans Excel. */
r.get('/export.csv', requirePerm('members'), (req, res) => {
  const { w, args } = memberFilters(req, true);
  const rows = db
    .prepare(`SELECT ${ADMIN_COLS}, ${PAID_COL} FROM users u WHERE ${w} ORDER BY u.last_name, u.first_name LIMIT 20000`)
    .all(currentMonth(), ...args);
  audit(req.user.id, 'export.members', null, null, `${rows.length} lignes`);
  sendCsv(res, `membres-${currentMonth()}.csv`,
    ['Nom', 'Prénom', 'Email', 'Téléphone', 'Âge', 'Quartier', 'Statut', 'Cotisation du mois', 'Inscrit le', 'Dernière connexion'],
    rows.map((m) => [m.last_name, m.first_name, m.email, m.phone, m.age, m.neighborhood, STATUS_FR[m.status],
      m.status === 'active' ? (m.paid_current ? 'À jour' : 'Non payée') : '', m.created_at?.slice(0, 10), m.last_login?.slice(0, 10)]));
});

/** Validation en masse des inscriptions en attente. */
r.post('/bulk-approve', requirePerm('members'), (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map((x) => parseInt(x)).filter(Boolean))].slice(0, 500);
  if (!ids.length) throw bad('Aucun membre sélectionné');
  const now = new Date().toISOString();
  const approved = [];
  const upd = db.prepare("UPDATE users SET status = 'active', status_reason = NULL, approved_at = ? WHERE id = ? AND role = 'member' AND status = 'pending'");
  for (const id of ids) if (upd.run(now, id).changes) approved.push(id);
  for (const id of approved) notify(id, 'registration', 'Inscription approuvée', "Bienvenue dans la communauté des jeunes d'EDJAMBO !", '/');
  audit(req.user.id, 'member.bulk_approve', 'user', null, `${approved.length} inscription(s) validée(s)`);
  res.json({ approved: approved.length, skipped: ids.length - approved.length });
});

r.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const admin = hasPerm(req.user, 'members');
  const u = db.prepare(`SELECT ${admin ? ADMIN_COLS : PUBLIC_COLS + ', u.status'} FROM users u WHERE u.id = ?`).get(id);
  if (!u || (!admin && u.status !== 'active' && u.id !== req.user.id)) throw notFound('Membre introuvable');
  const reshares = db
    .prepare(
      `SELECT a.id, a.title, a.type, rs.created_at FROM reshares rs
       JOIN announcements a ON a.id = rs.announcement_id WHERE rs.user_id = ? ORDER BY rs.created_at DESC LIMIT 10`
    )
    .all(id);
  const out = { ...u, reshares };
  if (admin) {
    out.contributions = db
      .prepare('SELECT id, month, amount, method_label, reference, status, created_at FROM contributions WHERE user_id = ? ORDER BY month DESC LIMIT 24')
      .all(id);
  }
  res.json(out);
});

r.patch('/:id/status', requirePerm('members'), (req, res) => {
  const id = parseInt(req.params.id);
  const status = req.body.status;
  if (!STATUSES.includes(status)) throw bad('Statut invalide');
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw notFound('Membre introuvable');
  if (target.role !== 'member') throw forbidden('Les comptes admin sont gérés par le Super Admin');
  const reason = status === 'active' ? null : str(req.body.reason ?? '', { max: 300 }) || null;
  if (target.status === 'pending' && status === 'inactive' && !reason) throw bad('Un motif de rejet est requis');
  db.prepare('UPDATE users SET status = ?, status_reason = ?, approved_at = CASE WHEN ? = \'active\' AND approved_at IS NULL THEN ? ELSE approved_at END WHERE id = ?')
    .run(status, reason, status, new Date().toISOString(), id);
  if (target.status === 'pending' && status === 'active') {
    notify(id, 'registration', 'Inscription approuvée ', 'Bienvenue dans la communauté des jeunes d\'EDJAMBO !', '/');
  } else if (target.status === 'pending' && status === 'inactive') {
    notify(id, 'registration', 'Inscription refusée', reason, '/');
  }
  if (status === 'suspended') db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(id);
  audit(req.user.id, `member.${status}`, 'user', id, `${target.first_name} ${target.last_name}${reason ? ' — ' + reason : ''}`);
  res.json({ ok: true, status });
});

/** Réinitialisation assistée : génère un mot de passe temporaire à transmettre au membre (utile sans email). */
r.post('/:id/reset-password', requirePerm('members'), (req, res) => {
  const id = parseInt(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw notFound('Membre introuvable');
  if (target.role !== 'member') throw forbidden('Les comptes admin sont gérés par le Super Admin');
  if (target.status === 'pending') throw bad("Ce compte n'est pas encore validé");
  const temp = tempPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, password_changed_at = NULL WHERE id = ?').run(bcrypt.hashSync(temp, 10), id);
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(id);
  audit(req.user.id, 'member.reset_password', 'user', id, `${target.first_name} ${target.last_name}`);
  res.json({ temporary_password: temp, identifier: target.email || target.phone });
});

r.post('/:id/unlock', requirePerm('members'), (req, res) => {
  const id = parseInt(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw notFound('Membre introuvable');
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(id);
  audit(req.user.id, 'member.unlock', 'user', id, `${target.first_name} ${target.last_name}`);
  res.json({ ok: true });
});

export default r;
