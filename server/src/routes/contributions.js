import { Router } from 'express';
import path from 'node:path';
import db, { getSetting, setSetting } from '../db.js';
import { auth, requirePerm } from '../auth.js';
import { checkMagic, proofUpload, PROOF_DIR, removeFile } from '../upload.js';
import {
  HttpError, audit, bad, currentMonth, hasPerm, isUpToDate, notFound, notify, notifyAdmins,
  pageResult, paginate, sendContributionReminders, sendCsv, str,
} from '../utils.js';

const r = Router();
r.use(auth);

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/* ---------- Moyens de paiement & paramètres ---------- */
r.get('/payment-methods', (req, res) => {
  const all = hasPerm(req.user, 'payments');
  res.json(db.prepare(`SELECT * FROM payment_methods ${all ? '' : 'WHERE active = 1'} ORDER BY id`).all());
});

function methodBody(b) {
  const type = b.type;
  if (!['bank', 'mobile_money'].includes(type)) throw bad('Type invalide');
  return [
    type,
    str(b.label, { min: 2, max: 60, label: 'Libellé' }),
    str(b.account_number, { min: 3, max: 60, label: 'Numéro / compte' }),
    str(b.account_name ?? '', { max: 100 }) || null,
    str(b.details ?? '', { max: 300 }) || null,
    b.active === false || b.active === 0 ? 0 : 1,
  ];
}

