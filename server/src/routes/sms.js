import { Router } from 'express';
import db, { getSetting, setSetting } from '../db.js';
import { auth, requireSuper } from '../auth.js';
import { EVENT_LABELS, enabledEvents, gatewayStats, maskPhone, normalizePhone, processOutbox, providerInfo, sendTest } from '../gateway.js';
import { audit, bad, pageResult, paginate } from '../utils.js';

const r = Router();
r.use(auth, requireSuper);

r.get('/status', (_req, res) => {
  res.json({
    provider: providerInfo(),
    events: enabledEvents(),
    event_labels: EVENT_LABELS,
    daily_cap: parseInt(getSetting('sms_daily_cap', '500')),
    default_country_code: getSetting('default_country_code', '225'),
    stats: gatewayStats(),
  });
});

r.put('/settings', (req, res) => {
  const b = req.body;
  if (b.events !== undefined) {
    if (!Array.isArray(b.events)) throw bad('Événements invalides');
    setSetting('sms_events', JSON.stringify(b.events.filter((e) => EVENT_LABELS[e])));
  }
  if (b.unit_cost !== undefined) setSetting('sms_unit_cost', Math.max(0, parseInt(b.unit_cost) || 0));
  if (b.daily_cap !== undefined) setSetting('sms_daily_cap', Math.max(0, parseInt(b.daily_cap) || 0));
  if (b.default_country_code !== undefined) {
    if (!/^\d{1,4}$/.test(String(b.default_country_code))) throw bad('Indicatif invalide');
    setSetting('default_country_code', String(b.default_country_code));
  }
  audit(req.user.id, 'sms.settings', null, null, JSON.stringify(b));
  res.json({ ok: true });
});

r.get('/outbox', (req, res) => {
  const p = paginate(req, 20);
  const where = ['1=1'];
  const args = [];
  if (['queued', 'sent', 'failed', 'simulated', 'skipped'].includes(req.query.status)) { where.push('o.status = ?'); args.push(req.query.status); }
  if (['sms', 'whatsapp'].includes(req.query.channel)) { where.push('o.channel = ?'); args.push(req.query.channel); }
  const w = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) n FROM outbox o WHERE ${w}`).get(...args).n;
  const rows = db
    .prepare(`SELECT o.id, o.channel, o.to_addr, o.event_type, o.body, o.status, o.error, o.attempts, o.created_at, o.sent_at, u.first_name, u.last_name
              FROM outbox o LEFT JOIN users u ON u.id = o.user_id WHERE ${w} ORDER BY o.id DESC LIMIT ? OFFSET ?`)
    .all(...args, p.limit, p.offset)
    .map((o) => ({ ...o, to_addr: maskPhone(o.to_addr) }));
  res.json(pageResult(rows, total, p));
});

r.post('/test', async (req, res) => {
  const channel = req.body.channel === 'whatsapp' ? 'whatsapp' : 'sms';
  try {
    const result = await sendTest(req.user, channel, String(req.body.text || '').slice(0, 200));
    audit(req.user.id, 'sms.test', null, null, `${channel} → ${result.status}`);
    res.json(result);
  } catch (e) {
    throw bad(e.message);
  }
});

r.post('/retry-failed', (req, res) => {
  const info = db.prepare("UPDATE outbox SET status = 'queued', attempts = 0, error = NULL, next_attempt_at = NULL WHERE status = 'failed'").run();
  audit(req.user.id, 'sms.retry', null, null, `${info.changes} message(s)`);
  res.json({ requeued: info.changes });
});

/** Envoi immédiat de la file (sans attendre le prochain cycle). */
r.post('/process', async (_req, res) => {
  res.json(await processOutbox({ limit: 200, ignoreSchedule: true }));
});

export default r;
