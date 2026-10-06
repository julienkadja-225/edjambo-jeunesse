// Passerelle SMS / WhatsApp : file d'envoi persistante (table outbox), consentement obligatoire,
// plafond journalier, nouvelles tentatives avec délai croissant.
// Fournisseurs : « console » (par défaut : simule l'envoi), « twilio » (SMS + WhatsApp) ou « webhook »
// (POST JSON vers l'URL de votre prestataire local).
import db, { getSetting } from './db.js';

export const EVENT_LABELS = {
  reminder: 'Rappels de cotisation',
  payment: 'Cotisation validée ou rejetée',
  registration: 'Inscription approuvée ou refusée',
  election: 'Élections (ouverture, clôture, résultats)',
  event: 'Nouveaux événements',
  announcement: 'Nouvelles annonces',
  security: 'Alertes de sécurité',
  message: 'Demandes de messagerie',
};
export const DEFAULT_EVENTS = ['reminder', 'payment', 'registration', 'election'];
const MAX_ATTEMPTS = 3;
const SMS_MAX_LEN = 320;

export function enabledEvents() {
  try {
    const v = JSON.parse(getSetting('sms_events', 'null'));
    return Array.isArray(v) ? v.filter((e) => EVENT_LABELS[e]) : DEFAULT_EVENTS;
  } catch { return DEFAULT_EVENTS; }
}

export const providerName = () => (process.env.SMS_PROVIDER || 'console').toLowerCase();

export function providerInfo() {
  const name = providerName();
  if (name === 'twilio') {
    const base = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    return { name, configured: base, simulated: false, channels: { sms: base && !!process.env.TWILIO_SMS_FROM, whatsapp: base && !!process.env.TWILIO_WHATSAPP_FROM } };
  }
  if (name === 'webhook') {
    const ok = !!process.env.SMS_WEBHOOK_URL;
    return { name, configured: ok, simulated: false, channels: { sms: ok, whatsapp: ok } };
  }
  return { name: 'console', configured: false, simulated: true, channels: { sms: true, whatsapp: true } };
}

/** Numéro au format international (+225…). Retourne null si invalide. */
export function normalizePhone(raw, cc = getSetting('default_country_code', '225')) {
  let s = String(raw || '').trim().replace(/[\s.\-()]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) {
    // numéro local : on ajoute l'indicatif ; en Côte d'Ivoire le 0 initial fait partie du numéro (format à 10 chiffres)
    s = '+' + cc + (cc === '225' ? s : s.replace(/^0/, ''));
  }
  const digits = s.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? '+' + digits : null;
}
export const maskPhone = (p) => (p ? p.slice(0, 4) + ' ' + '•'.repeat(Math.max(2, p.length - 8)) + ' ' + p.slice(-2) : '');

function compose(title, body, link) {
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  const text = `${title}${body ? ' — ' + body : ''}${link && base ? ` ${base}${link}` : ''}`.replace(/\s+/g, ' ').trim();
  return text.length > SMS_MAX_LEN ? text.slice(0, SMS_MAX_LEN - 1) + '…' : text;
}

const startOfDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

/**
 * Met en file les messages SMS/WhatsApp des utilisateurs qui ont donné leur accord,
 * pour les événements activés par l'administrateur. Ne lève jamais d'erreur.
 */
export function queueExternal(userIds, type, title, body = null, link = null) {
  try {
    if (!userIds.length || !enabledEvents().includes(type)) return 0;
    const prov = providerInfo();
    const cap = parseInt(getSetting('sms_daily_cap', '500'));
    let usedToday = db.prepare("SELECT COUNT(*) n FROM outbox WHERE created_at >= ? AND status IN ('queued','sent','simulated')").get(startOfDay()).n;
    const text = compose(title, body, link);
    const ins = db.prepare('INSERT INTO outbox(user_id, channel, to_addr, event_type, body, status, error) VALUES(?,?,?,?,?,?,?)');
    let queued = 0;
    for (let i = 0; i < userIds.length; i += 500) {
      const chunk = userIds.slice(i, i + 500);
      const rows = db.prepare(
        `SELECT id, phone, sms_optin, whatsapp_optin FROM users WHERE status = 'active' AND phone IS NOT NULL AND (sms_optin = 1 OR whatsapp_optin = 1)
         AND id IN (${chunk.map(() => '?').join(',')})`).all(...chunk);
      for (const u of rows) {
        const channel = u.whatsapp_optin && prov.channels.whatsapp ? 'whatsapp' : u.sms_optin && prov.channels.sms ? 'sms' : null;
        const to = normalizePhone(u.phone);
        if (!channel || !to) continue;
        if (usedToday >= cap) { ins.run(u.id, channel, to, type, text, 'skipped', 'Plafond journalier atteint'); continue; }
        ins.run(u.id, channel, to, type, text, 'queued', null);
        usedToday++; queued++;
      }
    }
    return queued;
  } catch (e) {
    console.error('Passerelle SMS :', e.message);
    return 0;
  }
}

