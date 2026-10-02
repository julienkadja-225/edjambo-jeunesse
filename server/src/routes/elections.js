import { Router } from 'express';
import crypto from 'node:crypto';
import db, { tx } from '../db.js';
import { auth, requirePerm } from '../auth.js';
import {
  HttpError, activeMemberIds, audit, bad, hasPerm, isUpToDate, notFound, notifyMany, sha256, str,
} from '../utils.js';

const r = Router();
r.use(auth);

const GENESIS = 'GENESIS';

/** Statut effectif : une élection « open » dont la date de fin est passée est considérée comme close. */
function effStatus(e) {
  if (e.status === 'open' && new Date(e.end_at) < new Date()) return 'closed';
  return e.status;
}

function eligibility(user, e) {
  if (user.role !== 'member') return { ok: false, reason: 'Seuls les membres peuvent voter' };
  if (user.status !== 'active') return { ok: false, reason: 'Compte non actif' };
  if (e.require_contribution && !isUpToDate(user.id)) return { ok: false, reason: 'Cotisation non à jour' };
  return { ok: true };
}

function results(electionId) {
  return db
    .prepare(
      `SELECT c.id, c.name, c.program, c.user_id, COUNT(b.id) AS votes
       FROM candidates c LEFT JOIN ballots b ON b.candidate_id = c.id
       WHERE c.election_id = ? GROUP BY c.id ORDER BY votes DESC, c.id`
    )
    .all(electionId);
}

function present(e, user) {
  const status = effStatus(e);
  const mod = hasPerm(user, 'elections');
  const voted = !!db.prepare('SELECT 1 FROM voters WHERE election_id=? AND user_id=?').get(e.id, user.id);
  const elig = eligibility(user, e);
  const turnout = db.prepare('SELECT COUNT(*) n FROM voters WHERE election_id=?').get(e.id).n;
  return {
    ...e,
    status,
    stored_status: e.status,
    has_voted: voted,
    eligible: elig.ok,
    ineligible_reason: elig.reason || null,
    can_vote: status === 'open' && new Date(e.start_at) <= new Date() && elig.ok && !voted,
    turnout: mod || status === 'published' ? turnout : undefined,
  };
}

r.get('/', (req, res) => {
  const mod = hasPerm(req.user, 'elections');
  const rows = db
    .prepare(`SELECT * FROM elections ${mod ? '' : "WHERE status != 'draft'"} ORDER BY start_at DESC`)
    .all();
  res.json(rows.map((e) => present(e, req.user)));
});

r.get('/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM elections WHERE id = ?').get(parseInt(req.params.id));
  const mod = hasPerm(req.user, 'elections');
  if (!e || (e.status === 'draft' && !mod)) throw notFound('Élection introuvable');
  const out = present(e, req.user);
  const cands = results(e.id);
  const showResults = mod || out.status === 'published';
  out.candidates = cands.map((c) => ({ id: c.id, name: c.name, program: c.program, user_id: c.user_id, ...(showResults ? { votes: c.votes } : {}) }));
  out.results_visible = showResults;
  res.json(out);
});

/* ---------- Gestion ---------- */
function body(b) {
  const start_at = new Date(b.start_at);
  const end_at = new Date(b.end_at);
  if (isNaN(start_at) || isNaN(end_at)) throw bad('Dates invalides');
  if (end_at <= start_at) throw bad('La fin doit être postérieure au début');
  return [
    str(b.title, { min: 4, max: 150, label: 'Titre' }),
    str(b.description ?? '', { max: 2000 }) || null,
    start_at.toISOString(),
    end_at.toISOString(),
    b.require_contribution === false || b.require_contribution === 0 ? 0 : 1,
  ];
}

r.post('/', requirePerm('elections'), (req, res) => {
  const info = db
    .prepare('INSERT INTO elections(title, description, start_at, end_at, require_contribution, created_by) VALUES(?,?,?,?,?,?)')
    .run(...body(req.body), req.user.id);
  const id = Number(info.lastInsertRowid);
  // candidats optionnels à la création
  if (Array.isArray(req.body.candidates)) {
    const ins = db.prepare('INSERT INTO candidates(election_id, user_id, name, program) VALUES(?,?,?,?)');
    for (const c of req.body.candidates) ins.run(id, c.user_id ? parseInt(c.user_id) : null, str(c.name, { min: 2, max: 100, label: 'Nom du candidat' }), str(c.program ?? '', { max: 2000 }) || null);
  }
  res.status(201).json({ id });
});

