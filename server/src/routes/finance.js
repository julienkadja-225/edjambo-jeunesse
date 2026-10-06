import { Router } from 'express';
import path from 'node:path';
import db, { getSetting, setSetting } from '../db.js';
import { auth, requirePerm } from '../auth.js';
import { PROOF_DIR, checkMagic, proofUpload, removeFile } from '../upload.js';
import {
  HttpError, activeMemberIds, audit, bad, currentMonth, forbidden, hasPerm, notFound, notify, notifyMany,
  pageResult, paginate, sendCsv, str,
} from '../utils.js';

const r = Router();
r.use(auth);

export const CATEGORIES = {
  evenements: 'Événements',
  materiel: 'Matériel',
  solidarite: 'Solidarité',
  communication: 'Communication',
  fonctionnement: 'Fonctionnement',
  autre: 'Autre',
};
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const money = (n) => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;
const one = (sql, ...a) => db.prepare(sql).get(...a);

const setting = {
  opening: () => parseInt(getSetting('opening_balance', '0')),
  publicReceipts: () => getSetting('finance_public_receipts', '1') === '1',
  receiptAbove: () => parseInt(getSetting('receipt_required_above', '10000')),
};

function monthsBack(n, from = new Date()) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) out.push(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - k, 1)).toISOString().slice(0, 7));
  return out;
}

/** Solde cumulé à la fin d'un mois : solde initial + cotisations validées − dépenses validées. */
function balanceAt(month) {
  const end = `${month}-31`;
  const income = one("SELECT COALESCE(SUM(amount),0) s FROM contributions WHERE status='approved' AND month <= ?", month).s;
  const spent = one("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE status='approved' AND spent_at <= ?", end).s;
  return setting.opening() + income - spent;
}

r.get('/meta', (_req, res) => res.json({ categories: CATEGORIES, receipt_required_above: setting.receiptAbove() }));

/* ====================================================================== */
/*  Synthèse publique (membres) : aucun nom de cotisant                      */
/* ====================================================================== */
r.get('/summary', (req, res) => {
  const month = currentMonth();
  const year = parseInt(month.slice(0, 4));
  const incomeTotal = one("SELECT COALESCE(SUM(amount),0) s FROM contributions WHERE status='approved'").s;
  const expenseTotal = one("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE status='approved'").s;
  const months = monthsBack(12);
  const inc = Object.fromEntries(db.prepare("SELECT month, SUM(amount) s FROM contributions WHERE status='approved' AND month >= ? GROUP BY month").all(months[0]).map((x) => [x.month, x.s]));
  const exp = Object.fromEntries(db.prepare("SELECT substr(spent_at,1,7) m, SUM(amount) s FROM expenses WHERE status='approved' AND spent_at >= ? GROUP BY m").all(months[0] + '-01').map((x) => [x.m, x.s]));
  const byCategory = db
    .prepare("SELECT category, SUM(amount) total FROM expenses WHERE status='approved' AND substr(spent_at,1,4) = ? GROUP BY category ORDER BY total DESC")
    .all(String(year))
    .map((c) => ({ ...c, label: CATEGORIES[c.category] || c.category }));
  const spentByCat = Object.fromEntries(byCategory.map((c) => [c.category, c.total]));
  const budgets = db.prepare('SELECT category, amount FROM budgets WHERE year = ? ORDER BY category').all(year).map((b) => ({
    category: b.category, label: CATEGORIES[b.category] || b.category, planned: b.amount, spent: spentByCat[b.category] || 0,
  }));
  res.json({
    month, year,
    balance: setting.opening() + incomeTotal - expenseTotal,
    opening_balance: setting.opening(),
    total_income: incomeTotal,
    total_expenses: expenseTotal,
    month_income: inc[month] || 0,
    month_expenses: exp[month] || 0,
    paying_members: one("SELECT COUNT(DISTINCT user_id) n FROM contributions WHERE status='approved' AND month = ?", month).n,
    history: months.map((m) => ({ month: m, income: inc[m] || 0, expenses: exp[m] || 0 })),
    by_category: byCategory,
    budgets,
    public_receipts: setting.publicReceipts(),
    pending_expenses: hasPerm(req.user, 'finance') ? one("SELECT COUNT(*) n FROM expenses WHERE status='pending'").n : undefined,
  });
});

