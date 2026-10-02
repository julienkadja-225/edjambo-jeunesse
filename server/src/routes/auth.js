import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { auth, issueRefresh, loadUser, revokeRefresh, rotateRefresh, signAccess } from '../auth.js';
import { checkMagic, photoUpload, PUBLIC_DIR, removeFile } from '../upload.js';
import crypto from 'node:crypto';
import { HttpError, audit, bad, notify, notifyAdmins, publicUser, sha256, str, nowIso, validatePassword } from '../utils.js';
import { mailerConfigured, sendMail } from '../mailer.js';

const r = Router();

const normPhone = (p) => (p || '').replace(/[\s.\-()]/g, '');
const normEmail = (e) => (e || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function session(user) {
  return {
    user: publicUser(loadUser(user.id)),
    accessToken: signAccess(user.id),
    refreshToken: issueRefresh(user.id),
  };
}

r.post('/register', photoUpload.single('photo'), checkMagic, (req, res) => {
  const photo = req.file?.filename || null;
  try {
    const first_name = str(req.body.first_name, { min: 2, max: 60, label: 'Prénom' });
    const last_name = str(req.body.last_name, { min: 2, max: 60, label: 'Nom' });
    const email = normEmail(req.body.email) || null;
    const phone = normPhone(req.body.phone) || null;
    if (!email && !phone) throw bad('Email ou téléphone requis');
    if (email && !EMAIL_RE.test(email)) throw bad('Email invalide');
    if (phone && !/^\+?\d{8,15}$/.test(phone)) throw bad('Téléphone invalide');
    validatePassword(req.body.password);
    const age = parseInt(req.body.age);
    if (!(age >= 12 && age <= 99)) throw bad('Âge invalide');
    const neighborhood = str(req.body.neighborhood, { min: 2, max: 80, label: 'Quartier' });

    if (email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Cet email est déjà utilisé');
    if (phone && db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw new HttpError(409, 'Ce téléphone est déjà utilisé');

    const info = db
      .prepare(
        `INSERT INTO users(role, first_name, last_name, email, phone, password_hash, age, neighborhood, photo, status)
         VALUES('member',?,?,?,?,?,?,?,?, 'pending')`
      )
      .run(first_name, last_name, email, phone, bcrypt.hashSync(req.body.password, 10), age, neighborhood, photo);
    notifyAdmins('members', 'registration', 'Nouvelle inscription', `${first_name} ${last_name} (${neighborhood}) attend validation.`, '/admin/membres?status=pending');
    res.status(201).json({ id: Number(info.lastInsertRowid), message: "Inscription reçue. Un administrateur validera votre compte." });
  } catch (e) {
    removeFile(PUBLIC_DIR, photo);
    throw e;
  }
});

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

r.post('/login', (req, res) => {
  const id = String(req.body.identifier || '').trim();
  const password = String(req.body.password || '');
  if (!id || !password) throw bad('Identifiant et mot de passe requis');
  const user = id.includes('@')
    ? db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail(id))
    : db.prepare('SELECT * FROM users WHERE phone = ?').get(normPhone(id));
  if (!user) throw new HttpError(401, 'Identifiants incorrects');
  if (user.locked_until && user.locked_until > nowIso()) {
    const min = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
    throw new HttpError(423, `Compte temporairement verrouillé après plusieurs échecs. Réessayez dans ${min} min, utilisez « Mot de passe oublié » ou contactez un administrateur.`);
  }
  if (!bcrypt.compareSync(password, user.password_hash)) {
    const attempts = user.failed_attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?').run(new Date(Date.now() + LOCK_MINUTES * 60000).toISOString(), user.id);
    } else {
      db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, user.id);
    }
    const left = MAX_ATTEMPTS - attempts;
    throw new HttpError(401, left > 0 && left <= 2 ? `Identifiants incorrects. Il reste ${left} tentative(s) avant verrouillage.` : 'Identifiants incorrects');
  }
  if (user.status === 'pending') throw new HttpError(403, "Votre inscription est en attente de validation par l'équipe d'administration.");
  if (user.status === 'suspended') throw new HttpError(403, `Compte suspendu${user.status_reason ? ' : ' + user.status_reason : ''}.`);
  if (user.status === 'inactive') throw new HttpError(403, `Compte inactif${user.status_reason ? ' : ' + user.status_reason : ''}.`);
  db.prepare('UPDATE users SET last_login = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(nowIso(), user.id);
  res.json(session(user));
});

/* ---------- Mot de passe oublié ---------- */
const RESET_TTL_MIN = 60;
const APP_URL = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

r.post('/forgot', async (req, res) => {
  const id = String(req.body.identifier || '').trim();
  if (!id) throw bad('Email ou téléphone requis');
  const user = id.includes('@')
    ? db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail(id))
    : db.prepare('SELECT * FROM users WHERE phone = ?').get(normPhone(id));
  // Réponse identique que le compte existe ou non (pas d'énumération de comptes)
  const out = {
    message: "Si un compte correspond, un lien de réinitialisation vient d'être envoyé par email. Sans email enregistré, contactez un administrateur de la jeunesse pour obtenir un mot de passe temporaire.",
  };
  if (user && user.status !== 'pending') {
    db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(nowIso(), user.id);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO password_resets(user_id, token_hash, expires_at) VALUES(?,?,?)').run(user.id, sha256(token), new Date(Date.now() + RESET_TTL_MIN * 60000).toISOString());
    const link = `${APP_URL()}/reinitialiser/${token}`;
    if (user.email && mailerConfigured()) {
      sendMail({
        to: user.email,
        subject: "Réinitialisation de votre mot de passe — Jeunesse d'EDJAMBO",
        text: `Bonjour ${user.first_name},

Pour choisir un nouveau mot de passe, ouvrez ce lien (valable ${RESET_TTL_MIN} minutes) :
${link}

Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
      }).catch((e) => console.error('Envoi email :', e.message));
    } else if (process.env.NODE_ENV !== 'production') {
      // Développement sans SMTP : le lien est affiché dans la console et renvoyé pour faciliter les tests
      console.log(`[reset] ${user.email || user.phone} → ${link}`);
      out.dev_link = link;
    }
  }
  res.json(out);
});

function findReset(token) {
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(String(token || '')));
  if (!row || row.used_at || row.expires_at < nowIso()) return null;
  return row;
}

r.get('/reset/:token', (req, res) => res.json({ valid: !!findReset(req.params.token) }));

r.post('/reset', (req, res) => {
  const row = findReset(req.body.token);
  if (!row) throw new HttpError(400, 'Ce lien est invalide ou a expiré. Refaites une demande.');
  validatePassword(req.body.password);
  db.prepare(
    'UPDATE users SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL, password_changed_at = ? WHERE id = ?'
  ).run(bcrypt.hashSync(req.body.password, 10), nowIso(), row.user_id);
  db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(nowIso(), row.user_id);
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(row.user_id);
  notify(row.user_id, 'security', 'Mot de passe modifié', "Votre mot de passe vient d'être réinitialisé. Si ce n'était pas vous, contactez un administrateur.", '/profil');
  res.json({ ok: true });
});

r.post('/refresh', (req, res) => {
  const token = String(req.body.refreshToken || '');
  if (!token) throw new HttpError(401, 'Session invalide');
  const userId = rotateRefresh(token);
  const user = loadUser(userId);
  if (!user || user.status !== 'active') throw new HttpError(401, 'Compte inactif');
  res.json(session(user));
});

r.post('/logout', (req, res) => {
  if (req.body.refreshToken) revokeRefresh(String(req.body.refreshToken));
  res.json({ ok: true });
});

r.get('/me', auth, (req, res) => res.json(publicUser(req.user)));

r.put('/me', auth, photoUpload.single('photo'), checkMagic, (req, res) => {
  const u = req.user;
  try {
    const first_name = str(req.body.first_name ?? u.first_name, { min: 2, max: 60, label: 'Prénom' });
    const last_name = str(req.body.last_name ?? u.last_name, { min: 2, max: 60, label: 'Nom' });
    const neighborhood = str(req.body.neighborhood ?? u.neighborhood, { min: 2, max: 80, label: 'Quartier' });
    const age = parseInt(req.body.age ?? u.age);
    if (!(age >= 12 && age <= 99)) throw bad('Âge invalide');
    const email = req.body.email !== undefined ? normEmail(req.body.email) || null : u.email;
    const phone = req.body.phone !== undefined ? normPhone(req.body.phone) || null : u.phone;
    if (!email && !phone) throw bad('Email ou téléphone requis');
    if (email && !EMAIL_RE.test(email)) throw bad('Email invalide');
    if (phone && !/^\+?\d{8,15}$/.test(phone)) throw bad('Téléphone invalide');
    if (email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, u.id)) throw new HttpError(409, 'Email déjà utilisé');
    if (phone && db.prepare('SELECT 1 FROM users WHERE phone = ? AND id != ?').get(phone, u.id)) throw new HttpError(409, 'Téléphone déjà utilisé');
    const photo = req.file?.filename || u.photo;
    db.prepare(
      'UPDATE users SET first_name=?, last_name=?, email=?, phone=?, age=?, neighborhood=?, photo=? WHERE id=?'
    ).run(first_name, last_name, email, phone, age, neighborhood, photo, u.id);
    if (req.file && u.photo) removeFile(PUBLIC_DIR, u.photo);
    res.json(publicUser(loadUser(u.id)));
  } catch (e) {
    if (req.file) removeFile(PUBLIC_DIR, req.file.filename);
    throw e;
  }
});

r.put('/me/password', auth, (req, res) => {
  const { current, next } = req.body;
  if (!bcrypt.compareSync(String(current || ''), req.user.password_hash)) throw new HttpError(400, 'Mot de passe actuel incorrect');
  validatePassword(next);
  if (next === current) throw bad("Le nouveau mot de passe doit être différent de l'actuel");
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), nowIso(), req.user.id);
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user.id); // les autres appareils sont déconnectés
  res.json(session(req.user));
});

export default r;
