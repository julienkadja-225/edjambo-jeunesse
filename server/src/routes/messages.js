import { Router } from 'express';
import db, { tx } from '../db.js';
import { auth, requirePerm } from '../auth.js';
import { HttpError, audit, bad, forbidden, hasPerm, notFound, notify, notifyAdmins, nowIso, pageResult, paginate, str } from '../utils.js';

const r = Router();
r.use(auth);

const MAX_GROUP = 200;
const MAX_BODY = 2000;
const EDIT_WINDOW_MS = 24 * 3600 * 1000;
const REINVITE_DELAY_MS = 7 * 24 * 3600 * 1000;
const fullName = (u) => `${u.first_name} ${u.last_name}`.trim();

/* ---------- Anti-spam : 20 messages / 30 s par utilisateur ---------- */
const sent = new Map();
function throttle(userId) {
  const now = Date.now();
  const arr = (sent.get(userId) || []).filter((t) => now - t < 30000);
  if (arr.length >= 20) throw new HttpError(429, 'Vous envoyez trop de messages. Patientez quelques secondes.');
  arr.push(now);
  sent.set(userId, arr);
}

/* ---------- Helpers ---------- */
const directKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const membership = (convId, userId) => db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, userId);
const isBlocked = (a, b) =>
  !!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(a, b, b, a);
const lastMessageId = (convId) => db.prepare('SELECT COALESCE(MAX(id), 0) id FROM messages WHERE conversation_id = ?').get(convId).id;
const activeUser = (id) => db.prepare("SELECT id, first_name, last_name, photo, role FROM users WHERE id = ? AND status = 'active'").get(id);

function touch(convId) {
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowIso(), convId);
}

function addMessage(convId, senderId, body, kind = 'text') {
  const info = db.prepare('INSERT INTO messages(conversation_id, sender_id, kind, body) VALUES(?,?,?,?)').run(convId, senderId, kind, body);
  touch(convId);
  const id = Number(info.lastInsertRowid);
  if (kind === 'text') db.prepare('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?').run(id, convId, senderId);
  return id;
}

/** Conversation + participation de l'utilisateur ; 404 si non concerné (on ne révèle pas l'existence d'une conversation). */
function load(req, statuses = ['active']) {
  const id = parseInt(req.params.id);
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  const me = conv && membership(id, req.user.id);
  if (!conv || !me || !statuses.includes(me.status)) throw notFound('Conversation introuvable');
  return { conv, me };
}

const canManage = (me) => me.status === 'active' && (me.role === 'owner' || me.role === 'admin');

function present(m) {
  const deleted = !!m.deleted_at;
  return {
    id: m.id, kind: m.kind, sender_id: m.sender_id, first_name: m.first_name, last_name: m.last_name, photo: m.photo,
    body: deleted ? '' : m.body, deleted, edited: !!m.edited_at, created_at: m.created_at,
  };
}