/* ====================================================================== */
/*  Dépenses                                                               */
/* ====================================================================== */
const EXP_COLS = `e.id, e.amount, e.category, e.description, e.spent_at, e.status, e.receipt_file IS NOT NULL AS has_receipt, e.created_at`;

r.get('/expenses', (req, res) => {
  const admin = hasPerm(req.user, 'finance');
  const p = paginate(req, 15);
  const where = [];
  const args = [];
  if (!admin) where.push("e.status = 'approved'");
  else if (['pending', 'approved', 'rejected'].includes(req.query.status)) { where.push('e.status = ?'); args.push(req.query.status); }
  if (CATEGORIES[req.query.category]) { where.push('e.category = ?'); args.push(req.query.category); }
  if (req.query.month && MONTH_RE.test(req.query.month)) { where.push("substr(e.spent_at,1,7) = ?"); args.push(req.query.month); }
  if (req.query.q) { where.push('e.description LIKE ?'); args.push(`%${req.query.q}%`); }
  const w = where.length ? where.join(' AND ') : '1=1';
  const total = one(`SELECT COUNT(*) n FROM expenses e WHERE ${w}`, ...args).n;
  const cols = admin
    ? `${EXP_COLS}, e.reject_reason, e.reviewed_at, e.created_by, c.first_name AS creator_first, c.last_name AS creator_last, rv.first_name AS reviewer_first, rv.last_name AS reviewer_last`
    : EXP_COLS;
  const rows = db
    .prepare(`SELECT ${cols} FROM expenses e ${admin ? 'LEFT JOIN users c ON c.id = e.created_by LEFT JOIN users rv ON rv.id = e.reviewed_by' : ''}
              WHERE ${w} ORDER BY (e.status = 'pending') DESC, e.spent_at DESC, e.id DESC LIMIT ? OFFSET ?`)
    .all(...args, p.limit, p.offset)
    .map((e) => ({ ...e, category_label: CATEGORIES[e.category] || e.category, can_view_receipt: !!e.has_receipt && (admin || setting.publicReceipts()) }));
  res.json({ ...pageResult(rows, total, p), sum: one(`SELECT COALESCE(SUM(amount),0) s FROM expenses e WHERE ${w}`, ...args).s });
});

function expenseBody(req) {
  const amount = parseInt(req.body.amount);
  if (!(amount > 0 && amount < 1_000_000_000)) throw bad('Montant invalide');
  if (!CATEGORIES[req.body.category]) throw bad('Catégorie invalide');
  const spent_at = String(req.body.spent_at || '');
  if (!DATE_RE.test(spent_at) || isNaN(new Date(spent_at))) throw bad('Date invalide');
  if (spent_at > new Date().toISOString().slice(0, 10)) throw bad('La date ne peut pas être dans le futur');
  return { amount, category: req.body.category, description: str(req.body.description, { min: 5, max: 300, label: 'Description' }), spent_at };
}

r.post('/expenses', requirePerm('finance'), proofUpload.single('receipt'), checkMagic, (req, res) => {
  const file = req.file?.filename || null;
  try {
    const b = expenseBody(req);
    if (!file && b.amount > setting.receiptAbove()) throw bad(`Un justificatif est obligatoire au-dessus de ${money(setting.receiptAbove())}`);
    const info = db
      .prepare('INSERT INTO expenses(amount, category, description, spent_at, receipt_file, created_by) VALUES(?,?,?,?,?,?)')
      .run(b.amount, b.category, b.description, b.spent_at, file, req.user.id);
    const id = Number(info.lastInsertRowid);
    audit(req.user.id, 'expense.create', 'expense', id, `${money(b.amount)} — ${b.description}`);
    // un autre responsable financier doit valider
    const reviewers = db.prepare("SELECT id, role, permissions FROM users WHERE role IN ('admin','super_admin') AND status='active' AND id != ?").all(req.user.id)
      .filter((a) => a.role === 'super_admin' || JSON.parse(a.permissions).includes('finance')).map((a) => a.id);
    notifyMany(reviewers, 'finance', 'Dépense à valider', `${money(b.amount)} — ${b.description}`, '/admin/finances');
    res.status(201).json({ id });
  } catch (e) {
    removeFile(PROOF_DIR, file);
    throw e;
  }
});

