import { Router } from 'express';
import db from '../db.js';
import { auth } from '../auth.js';
import { pageResult, paginate } from '../utils.js';

const r = Router();
r.use(auth);

r.get('/', (req, res) => {
  const p = paginate(req, 20);
  const total = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ?').get(req.user.id).n;
  const rows = db
    .prepare('SELECT id, type, title, body, link, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(req.user.id, p.limit, p.offset);
  res.json(pageResult(rows, total, p));
});

r.get('/unread-count', (req, res) => {
  res.json({ count: db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).n });
});

r.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

r.post('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(parseInt(req.params.id), req.user.id);
  res.json({ ok: true });
});

export default r;