/* ---------- Envoi effectif ---------- */
async function twilioSend({ channel, to, body }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const from = channel === 'whatsapp' ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_SMS_FROM;
  if (!sid || !process.env.TWILIO_AUTH_TOKEN || !from) throw new Error('Configuration Twilio incomplète');
  const wa = (n) => (channel === 'whatsapp' ? `whatsapp:${n}` : n);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: wa(from), To: wa(to), Body: body }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Twilio HTTP ${res.status}`);
  return data.sid || null;
}

async function webhookSend({ channel, to, body, id }) {
  const res = await fetch(process.env.SMS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.SMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` } : {}) },
    body: JSON.stringify({ id, channel, to, body }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return data.id ? String(data.id) : null;
}

async function dispatch(msg) {
  const name = providerName();
  if (name === 'twilio') return { status: 'sent', provider_id: await twilioSend(msg) };
  if (name === 'webhook') return { status: 'sent', provider_id: await webhookSend(msg) };
  console.log(`[${msg.channel}] → ${msg.to} : ${msg.body}`); // mode simulation
  return { status: 'simulated', provider_id: null };
}

let running = false;

/** Traite les messages en attente. ignoreSchedule : ignore les délais de nouvelle tentative (tests / envoi manuel). */
export async function processOutbox({ limit = 25, ignoreSchedule = false } = {}) {
  if (running) return { processed: 0 };
  running = true;
  let processed = 0;
  try {
    const now = new Date().toISOString();
    const rows = db.prepare(
      `SELECT * FROM outbox WHERE status = 'queued' ${ignoreSchedule ? '' : 'AND (next_attempt_at IS NULL OR next_attempt_at <= ?)'} ORDER BY id LIMIT ?`
    ).all(...(ignoreSchedule ? [] : [now]), limit);
    for (const m of rows) {
      const attempts = m.attempts + 1;
      try {
        const out = await dispatch({ id: m.id, channel: m.channel, to: m.to_addr, body: m.body });
        db.prepare('UPDATE outbox SET status = ?, attempts = ?, sent_at = ?, provider_id = ?, error = NULL WHERE id = ?').run(out.status, attempts, new Date().toISOString(), out.provider_id, m.id);
      } catch (e) {
        const final = attempts >= MAX_ATTEMPTS;
        db.prepare('UPDATE outbox SET status = ?, attempts = ?, error = ?, next_attempt_at = ? WHERE id = ?').run(
          final ? 'failed' : 'queued', attempts, String(e.message).slice(0, 200), final ? null : new Date(Date.now() + 2 ** attempts * 60000).toISOString(), m.id);
      }
      processed++;
    }
  } finally { running = false; }
  return { processed };
}

/** Message de test envoyé directement (sans consentement requis : c'est l'administrateur lui-même). */
export async function sendTest(user, channel, text) {
  const to = normalizePhone(user.phone);
  if (!to) throw new Error("Votre profil n'a pas de numéro de téléphone valide");
  const prov = providerInfo();
  if (!prov.channels[channel]) throw new Error(`Canal « ${channel} » non configuré`);
  const body = compose(text || "Test de la passerelle de notifications — Jeunesse d'EDJAMBO", null, null);
  const info = db.prepare("INSERT INTO outbox(user_id, channel, to_addr, event_type, body, status) VALUES(?,?,?,?,?, 'queued')").run(user.id, channel, to, 'test', body);
  await processOutbox({ ignoreSchedule: true, limit: 1000 });
  return db.prepare('SELECT status, error FROM outbox WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function gatewayStats() {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const by = db.prepare('SELECT status, channel, COUNT(*) n FROM outbox WHERE created_at >= ? GROUP BY status, channel').all(monthStart);
  const count = (st) => by.filter((x) => x.status === st).reduce((s, x) => s + x.n, 0);
  const unit = parseInt(getSetting('sms_unit_cost', '25'));
  return {
    month: { queued: count('queued'), sent: count('sent'), simulated: count('simulated'), failed: count('failed'), skipped: count('skipped') },
    by_channel: { sms: by.filter((x) => x.channel === 'sms' && ['sent', 'simulated'].includes(x.status)).reduce((s, x) => s + x.n, 0), whatsapp: by.filter((x) => x.channel === 'whatsapp' && ['sent', 'simulated'].includes(x.status)).reduce((s, x) => s + x.n, 0) },
    estimated_cost: count('sent') * unit,
    unit_cost: unit,
    optin: {
      sms: db.prepare("SELECT COUNT(*) n FROM users WHERE status='active' AND sms_optin = 1 AND phone IS NOT NULL").get().n,
      whatsapp: db.prepare("SELECT COUNT(*) n FROM users WHERE status='active' AND whatsapp_optin = 1 AND phone IS NOT NULL").get().n,
      members: db.prepare("SELECT COUNT(*) n FROM users WHERE status='active' AND role='member'").get().n,
    },
  };
}

/** Démarre le traitement périodique de la file (toutes les 15 s). */
export function startOutboxWorker() {
  setInterval(() => processOutbox().catch((e) => console.error('File SMS :', e.message)), 15000).unref();
}