function editable(id) {
  const e = db.prepare('SELECT * FROM elections WHERE id = ?').get(id);
  if (!e) throw notFound();
  if (e.status !== 'draft') throw new HttpError(409, 'Une élection ouverte ne peut plus être modifiée');
  return e;
}

r.put('/:id', requirePerm('elections'), (req, res) => {
  const id = parseInt(req.params.id);
  editable(id);
  db.prepare('UPDATE elections SET title=?, description=?, start_at=?, end_at=?, require_contribution=? WHERE id=?').run(...body(req.body), id);
  res.json({ ok: true });
});

r.delete('/:id', requirePerm('elections'), (req, res) => {
  editable(parseInt(req.params.id));
  db.prepare('DELETE FROM elections WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

r.post('/:id/candidates', requirePerm('elections'), (req, res) => {
  const id = parseInt(req.params.id);
  editable(id);
  const userId = req.body.user_id ? parseInt(req.body.user_id) : null;
  let name = req.body.name;
  if (userId) {
    const u = db.prepare("SELECT first_name, last_name FROM users WHERE id = ? AND status = 'active'").get(userId);
    if (!u) throw bad('Membre introuvable');
    name = name || `${u.first_name} ${u.last_name}`;
  }
  const info = db
    .prepare('INSERT INTO candidates(election_id, user_id, name, program) VALUES(?,?,?,?)')
    .run(id, userId, str(name, { min: 2, max: 100, label: 'Nom du candidat' }), str(req.body.program ?? '', { max: 2000 }) || null);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

r.delete('/:id/candidates/:cid', requirePerm('elections'), (req, res) => {
  editable(parseInt(req.params.id));
  db.prepare('DELETE FROM candidates WHERE id = ? AND election_id = ?').run(parseInt(req.params.cid), parseInt(req.params.id));
  res.json({ ok: true });
});

r.post('/:id/open', requirePerm('elections'), (req, res) => {
  const id = parseInt(req.params.id);
  const e = editable(id);
  if (db.prepare('SELECT COUNT(*) n FROM candidates WHERE election_id=?').get(id).n < 2) throw bad('Il faut au moins 2 candidats');
  if (new Date(e.end_at) <= new Date()) throw bad('La date de fin est déjà passée');
  db.prepare("UPDATE elections SET status='open' WHERE id=?").run(id);
  audit(req.user.id, 'election.open', 'election', id, e.title);
  notifyMany(activeMemberIds(), 'election', 'Élection ouverte ', e.title, `/elections/${id}`);
  res.json({ ok: true });
});

r.post('/:id/close', requirePerm('elections'), (req, res) => {
  const id = parseInt(req.params.id);
  const e = db.prepare('SELECT * FROM elections WHERE id = ?').get(id);
  if (!e) throw notFound();
  if (e.status !== 'open') throw new HttpError(409, "L'élection n'est pas ouverte");
  db.prepare("UPDATE elections SET status='closed', end_at = CASE WHEN end_at > ? THEN ? ELSE end_at END WHERE id=?").run(new Date().toISOString(), new Date().toISOString(), id);
  audit(req.user.id, 'election.close', 'election', id, e.title);
  notifyMany(activeMemberIds(), 'election', 'Élection clôturée', `${e.title} — les résultats seront publiés prochainement.`, `/elections/${id}`);
  res.json({ ok: true });
});

r.post('/:id/publish', requirePerm('elections'), (req, res) => {
  const id = parseInt(req.params.id);
  const e = db.prepare('SELECT * FROM elections WHERE id = ?').get(id);
  if (!e) throw notFound();
  if (effStatus(e) !== 'closed') throw new HttpError(409, "L'élection doit être clôturée avant publication");
  db.prepare("UPDATE elections SET status='published' WHERE id=?").run(id);
  audit(req.user.id, 'election.publish', 'election', id, e.title);
  notifyMany(activeMemberIds(), 'election', 'Résultats publiés', e.title, `/elections/${id}`);
  res.json({ ok: true });
});

/* ---------- Vote ---------- */
r.post('/:id/vote', (req, res) => {
  const id = parseInt(req.params.id);
  const candidateId = parseInt(req.body.candidate_id);
  const receipt = crypto.randomBytes(16).toString('hex');
  tx(() => {
    const e = db.prepare('SELECT * FROM elections WHERE id = ?').get(id);
    if (!e || e.status === 'draft') throw notFound('Élection introuvable');
    if (effStatus(e) !== 'open') throw new HttpError(403, "Le vote n'est pas ouvert");
    if (new Date(e.start_at) > new Date()) throw new HttpError(403, "Le vote n'a pas encore commencé");
    const elig = eligibility(req.user, e);
    if (!elig.ok) throw new HttpError(403, elig.reason);
    if (!db.prepare('SELECT 1 FROM candidates WHERE id = ? AND election_id = ?').get(candidateId, id)) throw bad('Candidat invalide');
    const ts = new Date().toISOString();
    try {
      db.prepare('INSERT INTO voters(election_id, user_id, voted_at) VALUES(?,?,?)').run(id, req.user.id, ts);
    } catch {
      throw new HttpError(409, 'Vous avez déjà voté');
    }
    const last = db.prepare('SELECT hash FROM ballots WHERE election_id = ? ORDER BY id DESC LIMIT 1').get(id);
    const prev = last ? last.hash : GENESIS;
    const receiptHash = sha256(receipt);
    const hash = sha256([prev, id, candidateId, receiptHash, ts].join('|'));
    db.prepare('INSERT INTO ballots(election_id, candidate_id, receipt_hash, prev_hash, hash, created_at) VALUES(?,?,?,?,?,?)').run(id, candidateId, receiptHash, prev, hash, ts);
  });
  res.status(201).json({ ok: true, receipt, message: 'Votre vote a été enregistré. Conservez ce reçu pour vérifier votre bulletin.' });
});

/* ---------- Suivi temps réel & audit ---------- */
r.get('/:id/live', requirePerm('elections'), (req, res) => {
  const id = parseInt(req.params.id);
  const e = db.prepare('SELECT * FROM elections WHERE id = ?').get(id);
  if (!e) throw notFound();
  const eligible = db.prepare("SELECT COUNT(*) n FROM users WHERE role='member' AND status='active'").get().n;
  const turnout = db.prepare('SELECT COUNT(*) n FROM voters WHERE election_id=?').get(id).n;
  res.json({ status: effStatus(e), results: results(id), turnout, eligible_members: eligible });
});

function verifyChain(id) {
  const ballots = db.prepare('SELECT * FROM ballots WHERE election_id = ? ORDER BY id').all(id);
  let prev = GENESIS;
  let valid = true;
  for (const b of ballots) {
    const expected = sha256([prev, id, b.candidate_id, b.receipt_hash, b.created_at].join('|'));
    if (b.prev_hash !== prev || b.hash !== expected) valid = false;
    prev = b.hash;
  }
  const voters = db.prepare('SELECT COUNT(*) n FROM voters WHERE election_id=?').get(id).n;
  return { ballots, chain_valid: valid, consistent: voters === ballots.length, voters };
}

r.get('/:id/audit', (req, res) => {
  const id = parseInt(req.params.id);
  const e = db.prepare('SELECT * FROM elections WHERE id = ?').get(id);
  if (!e || e.status === 'draft') throw notFound();
  const mod = hasPerm(req.user, 'elections');
  if (!mod && e.status !== 'published') throw new HttpError(403, "L'audit est public après publication des résultats");
  const { ballots, chain_valid, consistent, voters } = verifyChain(id);
  res.json({
    election: { id, title: e.title, status: effStatus(e) },
    chain_valid, consistent, total_ballots: ballots.length, total_voters: voters,
    ballots: ballots.map((b, i) => ({ seq: i + 1, receipt_hash: b.receipt_hash, candidate_id: b.candidate_id, hash: b.hash, prev_hash: b.prev_hash, created_at: b.created_at })),
  });
});

/** Vérification individuelle : le votant retrouve son bulletin grâce à son reçu (sans lien avec son identité). */
r.post('/:id/verify-receipt', (req, res) => {
  const id = parseInt(req.params.id);
  const receipt = String(req.body.receipt || '').trim();
  if (!receipt) throw bad('Reçu requis');
  const b = db.prepare('SELECT id, candidate_id, created_at, hash FROM ballots WHERE election_id=? AND receipt_hash=?').get(id, sha256(receipt));
  if (!b) return res.json({ found: false });
  const e = db.prepare('SELECT status FROM elections WHERE id = ?').get(id);
  const cand = db.prepare('SELECT name FROM candidates WHERE id = ?').get(b.candidate_id);
  res.json({ found: true, candidate: cand?.name, created_at: b.created_at, hash: b.hash, published: e.status === 'published' });
});

export default r;
