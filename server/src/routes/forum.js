import { Router } from 'express';
import db from '../db.js';
import { auth, requirePerm } from '../auth.js';
import { HttpError, bad, forbidden, hasPerm, notFound, notify, notifyAdmins, pageResult, paginate, str } from '../utils.js';

const r = Router();
r.use(auth);

const ensureMember = (req) => {
  if (req.user.role === 'member' || hasPerm(req.user, 'forum')) return;
  throw forbidden();
};

r.get('/categories', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM threads t WHERE t.category_id = c.id AND t.hidden = 0 AND t.type='discussion') AS threads
         FROM forum_categories c ORDER BY c.id`
      )
      .all()
  );
});

r.post('/categories', requirePerm('forum'), (req, res) => {
  const info = db
    .prepare('INSERT INTO forum_categories(name, description) VALUES(?,?)')
    .run(str(req.body.name, { min: 2, max: 60, label: 'Nom' }), str(req.body.description ?? '', { max: 200 }) || null);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

r.delete('/categories/:id', requirePerm('forum'), (req, res) => {
  db.prepare('DELETE FROM forum_categories WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

const THREAD_SELECT = `
  SELECT t.id, t.title, t.body, t.type, t.pinned, t.closed, t.hidden, t.created_at, t.category_id,
    c.name AS category, t.author_id, u.first_name, u.last_name, u.photo,
    (SELECT COUNT(*) FROM posts p WHERE p.thread_id = t.id AND p.hidden = 0) AS replies,
    (SELECT COUNT(*) FROM reactions x WHERE x.target_type='thread' AND x.target_id = t.id) AS likes,
    (SELECT 1 FROM reactions x WHERE x.target_type='thread' AND x.target_id = t.id AND x.user_id = @me) AS liked,
    COALESCE((SELECT SUM(value) FROM proposal_votes v WHERE v.thread_id = t.id), 0) AS score,
    (SELECT COUNT(*) FROM proposal_votes v WHERE v.thread_id = t.id AND v.value = 1) AS up,
    (SELECT COUNT(*) FROM proposal_votes v WHERE v.thread_id = t.id AND v.value = -1) AS down,
    (SELECT value FROM proposal_votes v WHERE v.thread_id = t.id AND v.user_id = @me) AS my_vote
  FROM threads t
  JOIN users u ON u.id = t.author_id
  LEFT JOIN forum_categories c ON c.id = t.category_id`;

r.get('/threads', (req, res) => {
  const p = paginate(req, 15);
  const mod = hasPerm(req.user, 'forum');
  const where = [];
  const args = { me: req.user.id };
  const type = req.query.type === 'proposal' ? 'proposal' : 'discussion';
  where.push('t.type = @type');
  args.type = type;
  if (!mod || req.query.hidden !== '1') where.push('t.hidden = 0');
  if (req.query.category) {
    where.push('t.category_id = @cat');
    args.cat = parseInt(req.query.category);
  }
  if (req.query.q) {
    where.push('(t.title LIKE @q OR t.body LIKE @q)');
    args.q = `%${req.query.q}%`;
  }
  const w = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) n FROM threads t WHERE ${w.replaceAll('@me', '@me')}`).get(Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'me'))).n;
  const order = req.query.sort === 'top' && type === 'proposal' ? 'score DESC, t.created_at DESC' : 't.pinned DESC, t.created_at DESC';
  const rows = db
    .prepare(`${THREAD_SELECT} WHERE ${w} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
    .all({ ...args, limit: p.limit, offset: p.offset })
    .map((t) => ({ ...t, body: t.body.length > 220 ? t.body.slice(0, 220) + '…' : t.body }));
  res.json(pageResult(rows, total, p));
});

r.post('/threads', (req, res) => {
  ensureMember(req);
  const type = req.body.type === 'proposal' ? 'proposal' : 'discussion';
  const title = str(req.body.title, { min: 4, max: 150, label: 'Titre' });
  const body = str(req.body.body, { min: 5, max: 5000, label: 'Message' });
  let category = null;
  if (type === 'discussion') {
    category = parseInt(req.body.category_id);
    if (!db.prepare('SELECT 1 FROM forum_categories WHERE id = ?').get(category)) throw bad('Catégorie invalide');
  }
  const info = db
    .prepare('INSERT INTO threads(category_id, author_id, type, title, body) VALUES(?,?,?,?,?)')
    .run(category, req.user.id, type, title, body);
  const id = Number(info.lastInsertRowid);
  if (type === 'proposal') notifyAdmins('forum', 'proposal', 'Nouvelle proposition', title, `/propositions/${id}`);
  res.status(201).json({ id });
});

r.get('/threads/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const t = db.prepare(`${THREAD_SELECT} WHERE t.id = @id`).get({ me: req.user.id, id });
  const mod = hasPerm(req.user, 'forum');
  if (!t || (t.hidden && !mod)) throw notFound('Discussion introuvable');
  const p = paginate(req, 20);
  const total = db.prepare(`SELECT COUNT(*) n FROM posts WHERE thread_id = ? ${mod ? '' : 'AND hidden = 0'}`).get(id).n;
  const posts = db
    .prepare(
      `SELECT p.id, p.body, p.hidden, p.created_at, p.author_id, u.first_name, u.last_name, u.photo,
        (SELECT COUNT(*) FROM reactions x WHERE x.target_type='post' AND x.target_id=p.id) AS likes,
        (SELECT 1 FROM reactions x WHERE x.target_type='post' AND x.target_id=p.id AND x.user_id=?) AS liked
       FROM posts p JOIN users u ON u.id=p.author_id
       WHERE p.thread_id = ? ${mod ? '' : 'AND p.hidden = 0'} ORDER BY p.created_at, p.id LIMIT ? OFFSET ?`
    )
    .all(req.user.id, id, p.limit, p.offset);
  res.json({ thread: t, posts: pageResult(posts, total, p) });
});

r.post('/threads/:id/posts', (req, res) => {
  ensureMember(req);
  const id = parseInt(req.params.id);
  const t = db.prepare('SELECT * FROM threads WHERE id = ? AND hidden = 0').get(id);
  if (!t) throw notFound('Discussion introuvable');
  if (t.closed) throw new HttpError(403, 'Cette discussion est fermée');
  const body = str(req.body.body, { min: 1, max: 3000, label: 'Message' });
  const info = db.prepare('INSERT INTO posts(thread_id, author_id, body) VALUES(?,?,?)').run(id, req.user.id, body);
  const link = t.type === 'proposal' ? `/propositions/${id}` : `/forum/${id}`;
  const participants = new Set([t.author_id, ...db.prepare('SELECT DISTINCT author_id FROM posts WHERE thread_id = ? LIMIT 50').all(id).map((x) => x.author_id)]);
  participants.delete(req.user.id);
  for (const uid of participants) notify(uid, 'reply', 'Nouvelle réponse', `${req.user.first_name} a répondu à « ${t.title} »`, link);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

r.post('/react', (req, res) => {
  const type = req.body.target_type;
  const tid = parseInt(req.body.target_id);
  if (!['thread', 'post'].includes(type)) throw bad('Cible invalide');
  const exists = db.prepare(`SELECT 1 FROM ${type === 'thread' ? 'threads' : 'posts'} WHERE id = ?`).get(tid);
  if (!exists) throw notFound();
  const had = db.prepare('DELETE FROM reactions WHERE user_id=? AND target_type=? AND target_id=?').run(req.user.id, type, tid).changes;
  if (!had) db.prepare('INSERT INTO reactions(user_id, target_type, target_id) VALUES(?,?,?)').run(req.user.id, type, tid);
  const likes = db.prepare('SELECT COUNT(*) n FROM reactions WHERE target_type=? AND target_id=?').get(type, tid).n;
  res.json({ liked: !had, likes });
});

/** Vote sur une proposition : +1 / -1 ; renvoyer la même valeur annule le vote. */
r.post('/threads/:id/vote', (req, res) => {
  ensureMember(req);
  const id = parseInt(req.params.id);
  const value = parseInt(req.body.value);
  if (![1, -1].includes(value)) throw bad('Valeur invalide');
  const t = db.prepare("SELECT * FROM threads WHERE id = ? AND type = 'proposal' AND hidden = 0").get(id);
  if (!t) throw notFound('Proposition introuvable');
  if (t.closed) throw new HttpError(403, 'Cette proposition est close');
  const cur = db.prepare('SELECT value FROM proposal_votes WHERE thread_id=? AND user_id=?').get(id, req.user.id);
  if (cur && cur.value === value) db.prepare('DELETE FROM proposal_votes WHERE thread_id=? AND user_id=?').run(id, req.user.id);
  else
    db.prepare('INSERT INTO proposal_votes(thread_id, user_id, value) VALUES(?,?,?) ON CONFLICT(thread_id, user_id) DO UPDATE SET value = excluded.value').run(id, req.user.id, value);
  const s = db
    .prepare('SELECT COALESCE(SUM(value),0) score, COALESCE(SUM(value=1),0) up, COALESCE(SUM(value=-1),0) down FROM proposal_votes WHERE thread_id=?')
    .get(id);
  const mine = db.prepare('SELECT value FROM proposal_votes WHERE thread_id=? AND user_id=?').get(id, req.user.id);
  res.json({ ...s, my_vote: mine ? mine.value : null });
});

/* ---------- Modération ---------- */
r.patch('/threads/:id', requirePerm('forum'), (req, res) => {
  const id = parseInt(req.params.id);
  const t = db.prepare('SELECT * FROM threads WHERE id = ?').get(id);
  if (!t) throw notFound();
  const f = (k) => (req.body[k] === undefined ? t[k] : req.body[k] ? 1 : 0);
  db.prepare('UPDATE threads SET pinned=?, closed=?, hidden=? WHERE id=?').run(f('pinned'), f('closed'), f('hidden'), id);
  res.json({ ok: true });
});

r.delete('/threads/:id', requirePerm('forum'), (req, res) => {
  db.prepare('DELETE FROM threads WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

r.patch('/posts/:id', requirePerm('forum'), (req, res) => {
  db.prepare('UPDATE posts SET hidden = ? WHERE id = ?').run(req.body.hidden ? 1 : 0, parseInt(req.params.id));
  res.json({ ok: true });
});

export default r;