/* ====================================================================== */
/*  Liste, compteurs, recherche de personnes, blocages                     */
/* ====================================================================== */
r.get('/', (req, res) => {
  const p = paginate(req, 40, 100);
  const invites = req.query.tab === 'invitations';
  const status = invites ? 'invited' : 'active';
  const base = `FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
    WHERE cm.user_id = ? AND cm.status = ?
    ${invites ? 'AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = cm.user_id AND b.blocked_id = cm.invited_by)' : ''}`;
  const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(req.user.id, status).n;
  const rows = db
    .prepare(
      `SELECT c.id, c.type, c.title, c.description, c.updated_at, cm.status, cm.role, cm.invited_by, cm.invited_at, cm.last_read_id, cm.joined_from_id,
        (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id AND x.status = 'active') AS member_count,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.id > cm.last_read_id AND m.id > cm.joined_from_id
           AND m.sender_id != cm.user_id AND m.deleted_at IS NULL AND m.kind = 'text') AS unread
       ${base} ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`
    )
    .all(req.user.id, status, p.limit, p.offset);

  const items = rows.map((c) => {
    const out = { ...c };
    if (c.type === 'direct') {
      const other = db
        .prepare(`SELECT u.id, u.first_name, u.last_name, u.photo, u.role FROM conversation_members x JOIN users u ON u.id = x.user_id
                  WHERE x.conversation_id = ? AND x.user_id != ?`)
        .get(c.id, req.user.id);
      out.other = other;
      out.title = other ? fullName(other) : 'Ancien membre';
    }
    if (invites) {
      const inviter = c.invited_by ? db.prepare('SELECT id, first_name, last_name, photo FROM users WHERE id = ?').get(c.invited_by) : null;
      out.inviter = inviter;
      // aperçu : seul le premier message de l'invitant est visible tant que l'invitation n'est pas acceptée
      if (c.type === 'direct' && inviter) {
        const m = db.prepare("SELECT body, created_at FROM messages WHERE conversation_id = ? AND sender_id = ? AND kind = 'text' AND deleted_at IS NULL ORDER BY id LIMIT 1").get(c.id, inviter.id);
        out.preview = m?.body || null;
      }
    } else {
      const m = db
        .prepare(`SELECT m.id, m.body, m.kind, m.sender_id, m.created_at, m.deleted_at, u.first_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id
                  WHERE m.conversation_id = ? AND m.id > ? ORDER BY m.id DESC LIMIT 1`)
        .get(c.id, c.joined_from_id);
      if (m) out.last = { body: m.deleted_at ? 'Message supprimé' : m.body, kind: m.kind, mine: m.sender_id === req.user.id, first_name: m.first_name, created_at: m.created_at };
    }
    return out;
  });
  res.json(pageResult(items, total, p));
});

r.get('/unread-count', (req, res) => {
  const messages = db
    .prepare(
      `SELECT COUNT(*) n FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ? AND cm.status = 'active'
       WHERE m.id > cm.last_read_id AND m.id > cm.joined_from_id AND m.sender_id != ? AND m.deleted_at IS NULL AND m.kind = 'text'`
    )
    .get(req.user.id, req.user.id).n;
  const invitations = db
    .prepare(
      `SELECT COUNT(*) n FROM conversation_members cm WHERE cm.user_id = ? AND cm.status = 'invited'
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = cm.user_id AND b.blocked_id = cm.invited_by)`
    )
    .get(req.user.id).n;
  res.json({ messages, invitations, total: messages + invitations });
});

