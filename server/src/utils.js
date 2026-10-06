import crypto from 'node:crypto';
import db, { tx, getSetting } from './db.js';
import { mailerConfigured, sendMail } from './mailer.js';
import { queueExternal } from './gateway.js';

export const PERMISSIONS = ['members', 'payments', 'forum', 'announcements', 'elections', 'finance'];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Introuvable') => new HttpError(404, msg);
export const forbidden = (msg = 'Accès refusé') => new HttpError(403, msg);

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const nowIso = () => new Date().toISOString();

export function currentMonth(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

export function paginate(req, defLimit = 20, maxLimit = 100) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit) || defLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export const pageResult = (items, total, { page, limit }) => ({
  items,
  total,
  page,
  limit,
  pages: Math.max(1, Math.ceil(total / limit)),
});

export const isAdmin = (u) => u && (u.role === 'admin' || u.role === 'super_admin');
export const hasPerm = (u, perm) =>
  !!u && (u.role === 'super_admin' || (u.role === 'admin' && u.permissions.includes(perm)));

export function str(v, { min = 0, max = 5000, label = 'Champ' } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw bad(`${label} requis`);
  if (s.length > max) throw bad(`${label} trop long`);
  return s;
}

/** Cotisation à jour : paiement approuvé pour le mois en cours (tolérance du mois précédent pendant le délai de grâce). */
export function isUpToDate(userId) {
  const now = new Date();
  const months = [currentMonth(now)];
  const grace = parseInt(getSetting('grace_days', '10'));
  if (now.getUTCDate() <= grace) {
    months.push(currentMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))));
  }
  const row = db
    .prepare(
      `SELECT 1 FROM contributions WHERE user_id = ? AND status = 'approved'
       AND month IN (${months.map(() => '?').join(',')}) LIMIT 1`
    )
    .get(userId, ...months);
  return !!row;
}

// Types envoyés aussi par email (transactionnels, individuels) quand un serveur SMTP est configuré
const EMAIL_TYPES = new Set(['registration', 'payment', 'security']);

export function notify(userId, type, title, body = null, link = null) {
  db.prepare(
    'INSERT INTO notifications(user_id, type, title, body, link) VALUES(?,?,?,?,?)'
  ).run(userId, type, title, body, link);
  queueExternal([userId], type, title, body, link); // SMS / WhatsApp si le membre a donné son accord
  if (EMAIL_TYPES.has(type) && mailerConfigured()) {
    const u = db.prepare('SELECT email, first_name FROM users WHERE id = ?').get(userId);
    if (u?.email) {
      const base = (process.env.APP_URL || '').replace(/\/$/, '');
      sendMail({
        to: u.email,
        subject: `${title} — Jeunesse d'EDJAMBO`,
        text: `Bonjour ${u.first_name},\n\n${title}${body ? '\n' + body : ''}${link && base ? `\n\n${base}${link}` : ''}\n\n— La jeunesse d'EDJAMBO`,
      }).catch((e) => console.error('Email :', e.message));
    }
  }
}

export function notifyMany(userIds, type, title, body = null, link = null) {
  if (!userIds.length) return;
  const stmt = db.prepare(
    'INSERT INTO notifications(user_id, type, title, body, link) VALUES(?,?,?,?,?)'
  );
  tx(() => userIds.forEach((id) => stmt.run(id, type, title, body, link)));
  queueExternal(userIds, type, title, body, link);
}

export function activeMemberIds() {
  return db
    .prepare("SELECT id FROM users WHERE status = 'active'")
    .all()
    .map((r) => r.id);
}

export function notifyAdmins(perm, type, title, body = null, link = null) {
  const admins = db
    .prepare("SELECT id, role, permissions FROM users WHERE role IN ('admin','super_admin') AND status = 'active'")
    .all()
    .filter((a) => a.role === 'super_admin' || JSON.parse(a.permissions).includes(perm))
    .map((a) => a.id);
  notifyMany(admins, type, title, body, link);
}

/** Envoie un rappel aux membres actifs sans cotisation approuvée/en attente pour le mois en cours. */
export function sendContributionReminders() {
  const month = currentMonth();
  const rows = db
    .prepare(
      `SELECT u.id FROM users u
       WHERE u.role = 'member' AND u.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM contributions c WHERE c.user_id = u.id AND c.month = ? AND c.status IN ('approved','pending'))
         AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.type = 'reminder' AND n.title LIKE ?)`
    )
    .all(month, `%${month}%`);
  notifyMany(
    rows.map((r) => r.id),
    'reminder',
    `Cotisation ${month} à régler`,
    "Vous n'avez pas encore soumis votre cotisation du mois. Merci de la régler et d'envoyer votre preuve.",
    '/cotisations'
  );
  return rows.length;
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, failed_attempts, locked_until, ...rest } = u;
  return { ...rest, must_change_password: !!u.must_change_password, sms_optin: !!u.sms_optin, whatsapp_optin: !!u.whatsapp_optin, permissions: typeof u.permissions === 'string' ? JSON.parse(u.permissions) : u.permissions };
}

/** Règle de mot de passe commune : 8 caractères min., au moins une lettre et un chiffre. */
export function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw bad('Le mot de passe doit contenir au moins 8 caractères');
  if (p.length > 100) throw bad('Mot de passe trop long');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw bad('Le mot de passe doit contenir des lettres et des chiffres');
}

/** Mot de passe temporaire lisible (sans caractères ambigus), garanti conforme à la règle ci-dessus. */
export function tempPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(letters), pick(letters), pick(letters), pick(letters), pick(letters), pick(letters), pick(digits), pick(digits), pick(digits), pick(letters)];
  return chars.join('');
}

/** Journal d'activité (actions sensibles des administrateurs). */
export function audit(actorId, action, targetType = null, targetId = null, detail = null) {
  db.prepare('INSERT INTO audit_logs(actor_id, action, target_type, target_id, detail) VALUES(?,?,?,?,?)').run(actorId, action, targetType, targetId, detail);
}

/** Envoie un CSV compatible Excel (BOM UTF-8, séparateur « ; »), avec neutralisation des formules (=, +, -, @). */
export function sendCsv(res, filename, header, rows) {
  const cell = (v) => {
    let t = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t) && !/^[+-]?\d[\d\s.]*$/.test(t)) t = "'" + t; // numéros de téléphone (+225…) conservés
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const body = [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + body);
}