r.post('/payment-methods', requirePerm('payments'), (req, res) => {
  const info = db
    .prepare('INSERT INTO payment_methods(type,label,account_number,account_name,details,active) VALUES(?,?,?,?,?,?)')
    .run(...methodBody(req.body));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

r.put('/payment-methods/:id', requirePerm('payments'), (req, res) => {
  const info = db
    .prepare('UPDATE payment_methods SET type=?,label=?,account_number=?,account_name=?,details=?,active=? WHERE id=?')
    .run(...methodBody(req.body), parseInt(req.params.id));
  if (!info.changes) throw notFound();
  res.json({ ok: true });
});

r.delete('/payment-methods/:id', requirePerm('payments'), (req, res) => {
  db.prepare('DELETE FROM payment_methods WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

r.get('/contribution-settings', (_req, res) => {
  res.json({
    monthly_amount: parseInt(getSetting('monthly_amount', '1000')),
    currency: getSetting('currency', 'FCFA'),
    grace_days: parseInt(getSetting('grace_days', '10')),
    reminder_day: parseInt(getSetting('reminder_day', '5')),
  });
});

r.put('/contribution-settings', requirePerm('payments'), (req, res) => {
  const { monthly_amount, grace_days, reminder_day } = req.body;
  if (monthly_amount !== undefined) {
    if (!(parseInt(monthly_amount) > 0)) throw bad('Montant invalide');
    setSetting('monthly_amount', parseInt(monthly_amount));
  }
  if (grace_days !== undefined) setSetting('grace_days', Math.min(28, Math.max(0, parseInt(grace_days) || 0)));
  if (reminder_day !== undefined) setSetting('reminder_day', Math.min(28, Math.max(1, parseInt(reminder_day) || 5)));
  res.json({ ok: true });
});

/* ---------- Soumission & historique du membre ---------- */
r.post('/contributions', proofUpload.single('proof'), checkMagic, (req, res) => {
  const file = req.file?.filename || null;
  try {
    if (req.user.role !== 'member') throw bad('Réservé aux membres');
    const month = String(req.body.month || currentMonth());
    if (!MONTH_RE.test(month)) throw bad('Mois invalide');
    if (month > currentMonth()) throw bad('Impossible de payer un mois futur');
    const method = db.prepare('SELECT * FROM payment_methods WHERE id = ? AND active = 1').get(parseInt(req.body.method_id));
    if (!method) throw bad('Moyen de paiement invalide');
    const reference = str(req.body.reference ?? '', { max: 80 }) || null;
    if (!file && !reference) throw bad('Joignez une preuve (capture) ou saisissez la référence de transaction');
    const amount = parseInt(req.body.amount) || parseInt(getSetting('monthly_amount', '1000'));
    if (!(amount > 0 && amount < 10_000_000)) throw bad('Montant invalide');
    const dup = db
      .prepare("SELECT status FROM contributions WHERE user_id = ? AND month = ? AND status IN ('pending','approved')")
      .get(req.user.id, month);
    if (dup) throw new HttpError(409, dup.status === 'approved' ? 'Ce mois est déjà réglé' : 'Une preuve est déjà en attente de vérification pour ce mois');
    if (reference && db.prepare("SELECT 1 FROM contributions WHERE reference = ? AND method_id = ? AND status != 'rejected'").get(reference, method.id))
      throw new HttpError(409, 'Cette référence de transaction a déjà été soumise');

    const info = db
      .prepare('INSERT INTO contributions(user_id, month, amount, method_id, method_label, reference, proof_file) VALUES(?,?,?,?,?,?,?)')
      .run(req.user.id, month, amount, method.id, method.label, reference, file);
    notifyAdmins('payments', 'payment', 'Nouvelle preuve de paiement', `${req.user.first_name} ${req.user.last_name} — ${month}`, '/admin/paiements');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (e) {
    removeFile(PROOF_DIR, file);
    throw e;
  }
});

r.get('/contributions/mine', (req, res) => {
  const rows = db
    .prepare(
      'SELECT id, month, amount, method_label, reference, proof_file IS NOT NULL AS has_proof, status, reject_reason, created_at, reviewed_at FROM contributions WHERE user_id = ? ORDER BY month DESC, id DESC'
    )
    .all(req.user.id);
  const month = currentMonth();
  res.json({
    items: rows,
    current_month: month,
    current_status: rows.find((c) => c.month === month && c.status === 'approved') ? 'approved' : rows.find((c) => c.month === month && c.status === 'pending') ? 'pending' : 'unpaid',
    up_to_date: isUpToDate(req.user.id),
  });
});

/* ---------- File d'attente & tableau de bord admin ---------- */
r.get('/contributions/stats', requirePerm('payments'), (_req, res) => {
  const month = currentMonth();
  const total = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM contributions WHERE status='approved'").get().s;
  const monthTotal = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM contributions WHERE status='approved' AND month=?").get(month).s;
  const pending = db.prepare("SELECT COUNT(*) n FROM contributions WHERE status='pending'").get().n;
  const active = db.prepare("SELECT COUNT(*) n FROM users WHERE role='member' AND status='active'").get().n;
  const paid = db.prepare("SELECT COUNT(DISTINCT user_id) n FROM contributions WHERE status='approved' AND month=?").get(month).n;
  const history = db
    .prepare("SELECT month, SUM(amount) total, COUNT(*) n FROM contributions WHERE status='approved' GROUP BY month ORDER BY month DESC LIMIT 6")
    .all()
    .reverse();
  res.json({
    month, total_collected: total, month_collected: monthTotal, pending,
    active_members: active, paid_members: paid, defaulters: Math.max(0, active - paid),
    rate: active ? Math.round((paid / active) * 100) : 0, history,
  });
});

r.get('/contributions/defaulters', requirePerm('payments'), (req, res) => {
  const p = paginate(req, 20);
  const month = currentMonth();
  const base = `FROM users u WHERE u.role='member' AND u.status='active'
    AND NOT EXISTS (SELECT 1 FROM contributions c WHERE c.user_id=u.id AND c.month=? AND c.status='approved')`;
  const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(month).n;
  const rows = db
    .prepare(
      `SELECT u.id, u.first_name, u.last_name, u.phone, u.email, u.neighborhood,
        EXISTS (SELECT 1 FROM contributions c WHERE c.user_id=u.id AND c.month=? AND c.status='pending') AS has_pending
       ${base} ORDER BY u.last_name, u.first_name LIMIT ? OFFSET ?`
    )
    .all(month, month, p.limit, p.offset);
  res.json(pageResult(rows, total, p));
});

r.post('/contributions/reminders', requirePerm('payments'), (_req, res) => {
  res.json({ sent: sendContributionReminders() });
});

const STATUS_FR = { pending: 'En attente', approved: 'Validé', rejected: 'Rejeté' };

/** Export CSV des cotisations (filtres : status, month, q). */
r.get('/contributions/export.csv', requirePerm('payments'), (req, res) => {
  const where = ['1=1'];
  const args = [];
  if (['pending', 'approved', 'rejected'].includes(req.query.status)) { where.push('c.status = ?'); args.push(req.query.status); }
  if (req.query.month && MONTH_RE.test(req.query.month)) { where.push('c.month = ?'); args.push(req.query.month); }
  if (req.query.q) { where.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR c.reference LIKE ?)'); const like = `%${req.query.q}%`; args.push(like, like, like); }
  const rows = db.prepare(
    `SELECT c.month, c.amount, c.method_label, c.reference, c.status, c.reject_reason, c.created_at, c.reviewed_at, u.first_name, u.last_name, u.phone, u.neighborhood
     FROM contributions c JOIN users u ON u.id = c.user_id WHERE ${where.join(' AND ')} ORDER BY c.month DESC, u.last_name LIMIT 50000`
  ).all(...args);
  audit(req.user.id, 'export.payments', null, null, `${rows.length} lignes`);
  sendCsv(res, `cotisations-${req.query.month || 'toutes'}.csv`,
    ['Mois', 'Nom', 'Prénom', 'Téléphone', 'Quartier', 'Montant (FCFA)', 'Moyen', 'Référence', 'Statut', 'Motif de rejet', 'Soumis le', 'Traité le'],
    rows.map((c) => [c.month, c.last_name, c.first_name, c.phone, c.neighborhood, c.amount, c.method_label, c.reference, STATUS_FR[c.status], c.reject_reason, c.created_at?.slice(0, 10), c.reviewed_at?.slice(0, 10)]));
});

r.get('/contributions', requirePerm('payments'), (req, res) => {
  const p = paginate(req, 20);
  const where = ['1=1'];
  const args = [];
  if (['pending', 'approved', 'rejected'].includes(req.query.status)) {
    where.push('c.status = ?');
    args.push(req.query.status);
  }
  if (req.query.month && MONTH_RE.test(req.query.month)) {
    where.push('c.month = ?');
    args.push(req.query.month);
  }
  if (req.query.q) {
    where.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR c.reference LIKE ?)');
    const like = `%${req.query.q}%`;
    args.push(like, like, like);
  }
  const w = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) n FROM contributions c JOIN users u ON u.id=c.user_id WHERE ${w}`).get(...args).n;
  const rows = db
    .prepare(
      `SELECT c.id, c.user_id, c.month, c.amount, c.method_label, c.reference, c.proof_file IS NOT NULL AS has_proof,
              c.proof_file, c.status, c.reject_reason, c.created_at, c.reviewed_at,
              u.first_name, u.last_name, u.phone, u.neighborhood
       FROM contributions c JOIN users u ON u.id=c.user_id WHERE ${w}
       ORDER BY (c.status='pending') DESC, c.created_at ${req.query.status === 'pending' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`
    )
    .all(...args, p.limit, p.offset);
  res.json(pageResult(rows, total, p));
});

function review(req, res, status) {
  const id = parseInt(req.params.id);
  const c = db.prepare('SELECT * FROM contributions WHERE id = ?').get(id);
  if (!c) throw notFound();
  if (c.status !== 'pending') throw new HttpError(409, 'Cette preuve a déjà été traitée');
  const reason = status === 'rejected' ? str(req.body.reason, { min: 3, max: 300, label: 'Motif' }) : null;
  db.prepare('UPDATE contributions SET status=?, reject_reason=?, reviewed_by=?, reviewed_at=? WHERE id=?').run(
    status, reason, req.user.id, new Date().toISOString(), id
  );
  audit(req.user.id, `payment.${status}`, 'contribution', id, `${c.month} — ${c.amount} FCFA${reason ? ' — ' + reason : ''}`);
  if (status === 'approved') notify(c.user_id, 'payment', 'Cotisation validée ', `Votre cotisation de ${c.month} a été approuvée.`, '/cotisations');
  else notify(c.user_id, 'payment', 'Cotisation rejetée ', `Cotisation ${c.month} : ${reason}`, '/cotisations');
  res.json({ ok: true });
}
r.post('/contributions/:id/approve', requirePerm('payments'), (req, res) => review(req, res, 'approved'));
r.post('/contributions/:id/reject', requirePerm('payments'), (req, res) => review(req, res, 'rejected'));

/** Preuve de paiement : visible uniquement par son auteur ou par l'équipe « payments ». */
r.get('/contributions/:id/proof', (req, res) => {
  const c = db.prepare('SELECT user_id, proof_file FROM contributions WHERE id = ?').get(parseInt(req.params.id));
  if (!c || !c.proof_file) throw notFound('Aucune preuve');
  if (c.user_id !== req.user.id && !hasPerm(req.user, 'payments')) throw new HttpError(403, 'Accès refusé');
  res.sendFile(path.join(PROOF_DIR, path.basename(c.proof_file)));
});

export default r;