/** Recherche de personnes à qui écrire (nom uniquement ; pas de coordonnées exposées). */
r.get('/people', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const like = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT u.id, u.first_name, u.last_name, u.photo, u.role, u.neighborhood FROM users u
       WHERE u.status = 'active' AND u.id != ? AND (u.first_name LIKE ? OR u.last_name LIKE ? OR (u.first_name || ' ' || u.last_name) LIKE ?)
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
       ORDER BY u.last_name, u.first_name LIMIT 15`
    )
    .all(req.user.id, like, like, like, req.user.id, req.user.id);
  res.json(rows);
});

r.get('/blocks', (req, res) => {
  res.json(db.prepare('SELECT u.id, u.first_name, u.last_name, u.photo FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC').all(req.user.id));
});

r.post('/blocks', (req, res) => {
  const uid = parseInt(req.body.user_id);
  if (!uid || uid === req.user.id) throw bad('Utilisateur invalide');
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) throw notFound('Utilisateur introuvable');
  db.prepare('INSERT OR IGNORE INTO blocks(blocker_id, blocked_id) VALUES(?,?)').run(req.user.id, uid);
  // la discussion privée existante disparaît de ma liste
  db.prepare(
    `UPDATE conversation_members SET status = 'left' WHERE user_id = ? AND status IN ('active','invited')
     AND conversation_id IN (SELECT id FROM conversations WHERE direct_key = ?)`
  ).run(req.user.id, directKey(req.user.id, uid));
  res.json({ ok: true });
});

r.delete('/blocks/:uid', (req, res) => {
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, parseInt(req.params.uid));
  res.json({ ok: true });
});

/* ====================================================================== */
/*  Signalements — file de modération (permission « forum »)               */
/* ====================================================================== */
r.get('/reports', requirePerm('forum'), (req, res) => {
  const p = paginate(req, 20);
  const status = ['open', 'dismissed', 'actioned'].includes(req.query.status) ? req.query.status : 'open';
  const total = db.prepare('SELECT COUNT(*) n FROM message_reports WHERE status = ?').get(status).n;
  const rows = db
    .prepare(
      `SELECT rp.id, rp.reason, rp.status, rp.created_at, rp.message_id, m.body, m.deleted_at, m.conversation_id, m.id AS mid,
              s.id AS sender_id, s.first_name AS sender_first, s.last_name AS sender_last, s.status AS sender_status,
              rr.first_name AS reporter_first, rr.last_name AS reporter_last, c.type AS conv_type, c.title AS conv_title,
              (SELECT COUNT(*) FROM message_reports x WHERE x.message_id = rp.message_id) AS report_count
       FROM message_reports rp JOIN messages m ON m.id = rp.message_id JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN users s ON s.id = m.sender_id JOIN users rr ON rr.id = rp.reporter_id
       WHERE rp.status = ? ORDER BY rp.id DESC LIMIT ? OFFSET ?`
    )
    .all(status, p.limit, p.offset)
    .map((x) => ({
      ...x,
      context: db
        .prepare(`SELECT m2.body, m2.deleted_at, u.first_name FROM messages m2 LEFT JOIN users u ON u.id = m2.sender_id
                  WHERE m2.conversation_id = ? AND m2.id < ? AND m2.kind = 'text' ORDER BY m2.id DESC LIMIT 2`)
        .all(x.conversation_id, x.mid)
        .reverse()
        .map((c) => ({ first_name: c.first_name, body: c.deleted_at ? '' : c.body })),
    }));
  res.json(pageResult(rows, total, p));
});

r.patch('/reports/:rid', requirePerm('forum'), (req, res) => {
  const rp = db.prepare('SELECT rp.*, m.sender_id, m.conversation_id FROM message_reports rp JOIN messages m ON m.id = rp.message_id WHERE rp.id = ?').get(parseInt(req.params.rid));
  if (!rp) throw notFound();
  const action = req.body.action;
  if (!['dismiss', 'delete_message', 'suspend_sender'].includes(action)) throw bad('Action invalide');
  tx(() => {
    if (action !== 'dismiss') db.prepare('UPDATE messages SET deleted_at = ? WHERE id = ?').run(nowIso(), rp.message_id);
    if (action === 'suspend_sender' && rp.sender_id) {
      const u = db.prepare('SELECT role FROM users WHERE id = ?').get(rp.sender_id);
      if (u?.role !== 'member') throw forbidden("Les comptes admin ne se suspendent pas ici");
      db.prepare("UPDATE users SET status = 'suspended', status_reason = 'Message signalé jugé contraire aux règles' WHERE id = ?").run(rp.sender_id);
      db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(rp.sender_id);
    }
    db.prepare("UPDATE message_reports SET status = ?, handled_by = ?, handled_at = ? WHERE message_id = ? AND status = 'open'")
      .run(action === 'dismiss' ? 'dismissed' : 'actioned', req.user.id, nowIso(), rp.message_id);
    audit(req.user.id, `report.${action}`, 'message', rp.message_id);
  });
  res.json({ ok: true });
});

/* ====================================================================== */
/*  Création : discussion privée (avec demande) et groupe (avec invitations) */
/* ====================================================================== */
r.post('/direct', (req, res) => {
  const otherId = parseInt(req.body.user_id);
  const body = str(req.body.body, { min: 1, max: MAX_BODY, label: 'Message' });
  if (!otherId || otherId === req.user.id) throw bad('Destinataire invalide');
  const other = activeUser(otherId);
  if (!other) throw notFound('Membre introuvable');
  if (isBlocked(req.user.id, otherId)) throw forbidden("Vous ne pouvez pas écrire à ce membre");
  throttle(req.user.id);

  let convId;
  let invitedNow = false;
  tx(() => {
    const conv = db.prepare('SELECT * FROM conversations WHERE direct_key = ?').get(directKey(req.user.id, otherId));
    if (!conv) {
      const info = db.prepare("INSERT INTO conversations(type, direct_key, created_by) VALUES('direct', ?, ?)").run(directKey(req.user.id, otherId), req.user.id);
      convId = Number(info.lastInsertRowid);
      db.prepare("INSERT INTO conversation_members(conversation_id, user_id, status, joined_at) VALUES(?,?, 'active', ?)").run(convId, req.user.id, nowIso());
      db.prepare("INSERT INTO conversation_members(conversation_id, user_id, status, invited_by, invited_at) VALUES(?,?, 'invited', ?, ?)").run(convId, otherId, req.user.id, nowIso());
      invitedNow = true;
    } else {
      convId = conv.id;
      const mine = membership(convId, req.user.id);
      const theirs = membership(convId, otherId);
      if (theirs?.status === 'declined') throw forbidden('Cette personne a décliné votre demande de discussion');
      if (mine?.status === 'invited') {
        // l'autre m'avait écrit : lui répondre vaut acceptation
        db.prepare("UPDATE conversation_members SET status = 'active', joined_at = ? WHERE conversation_id = ? AND user_id = ?").run(nowIso(), convId, req.user.id);
      } else if (!mine) {
        db.prepare("INSERT INTO conversation_members(conversation_id, user_id, status, joined_at) VALUES(?,?, 'active', ?)").run(convId, req.user.id, nowIso());
      } else if (mine.status !== 'active') {
        db.prepare("UPDATE conversation_members SET status = 'active', joined_at = ? WHERE conversation_id = ? AND user_id = ?").run(nowIso(), convId, req.user.id);
      }
      if (!theirs) {
        db.prepare("INSERT INTO conversation_members(conversation_id, user_id, status, invited_by, invited_at) VALUES(?,?, 'invited', ?, ?)").run(convId, otherId, req.user.id, nowIso());
        invitedNow = true;
      } else if (theirs.status === 'invited') {
        const n = db.prepare("SELECT COUNT(*) n FROM messages WHERE conversation_id = ? AND sender_id = ? AND kind = 'text'").get(convId, req.user.id).n;
        if (n >= 1 && theirs.invited_by === req.user.id) throw new HttpError(409, "Votre demande est en attente : vous pourrez écrire dès qu'elle sera acceptée.");
      } else if (theirs.status === 'left' || theirs.status === 'removed') {
        db.prepare("UPDATE conversation_members SET status = 'invited', invited_by = ?, invited_at = ? WHERE conversation_id = ? AND user_id = ?").run(req.user.id, nowIso(), convId, otherId);
        invitedNow = true;
      }
    }
    addMessage(convId, req.user.id, body);
  });
  if (invitedNow) notify(otherId, 'message', 'Nouvelle demande de discussion', `${fullName(req.user)} souhaite vous écrire.`, '/messages?tab=invitations');
  res.status(201).json({ id: convId });
});

r.post('/groups', (req, res) => {
  const title = str(req.body.title, { min: 3, max: 80, label: 'Nom du groupe' });
  const description = str(req.body.description ?? '', { max: 300 }) || null;
  const ids = [...new Set((Array.isArray(req.body.member_ids) ? req.body.member_ids : []).map((x) => parseInt(x)).filter((x) => x && x !== req.user.id))];
  if (ids.length > MAX_GROUP - 1) throw bad(`Un groupe est limité à ${MAX_GROUP} membres`);
  let convId;
  const invited = [];
  tx(() => {
    const info = db.prepare("INSERT INTO conversations(type, title, description, created_by) VALUES('group', ?, ?, ?)").run(title, description, req.user.id);
    convId = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO conversation_members(conversation_id, user_id, role, status, joined_at) VALUES(?,?, 'owner', 'active', ?)").run(convId, req.user.id, nowIso());
    for (const id of ids) {
      if (!activeUser(id) || isBlocked(req.user.id, id)) continue;
      db.prepare("INSERT INTO conversation_members(conversation_id, user_id, status, invited_by, invited_at) VALUES(?,?, 'invited', ?, ?)").run(convId, id, req.user.id, nowIso());
      invited.push(id);
    }
    addMessage(convId, req.user.id, `${fullName(req.user)} a créé le groupe « ${title} »`, 'system');
  });
  for (const id of invited) notify(id, 'message', 'Invitation à un groupe', `${fullName(req.user)} vous invite dans « ${title} ».`, '/messages?tab=invitations');
  res.status(201).json({ id: convId, invited: invited.length, skipped: ids.length - invited.length });
});

/* ====================================================================== */
/*  Détail, réponse aux invitations, gestion du groupe                     */
/* ====================================================================== */
r.get('/:id', (req, res) => {
  const { conv, me } = load(req, ['active', 'invited']);
  const members = db
    .prepare(
      `SELECT u.id, u.first_name, u.last_name, u.photo, u.role AS site_role, x.role, x.status, x.joined_at
       FROM conversation_members x JOIN users u ON u.id = x.user_id
       WHERE x.conversation_id = ? AND x.status IN ('active'${me.status === 'active' ? ",'invited'" : ''})
       ORDER BY CASE x.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, x.status, u.first_name LIMIT 300`
    )
    .all(conv.id);
  const out = {
    id: conv.id, type: conv.type, title: conv.title, description: conv.description, created_at: conv.created_at,
    me: { status: me.status, role: me.role, invited_by: me.invited_by },
    can_manage: conv.type === 'group' && canManage(me), is_owner: me.role === 'owner' && me.status === 'active',
    members: me.status === 'active' || conv.type === 'group' ? members : [],
    member_count: members.filter((m) => m.status === 'active').length,
  };
  if (conv.type === 'direct') {
    const other = db.prepare(
      `SELECT u.id, u.first_name, u.last_name, u.photo, u.role, u.neighborhood, x.status, x.invited_by FROM conversation_members x JOIN users u ON u.id = x.user_id
       WHERE x.conversation_id = ? AND x.user_id != ?`).get(conv.id, req.user.id);
    out.other = other;
    out.title = other ? fullName(other) : 'Ancien membre';
    out.blocked = other ? !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(req.user.id, other.id) : false;
    out.pending_reply = other?.status === 'invited' && other.invited_by === req.user.id; // ma demande attend une réponse
  }
  if (me.status === 'invited' && me.invited_by) out.inviter = db.prepare('SELECT id, first_name, last_name, photo FROM users WHERE id = ?').get(me.invited_by);
  res.json(out);
});

r.post('/:id/accept', (req, res) => {
  const { conv, me } = load(req, ['invited']);
  tx(() => {
    db.prepare("UPDATE conversation_members SET status = 'active', joined_at = ?, joined_from_id = ?, last_read_id = ? WHERE conversation_id = ? AND user_id = ?")
      .run(nowIso(), conv.type === 'group' ? lastMessageId(conv.id) : 0, conv.type === 'group' ? lastMessageId(conv.id) : 0, conv.id, req.user.id);
    if (conv.type === 'group') addMessage(conv.id, req.user.id, `${fullName(req.user)} a rejoint le groupe`, 'system');
  });
  if (me.invited_by) {
    notify(me.invited_by, 'message', conv.type === 'group' ? 'Invitation acceptée' : 'Demande acceptée',
      conv.type === 'group' ? `${fullName(req.user)} a rejoint « ${conv.title} ».` : `${fullName(req.user)} a accepté votre demande de discussion.`, `/messages/${conv.id}`);
  }
  res.json({ ok: true, id: conv.id });
});

r.post('/:id/decline', (req, res) => {
  const { conv } = load(req, ['invited']);
  db.prepare("UPDATE conversation_members SET status = 'declined' WHERE conversation_id = ? AND user_id = ?").run(conv.id, req.user.id);
  res.json({ ok: true });
});

r.post('/:id/leave', (req, res) => {
  const { conv, me } = load(req, ['active']);
  tx(() => {
    db.prepare("UPDATE conversation_members SET status = 'left', role = 'member' WHERE conversation_id = ? AND user_id = ?").run(conv.id, req.user.id);
    if (conv.type !== 'group') return;
    addMessage(conv.id, req.user.id, `${fullName(req.user)} a quitté le groupe`, 'system');
    if (me.role === 'owner') {
      // transmission de la propriété : administrateur le plus ancien, sinon membre le plus ancien
      const next = db.prepare(
        `SELECT user_id FROM conversation_members WHERE conversation_id = ? AND status = 'active'
         ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined_at LIMIT 1`).get(conv.id);
      if (next) db.prepare("UPDATE conversation_members SET role = 'owner' WHERE conversation_id = ? AND user_id = ?").run(conv.id, next.user_id);
    }
  });
  res.json({ ok: true });
});

r.patch('/:id', (req, res) => {
  const { conv, me } = load(req, ['active']);
  if (conv.type !== 'group') throw bad('Réservé aux groupes');
  if (!canManage(me)) throw forbidden();
  const title = str(req.body.title ?? conv.title, { min: 3, max: 80, label: 'Nom du groupe' });
  const description = str(req.body.description ?? conv.description ?? '', { max: 300 }) || null;
  db.prepare('UPDATE conversations SET title = ?, description = ? WHERE id = ?').run(title, description, conv.id);
  if (title !== conv.title) addMessage(conv.id, req.user.id, `${fullName(req.user)} a renommé le groupe en « ${title} »`, 'system');
  res.json({ ok: true });
});

r.delete('/:id', (req, res) => {
  const { conv, me } = load(req, ['active']);
  if (conv.type !== 'group' || me.role !== 'owner') throw forbidden('Seul le créateur peut supprimer le groupe');
  db.prepare('DELETE FROM conversations WHERE id = ?').run(conv.id);
  res.json({ ok: true });
});

/** Invitation de nouveaux membres : chacun doit accepter pour rejoindre le groupe. */
r.post('/:id/invite', (req, res) => {
  const { conv, me } = load(req, ['active']);
  if (conv.type !== 'group') throw bad('Réservé aux groupes');
  if (!canManage(me)) throw forbidden("Seuls le créateur et les administrateurs du groupe peuvent inviter");
  const ids = [...new Set((Array.isArray(req.body.user_ids) ? req.body.user_ids : []).map((x) => parseInt(x)).filter((x) => x && x !== req.user.id))];
  if (!ids.length) throw bad('Aucun membre sélectionné');
  const size = db.prepare("SELECT COUNT(*) n FROM conversation_members WHERE conversation_id = ? AND status IN ('active','invited')").get(conv.id).n;
  if (size + ids.length > MAX_GROUP) throw bad(`Un groupe est limité à ${MAX_GROUP} membres`);
  const invited = [];
  tx(() => {
    for (const id of ids) {
      if (!activeUser(id) || isBlocked(req.user.id, id)) continue;
      const cur = membership(conv.id, id);
      if (cur && ['active', 'invited'].includes(cur.status)) continue;
      if (cur?.status === 'declined' && cur.invited_at && Date.now() - new Date(cur.invited_at) < REINVITE_DELAY_MS) continue; // pas de harcèlement
      if (cur) db.prepare("UPDATE conversation_members SET status = 'invited', role = 'member', invited_by = ?, invited_at = ? WHERE conversation_id = ? AND user_id = ?").run(req.user.id, nowIso(), conv.id, id);
      else db.prepare("INSERT INTO conversation_members(conversation_id, user_id, status, invited_by, invited_at) VALUES(?,?, 'invited', ?, ?)").run(conv.id, id, req.user.id, nowIso());
      invited.push(id);
    }
  });
  for (const id of invited) notify(id, 'message', 'Invitation à un groupe', `${fullName(req.user)} vous invite dans « ${conv.title} ».`, '/messages?tab=invitations');
  res.json({ invited: invited.length, skipped: ids.length - invited.length });
});

r.delete('/:id/members/:uid', (req, res) => {
  const { conv, me } = load(req, ['active']);
  if (conv.type !== 'group') throw bad('Réservé aux groupes');
  if (!canManage(me)) throw forbidden();
  const uid = parseInt(req.params.uid);
  const target = membership(conv.id, uid);
  if (!target || !['active', 'invited'].includes(target.status)) throw notFound('Membre introuvable');
  if (target.role === 'owner' || uid === req.user.id) throw forbidden('Action impossible sur ce membre');
  if (target.role === 'admin' && me.role !== 'owner') throw forbidden("Seul le créateur peut retirer un administrateur");
  tx(() => {
    db.prepare("UPDATE conversation_members SET status = 'removed', role = 'member' WHERE conversation_id = ? AND user_id = ?").run(conv.id, uid);
    if (target.status === 'active') {
      const u = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(uid);
      addMessage(conv.id, req.user.id, `${fullName(u)} a été retiré du groupe`, 'system');
    }
  });
  res.json({ ok: true });
});

r.patch('/:id/members/:uid', (req, res) => {
  const { conv, me } = load(req, ['active']);
  if (conv.type !== 'group' || me.role !== 'owner') throw forbidden('Seul le créateur peut modifier les rôles');
  const uid = parseInt(req.params.uid);
  const role = req.body.role;
  if (!['admin', 'member'].includes(role)) throw bad('Rôle invalide');
  const target = membership(conv.id, uid);
  if (!target || target.status !== 'active' || target.role === 'owner') throw notFound('Membre introuvable');
  db.prepare('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?').run(role, conv.id, uid);
  res.json({ ok: true });
});

/* ====================================================================== */
/*  Messages                                                               */
/* ====================================================================== */
const MSG_SELECT = `SELECT m.id, m.kind, m.sender_id, m.body, m.created_at, m.edited_at, m.deleted_at, u.first_name, u.last_name, u.photo
  FROM messages m LEFT JOIN users u ON u.id = m.sender_id`;

r.get('/:id/messages', (req, res) => {
  const { conv, me } = load(req, ['active', 'invited']);
  if (me.status === 'invited') {
    // invité : on n'affiche que le(s) message(s) de demande de l'invitant (discussion privée), jamais l'historique d'un groupe
    if (conv.type === 'group' || !me.invited_by) return res.json({ items: [], has_more: false, restricted: true });
    const rows = db.prepare(`${MSG_SELECT} WHERE m.conversation_id = ? AND m.sender_id = ? AND m.kind = 'text' ORDER BY m.id LIMIT 1`).all(conv.id, me.invited_by);
    return res.json({ items: rows.map(present), has_more: false, restricted: true });
  }
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit) || 40));
  const after = parseInt(req.query.after) || 0;
  const before = parseInt(req.query.before) || 0;
  let rows;
  let hasMore = false;
  if (after) {
    rows = db.prepare(`${MSG_SELECT} WHERE m.conversation_id = ? AND m.id > ? AND m.id > ? ORDER BY m.id LIMIT 100`).all(conv.id, Math.max(after, me.joined_from_id), 0);
  } else {
    const args = [conv.id, me.joined_from_id];
    let cond = 'm.conversation_id = ? AND m.id > ?';
    if (before) { cond += ' AND m.id < ?'; args.push(before); }
    rows = db.prepare(`${MSG_SELECT} WHERE ${cond} ORDER BY m.id DESC LIMIT ?`).all(...args, limit + 1);
    hasMore = rows.length > limit;
    rows = rows.slice(0, limit).reverse();
  }
  if (!before) {
    // thread ouvert : tout est considéré comme lu
    db.prepare('UPDATE conversation_members SET last_read_id = MAX(last_read_id, ?) WHERE conversation_id = ? AND user_id = ?').run(lastMessageId(conv.id), conv.id, req.user.id);
  }
  res.json({ items: rows.map(present), has_more: hasMore });
});

r.post('/:id/messages', (req, res) => {
  const { conv, me } = load(req, ['active']);
  const body = str(req.body.body, { min: 1, max: MAX_BODY, label: 'Message' });
  if (conv.type === 'direct') {
    const other = db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id != ?').get(conv.id, req.user.id);
    if (!other) throw forbidden();
    if (isBlocked(req.user.id, other.user_id)) throw forbidden("Vous ne pouvez plus écrire dans cette discussion");
    if (other.status === 'declined') throw forbidden('Cette personne a décliné la discussion');
    if (other.status === 'invited') {
      const n = db.prepare("SELECT COUNT(*) n FROM messages WHERE conversation_id = ? AND sender_id = ? AND kind = 'text'").get(conv.id, req.user.id).n;
      if (n >= 1) throw new HttpError(409, "Votre demande est en attente : vous pourrez écrire dès qu'elle sera acceptée.");
    } else if (other.status !== 'active') {
      // l'autre a quitté : la discussion se rouvre sous forme de nouvelle demande
      db.prepare("UPDATE conversation_members SET status = 'invited', invited_by = ?, invited_at = ? WHERE conversation_id = ? AND user_id = ?").run(req.user.id, nowIso(), conv.id, other.user_id);
      notify(other.user_id, 'message', 'Nouvelle demande de discussion', `${fullName(req.user)} souhaite vous écrire.`, '/messages?tab=invitations');
    }
  }
  throttle(req.user.id);
  const id = addMessage(conv.id, req.user.id, body);
  res.status(201).json({ id });
});

r.patch('/:id/messages/:mid', (req, res) => {
  const { conv } = load(req, ['active']);
  const m = db.prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND kind = 'text'").get(parseInt(req.params.mid), conv.id);
  if (!m || m.deleted_at) throw notFound('Message introuvable');
  if (m.sender_id !== req.user.id) throw forbidden('Vous ne pouvez modifier que vos propres messages');
  if (Date.now() - new Date(m.created_at) > EDIT_WINDOW_MS) throw forbidden('Ce message ne peut plus être modifié (24 h)');
  const body = str(req.body.body, { min: 1, max: MAX_BODY, label: 'Message' });
  db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?').run(body, nowIso(), m.id);
  res.json({ ok: true });
});

r.delete('/:id/messages/:mid', (req, res) => {
  const { conv, me } = load(req, ['active']);
  const m = db.prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND kind = 'text'").get(parseInt(req.params.mid), conv.id);
  if (!m || m.deleted_at) throw notFound('Message introuvable');
  const moderator = conv.type === 'group' && canManage(me);
  if (m.sender_id !== req.user.id && !moderator) throw forbidden();
  db.prepare('UPDATE messages SET deleted_at = ? WHERE id = ?').run(nowIso(), m.id);
  res.json({ ok: true });
});

r.post('/:id/messages/:mid/report', (req, res) => {
  const { conv } = load(req, ['active']);
  const m = db.prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND kind = 'text'").get(parseInt(req.params.mid), conv.id);
  if (!m || m.deleted_at) throw notFound('Message introuvable');
  if (m.sender_id === req.user.id) throw bad('Vous ne pouvez pas signaler votre propre message');
  const reason = str(req.body.reason ?? '', { max: 300 }) || null;
  const info = db.prepare('INSERT OR IGNORE INTO message_reports(message_id, reporter_id, reason) VALUES(?,?,?)').run(m.id, req.user.id, reason);
  if (info.changes) notifyAdmins('forum', 'report', 'Message signalé', 'Un message privé a été signalé par un membre.', '/admin/signalements');
  res.json({ ok: true });
});

export default r;