function pendingOwn(req) {
  const e = db.prepare('SELECT * FROM expenses WHERE id = ?').get(parseInt(req.params.id));
  if (!e) throw notFound('Dépense introuvable');
  return e;
}

r.put('/expenses/:id', requirePerm('finance'), proofUpload.single('receipt'), checkMagic, (req, res) => {
  const file = req.file?.filename || null;
  try {
    const e = pendingOwn(req);
    if (e.status === 'approved') throw new HttpError(409, 'Une dépense validée ne peut plus être modifiée');
    if (e.created_by !== req.user.id && req.user.role !== 'super_admin') throw forbidden('Seul son auteur peut modifier cette dépense');
    const b = expenseBody(req);
    const receipt = file || e.receipt_file;
    if (!receipt && b.amount > setting.receiptAbove()) throw bad(`Un justificatif est obligatoire au-dessus de ${money(setting.receiptAbove())}`);
    // une dépense rejetée corrigée repasse en attente de validation
    db.prepare("UPDATE expenses SET amount=?, category=?, description=?, spent_at=?, receipt_file=?, status='pending', reject_reason=NULL, reviewed_by=NULL, reviewed_at=NULL WHERE id=?")
      .run(b.amount, b.category, b.description, b.spent_at, receipt, e.id);
    if (file && e.receipt_file) removeFile(PROOF_DIR, e.receipt_file);
    audit(req.user.id, 'expense.update', 'expense', e.id, b.description);
    res.json({ ok: true });
  } catch (er) {
    removeFile(PROOF_DIR, file);
    throw er;
  }
});

r.delete('/expenses/:id', requirePerm('finance'), (req, res) => {
  const e = pendingOwn(req);
  if (e.status === 'approved') throw new HttpError(409, 'Une dépense validée ne peut pas être supprimée');
  if (e.created_by !== req.user.id && req.user.role !== 'super_admin') throw forbidden();
  db.prepare('DELETE FROM expenses WHERE id = ?').run(e.id);
  removeFile(PROOF_DIR, e.receipt_file);
  audit(req.user.id, 'expense.delete', 'expense', e.id, e.description);
  res.json({ ok: true });
});

/** Double validation : l'approbateur doit être différent de l'auteur de la dépense. */
function review(status) {
  return (req, res) => {
    const e = pendingOwn(req);
    if (e.status !== 'pending') throw new HttpError(409, 'Cette dépense a déjà été traitée');
    if (e.created_by === req.user.id) throw forbidden('Un autre responsable financier doit valider cette dépense');
    const reason = status === 'rejected' ? str(req.body.reason, { min: 3, max: 300, label: 'Motif' }) : null;
    db.prepare('UPDATE expenses SET status = ?, reject_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').run(status, reason, req.user.id, new Date().toISOString(), e.id);
    audit(req.user.id, `expense.${status === 'approved' ? 'approve' : 'reject'}`, 'expense', e.id, `${money(e.amount)} — ${e.description}${reason ? ' — ' + reason : ''}`);
    notify(e.created_by, 'finance', status === 'approved' ? 'Dépense validée' : 'Dépense rejetée', `${money(e.amount)} — ${e.description}${reason ? ' : ' + reason : ''}`, '/admin/finances');
    res.json({ ok: true });
  };
}
r.post('/expenses/:id/approve', requirePerm('finance'), review('approved'));
r.post('/expenses/:id/reject', requirePerm('finance'), review('rejected'));

