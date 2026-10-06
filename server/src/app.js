import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { ROOT } from './db.js';
import { PUBLIC_DIR } from './upload.js';
import { tokenSubject } from './auth.js';
import { HttpError } from './utils.js';
import authRoutes from './routes/auth.js';
import memberRoutes from './routes/members.js';
import contributionRoutes from './routes/contributions.js';
import forumRoutes from './routes/forum.js';
import electionRoutes from './routes/elections.js';
import announcementRoutes, { publicRouter } from './routes/announcements.js';
import notificationRoutes from './routes/notifications.js';
import adminRoutes from './routes/admin.js';
import messageRoutes from './routes/messages.js';
import financeRoutes from './routes/finance.js';
import smsRoutes from './routes/sms.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'img-src': ["'self'", 'data:', 'blob:'], // aperçu des preuves de paiement
          'frame-src': ["'self'", 'blob:'], // aperçu PDF
        },
      },
    })
  );
  // En production sans CORS_ORIGIN : même origine uniquement (le front est servi par ce serveur)
  app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : process.env.NODE_ENV === 'production' ? false : true }));
  app.use(express.json({ limit: '200kb' }));
  // Express 5 laisse req.body indéfini quand le corps est absent ou n'est pas du JSON : on garantit un objet
  app.use((req, _res, next) => {
    if (req.body === undefined || req.body === null || typeof req.body !== 'object') req.body = {};
    next();
  });

  const strict = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: parseInt(process.env.AUTH_RATE_LIMIT || '30'),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de tentatives, réessayez dans quelques minutes.' },
  });
  // Limite générale : par compte connecté (plusieurs membres peuvent partager une même IP mobile), sinon par IP
  const userLimit = parseInt(process.env.API_RATE_LIMIT || '900');
  const anonLimit = parseInt(process.env.API_RATE_LIMIT_ANON || '240');
  app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    limit: (req) => (tokenSubject(req) ? userLimit : anonLimit),
    keyGenerator: (req) => {
      const sub = tokenSubject(req);
      const ip = String(req.ip || '');
      return sub ? `u:${sub}` : `ip:${ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip}`; // IPv6 : préfixe /64
    },
    skip: (req) => req.path === '/health',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de requêtes, patientez un instant.' },
  }));
  app.use('/api/auth/login', strict);
  app.use('/api/auth/register', strict);
  app.use('/api/auth/forgot', strict);
  app.use('/api/auth/reset', strict);

  app.use('/uploads', express.static(PUBLIC_DIR, { maxAge: '7d', index: false }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRouter);
  app.use('/api/members', memberRoutes);
  app.use('/api/forum', forumRoutes);
  app.use('/api/elections', electionRoutes);
  app.use('/api/announcements', announcementRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/admin/sms', smsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/finance', financeRoutes);
  app.use('/api', contributionRoutes); // /payment-methods, /contributions, /contribution-settings

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Route inconnue')));

  // Production : sert le front compilé
  const dist = process.env.CLIENT_DIST || path.resolve(ROOT, '..', 'client', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next()));
  }

  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (5 Mo maximum)' : 'Téléversement invalide';
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: msg });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse' });
    console.error(err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  });

  return app;
}
