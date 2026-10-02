import { Router } from 'express';
import sanitizeHtml from 'sanitize-html';
import db from '../db.js';
import { auth, requirePerm } from '../auth.js';
import { PUBLIC_DIR, checkMagic, mediaUpload, removeFile } from '../upload.js';
import { activeMemberIds, audit, bad, notFound, notifyMany, pageResult, paginate, str } from '../utils.js';

export const publicRouter = Router();
const r = Router();

const clean = (html) =>
  sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'blockquote'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }) },
  });

const BASE = `
  SELECT a.id, a.type, a.title, a.body, a.event_date, a.location, a.media, a.created_at,
    u.first_name AS author_first, u.last_name AS author_last,
    (SELECT COUNT(*) FROM rsvps s WHERE s.announcement_id = a.id) AS rsvp_count,
    (SELECT COUNT(*) FROM reshares s WHERE s.announcement_id = a.id) AS share_count`;

/** Page publique d'une annonce (lien de partage, sans connexion). */
publicRouter.get('/announcements/:id', (req, res) => {
  const a = db
    .prepare(`${BASE} FROM announcements a LEFT JOIN users u ON u.id = a.author_id WHERE a.id = ?`)
    .get(parseInt(req.params.id));
  if (!a) throw notFound('Annonce introuvable');
  res.json(a);
});

r.use(auth);

r.get('/', (req, res) => {
  const p = paginate(req, 10);
  const where = ['1=1'];
  const args = [];
  if (['announcement', 'event'].includes(req.query.type)) {
    where.push('a.type = ?');
    args.push(req.query.type);
  }
  if (req.query.q) {
    where.push('(a.title LIKE ? OR a.body LIKE ? OR a.location LIKE ?)');
    const like = `%${req.query.q}%`;
    args.push(like, like, like);
  }
  if (req.query.upcoming === '1') {
    where.push("a.type = 'event' AND a.event_date >= ?");
    args.push(new Date().toISOString());
  }
  const w = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) n FROM announcements a WHERE ${w}`).get(...args).n;
  const rows = db
    .prepare(
      `${BASE},
        (SELECT 1 FROM rsvps s WHERE s.announcement_id = a.id AND s.user_id = ?) AS my_rsvp,
        (SELECT 1 FROM reshares s WHERE s.announcement_id = a.id AND s.user_id = ?) AS my_reshare
       FROM announcements a LEFT JOIN users u ON u.id = a.author_id WHERE ${w}
       ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(req.user.id, req.user.id, ...args, p.limit, p.offset);
  res.json(pageResult(rows, total, p));
});

r.get('/:id', (req, res) => {
  const a = db
    .prepare(
      `${BASE},
        (SELECT 1 FROM rsvps s WHERE s.announcement_id = a.id AND s.user_id = ?) AS my_rsvp,
        (SELECT 1 FROM reshares s WHERE s.announcement_id = a.id AND s.user_id = ?) AS my_reshare
       FROM announcements a LEFT JOIN users u ON u.id = a.author_id WHERE a.id = ?`
    )
    .get(req.user.id, req.user.id, parseInt(req.params.id));
  if (!a) throw notFound('Annonce introuvable');
  res.json(a);
});

function fields(b) {
  const type = b.type === 'event' ? 'event' : 'announcement';
  let event_date = null;
  if (type === 'event') {
    const d = new Date(b.event_date);
    if (isNaN(d)) throw bad("Date de l'événement requise");
    event_date = d.toISOString();
  }
  return {
    type,
    title: str(b.title, { min: 4, max: 150, label: 'Titre' }),
    body: clean(str(b.body, { min: 5, max: 20000, label: 'Contenu' })),
    event_date,
    location: str(b.location ?? '', { max: 150 }) || null,
  };
}

r.post('/', requirePerm('announcements'), mediaUpload.single('media'), checkMagic, (req, res) => {
  try {
    const f = fields(req.body);
    const info = db
      .prepare('INSERT INTO announcements(type, title, body, event_date, location, media, author_id) VALUES(?,?,?,?,?,?,?)')
      .run(f.type, f.title, f.body, f.event_date, f.location, req.file?.filename || null, req.user.id);
    const id = Number(info.lastInsertRowid);
    audit(req.user.id, 'announcement.create', 'announcement', id, f.title);
    notifyMany(
      activeMemberIds().filter((x) => x !== req.user.id),
      f.type === 'event' ? 'event' : 'announcement',
      f.type === 'event' ? `Nouvel événement : ${f.title}` : `Nouvelle annonce : ${f.title}`,
      f.location ? `${f.location}` : null,
      `/annonces/${id}`
    );
    res.status(201).json({ id });
  } catch (e) {
    if (req.file) removeFile(PUBLIC_DIR, req.file.filename);
    throw e;
  }
});

r.put('/:id', requirePerm('announcements'), mediaUpload.single('media'), checkMagic, (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const old = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    if (!old) throw notFound();
    const f = fields(req.body);
    const media = req.file?.filename || (req.body.remove_media === '1' ? null : old.media);
    db.prepare('UPDATE announcements SET type=?, title=?, body=?, event_date=?, location=?, media=? WHERE id=?').run(f.type, f.title, f.body, f.event_date, f.location, media, id);
    if (old.media && media !== old.media) removeFile(PUBLIC_DIR, old.media);
    res.json({ ok: true });
  } catch (e) {
    if (req.file) removeFile(PUBLIC_DIR, req.file.filename);
    throw e;
  }
});

r.delete('/:id', requirePerm('announcements'), (req, res) => {
  const id = parseInt(req.params.id);
  const a = db.prepare('SELECT media FROM announcements WHERE id = ?').get(id);
  if (!a) throw notFound();
  db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  audit(req.user.id, 'announcement.delete', 'announcement', id);
  removeFile(PUBLIC_DIR, a.media);
  res.json({ ok: true });
});

const toggle = (table) => (req, res) => {
  const id = parseInt(req.params.id);
  if (!db.prepare('SELECT 1 FROM announcements WHERE id = ?').get(id)) throw notFound();
  const had = db.prepare(`DELETE FROM ${table} WHERE announcement_id=? AND user_id=?`).run(id, req.user.id).changes;
  if (!had) db.prepare(`INSERT INTO ${table}(announcement_id, user_id) VALUES(?,?)`).run(id, req.user.id);
  const count = db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE announcement_id=?`).get(id).n;
  res.json({ active: !had, count });
};
r.post('/:id/rsvp', toggle('rsvps'));
r.post('/:id/reshare', toggle('reshares'));

export default r;