/** Justificatif : responsables financiers, ou tous les membres si la transparence des justificatifs est activée. */
r.get('/expenses/:id/receipt', (req, res) => {
  const e = pendingOwn(req);
  if (!e.receipt_file) throw notFound('Aucun justificatif');
  const admin = hasPerm(req.user, 'finance');
  if (!admin && !(e.status === 'approved' && setting.publicReceipts())) throw forbidden();
  res.sendFile(path.join(PROOF_DIR, path.basename(e.receipt_file)));
});

r.get('/expenses.csv', requirePerm('finance'), (req, res) => {
  const rows = db.prepare(`SELECT e.*, c.first_name cf, c.last_name cl, rv.first_name rf, rv.last_name rl FROM expenses e
    LEFT JOIN users c ON c.id = e.created_by LEFT JOIN users rv ON rv.id = e.reviewed_by
    ${MONTH_RE.test(req.query.month || '') ? "WHERE substr(e.spent_at,1,7) = ?" : ''} ORDER BY e.spent_at DESC, e.id DESC LIMIT 50000`)
    .all(...(MONTH_RE.test(req.query.month || '') ? [req.query.month] : []));
  const ST = { pending: 'En attente', approved: 'Validée', rejected: 'Rejetée' };
  audit(req.user.id, 'export.expenses', null, null, `${rows.length} lignes`);
  sendCsv(res, `depenses-${req.query.month || 'toutes'}.csv`, ['Date', 'Catégorie', 'Description', 'Montant (FCFA)', 'Statut', 'Saisie par', 'Validée par', 'Justificatif'],
    rows.map((e) => [e.spent_at, CATEGORIES[e.category] || e.category, e.description, e.amount, ST[e.status], `${e.cf || ''} ${e.cl || ''}`.trim(), `${e.rf || ''} ${e.rl || ''}`.trim(), e.receipt_file ? 'Oui' : 'Non']));
});

/* ====================================================================== */
/*  Budgets et paramètres                                                  */
/* ====================================================================== */
r.get('/settings', requirePerm('finance'), (_req, res) => {
  res.json({ opening_balance: setting.opening(), public_receipts: setting.publicReceipts(), receipt_required_above: setting.receiptAbove() });
});

r.put('/settings', requirePerm('finance'), (req, res) => {
  const b = req.body;
  if (b.opening_balance !== undefined) {
    if (!Number.isInteger(parseInt(b.opening_balance))) throw bad('Solde initial invalide');
    setSetting('opening_balance', parseInt(b.opening_balance));
  }
  if (b.public_receipts !== undefined) setSetting('finance_public_receipts', b.public_receipts ? '1' : '0');
  if (b.receipt_required_above !== undefined) setSetting('receipt_required_above', Math.max(0, parseInt(b.receipt_required_above) || 0));
  audit(req.user.id, 'finance.settings', null, null, JSON.stringify(b));
  res.json({ ok: true });
});

r.put('/budgets', requirePerm('finance'), (req, res) => {
  const year = parseInt(req.body.year);
  const amount = parseInt(req.body.amount);
  if (!(year >= 2020 && year <= 2100)) throw bad('Année invalide');
  if (!CATEGORIES[req.body.category]) throw bad('Catégorie invalide');
  if (!(amount >= 0)) throw bad('Montant invalide');
  db.prepare('INSERT INTO budgets(year, category, amount) VALUES(?,?,?) ON CONFLICT(year, category) DO UPDATE SET amount = excluded.amount').run(year, req.body.category, amount);
  audit(req.user.id, 'finance.budget', null, null, `${year} ${req.body.category} ${money(amount)}`);
  res.json({ ok: true });
});

r.delete('/budgets/:year/:category', requirePerm('finance'), (req, res) => {
  db.prepare('DELETE FROM budgets WHERE year = ? AND category = ?').run(parseInt(req.params.year), req.params.category);
  res.json({ ok: true });
});

