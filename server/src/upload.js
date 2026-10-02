import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './db.js';
import { bad } from './utils.js';

export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
export const PUBLIC_DIR = path.join(UPLOAD_DIR, 'public'); // photos, médias d'annonces
export const PROOF_DIR = path.join(UPLOAD_DIR, 'proofs'); // preuves de paiement (accès authentifié)
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(PROOF_DIR, { recursive: true });

export const MAX_SIZE = 5 * 1024 * 1024; // 5 Mo

const MIME = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/pdf': ['.pdf'],
};

const MAGIC = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'application/pdf': (b) => b.toString('latin1', 0, 4) === '%PDF',
};

export function makeUpload(dir, { pdf = true } = {}) {
  return multer({
    limits: { fileSize: MAX_SIZE, files: 1 },
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) =>
        cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase()),
    }),
    fileFilter: (_req, file, cb) => {
      const exts = MIME[file.mimetype];
      const ext = path.extname(file.originalname).toLowerCase();
      if (!exts || !exts.includes(ext) || (!pdf && file.mimetype === 'application/pdf')) {
        return cb(bad(pdf ? 'Format accepté : JPG, PNG ou PDF' : 'Format accepté : JPG ou PNG'));
      }
      cb(null, true);
    },
  });
}

/** Vérifie la signature réelle du fichier (et non seulement son extension déclarée). */
export function checkMagic(req, _res, next) {
  const f = req.file;
  if (!f) return next();
  const fd = fs.openSync(f.path, 'r');
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  if (!MAGIC[f.mimetype]?.(buf)) {
    fs.unlink(f.path, () => {});
    return next(bad('Contenu du fichier invalide'));
  }
  next();
}

export function removeFile(dir, name) {
  if (name) fs.unlink(path.join(dir, path.basename(name)), () => {});
}

export const photoUpload = makeUpload(PUBLIC_DIR, { pdf: false });
export const mediaUpload = makeUpload(PUBLIC_DIR, { pdf: true });
export const proofUpload = makeUpload(PROOF_DIR, { pdf: true });
