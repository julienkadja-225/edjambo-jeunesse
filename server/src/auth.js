import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import db from './db.js';
import { HttpError, hasPerm, isAdmin, sha256 } from './utils.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-a-changer-en-production';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET doit être défini en production');
}
const ACCESS_TTL = '15m';
const REFRESH_DAYS = 7;

export function signAccess(userId) {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: ACCESS_TTL });
}

export function issueRefresh(userId) {
  const token = crypto.randomBytes(48).toString('hex');
  const expires = new Date(Date.now() + REFRESH_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO refresh_tokens(user_id, token_hash, expires_at) VALUES(?,?,?)').run(
    userId,
    sha256(token),
    expires
  );
  return token;
}

/** Rotation : le refresh token présenté est invalidé et remplacé. */
export function rotateRefresh(token) {
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(sha256(token));
  if (!row) throw new HttpError(401, 'Session invalide');
  db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(row.id);
  if (row.expires_at < new Date().toISOString()) throw new HttpError(401, 'Session expirée');
  return row.user_id;
}

export function revokeRefresh(token) {
  db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(sha256(token));
}

export function loadUser(id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return null;
  return { ...u, permissions: JSON.parse(u.permissions || '[]') };
}

export function auth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentification requise'));
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return next(new HttpError(401, 'Jeton invalide ou expiré'));
  }
  const user = loadUser(payload.sub);
  if (!user || user.status !== 'active') return next(new HttpError(401, 'Compte inactif'));
  // Mot de passe temporaire : seules les routes /api/auth/* restent utilisables tant qu'il n'est pas changé
  if (user.must_change_password && !req.originalUrl.startsWith('/api/auth/')) {
    const e = new HttpError(403, 'Vous devez changer votre mot de passe temporaire.');
    e.code = 'PASSWORD_CHANGE_REQUIRED';
    return next(e);
  }
  req.user = user;
  next();
}

export const requireAdmin = (req, _res, next) =>
  isAdmin(req.user) ? next() : next(new HttpError(403, 'Réservé aux administrateurs'));

export const requireSuper = (req, _res, next) =>
  req.user.role === 'super_admin' ? next() : next(new HttpError(403, 'Réservé au Super Admin'));

export const requirePerm = (perm) => (req, _res, next) =>
  hasPerm(req.user, perm) ? next() : next(new HttpError(403, `Permission « ${perm} » requise`));