/* ====================================================================== */
/*  Rapport mensuel (affichage / PDF via impression, publication en annonce) */
/* ====================================================================== */
function buildReport(month) {
  const start = `${month}-01`;
  const end = `${month}-31`;
  const prev = new Date(Date.UTC(parseInt(month.slice(0, 4)), parseInt(month.slice(5)) - 2, 1)).toISOString().slice(0, 7);
  const byMethod = db.prepare("SELECT method_label label, SUM(amount) total, COUNT(*) n FROM contributions WHERE status='approved' AND month = ? GROUP BY method_label ORDER BY total DESC").all(month);
  const incomeTotal = byMethod.reduce((s, x) => s + x.total, 0);
  const items = db.prepare("SELECT id, amount, category, description, spent_at, receipt_file IS NOT NULL AS has_receipt FROM expenses WHERE status='approved' AND spent_at >= ? AND spent_at <= ? ORDER BY spent_at, id").all(start, end)
    .map((e) => ({ ...e, category_label: CATEGORIES[e.category] || e.category }));
  const expenseTotal = items.reduce((s, x) => s + x.amount, 0);
  const byCat = Object.entries(items.reduce((acc, e) => ({ ...acc, [e.category_label]: (acc[e.category_label] || 0) + e.amount }), {})).map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total);
  const active = one("SELECT COUNT(*) n FROM users WHERE role='member' AND status='active'").n;
  const payers = one("SELECT COUNT(DISTINCT user_id) n FROM contributions WHERE status='approved' AND month = ?", month).n;
  return {
    month,
    opening_balance: balanceAt(prev),
    income: { total: incomeTotal, payers, active_members: active, rate: active ? Math.round((payers / active) * 100) : 0, by_method: byMethod },
    expenses: { total: expenseTotal, items, by_category: byCat },
    closing_balance: balanceAt(month),
  };
}

r.get('/report', (req, res) => {
  const month = MONTH_RE.test(req.query.month || '') ? req.query.month : currentMonth();
  res.json(buildReport(month));
});

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const monthName = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Publie le rapport du mois sous forme d'annonce (notifie tous les membres actifs). */
r.post('/report/publish', requirePerm('finance'), (req, res) => {
  const month = MONTH_RE.test(req.body.month || '') ? req.body.month : currentMonth();
  const rep = buildReport(month);
  const rows = rep.expenses.by_category.map((c) => `<li>${esc(c.label)} : <strong>${money(c.total)}</strong></li>`).join('') || '<li>Aucune dépense ce mois-ci.</li>';
  const body =
    `<p>Rapport financier de <strong>${esc(monthName(month))}</strong>, publié en toute transparence.</p>` +
    `<ul><li>Solde d'ouverture : <strong>${money(rep.opening_balance)}</strong></li>` +
    `<li>Cotisations validées : <strong>${money(rep.income.total)}</strong> (${rep.income.payers} membres sur ${rep.income.active_members}, soit ${rep.income.rate} %)</li>` +
    `<li>Dépenses : <strong>${money(rep.expenses.total)}</strong></li>` +
    `<li>Solde de clôture : <strong>${money(rep.closing_balance)}</strong></li></ul>` +
    `<h3>Dépenses par catégorie</h3><ul>${rows}</ul>` +
    `<p>Le détail et les justificatifs sont consultables dans la rubrique « Finances ».</p>`;
  const info = db.prepare("INSERT INTO announcements(type, title, body, author_id) VALUES('announcement', ?, ?, ?)").run(`Rapport financier — ${monthName(month)}`, body, req.user.id);
  const id = Number(info.lastInsertRowid);
  notifyMany(activeMemberIds().filter((x) => x !== req.user.id), 'announcement', `Rapport financier — ${monthName(month)}`, null, `/annonces/${id}`);
  audit(req.user.id, 'finance.report_publish', 'announcement', id, month);
  res.status(201).json({ id });
});

export default r;
