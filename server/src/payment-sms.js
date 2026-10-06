// Lecture et contrôle de cohérence des SMS de confirmation Mobile Money (Orange, MTN, Moov, Wave).
// Attention : on contrôle la COHÉRENCE du message avec la cotisation attendue, pas son authenticité
// (un texte peut être falsifié). La vérification finale reste celle de l'administrateur.

const NBSP = /[  ]/g;

const OPERATORS = [
  [/orange\s*money|\borange\b/i, 'Orange Money'],
  [/\bmtn\b|momo|mobile\s*money\s*mtn/i, 'MTN Money'],
  [/moov/i, 'Moov Money'],
  [/\bwave\b/i, 'Wave'],
];

function toAmount(raw) {
  let s = raw.replace(NBSP, ' ').replace(/\s/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, ''); // 1.000 / 1,000 / 10.000
  else s = s.replace(/[.,]\d{1,2}$/, ''); // centimes éventuels
  const n = parseInt(s.replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 && n < 100_000_000 ? n : null;
}

/** Extrait montant, référence, date, numéros et opérateur d'un SMS de confirmation. */
export function parsePaymentSms(text) {
  const t = String(text || '').replace(NBSP, ' ').replace(/\s+/g, ' ').trim();
  const out = { operator: null, amount: null, reference: null, date: null, numbers: [], recipient_name: null };
  if (!t) return out;

  for (const [re, name] of OPERATORS) if (re.test(t)) { out.operator = name; break; }

  // Montant : on ignore ceux précédés de « solde », « frais », « commission »…
  const amountRe = /(\d[\d .,]*)\s*(?:FCFA|F\s?CFA|XOF|CFA|F)\b/gi;
  for (const m of t.matchAll(amountRe)) {
    const before = t.slice(Math.max(0, m.index - 28), m.index).toLowerCase();
    if (/solde|frais|fees?|balance|commission|bonus/.test(before)) continue;
    const n = toAmount(m[1]);
    if (n) { out.amount = n; break; }
  }

  // Référence / identifiant de transaction (doit contenir au moins un chiffre)
  const refRe = /(?:id\s*(?:de\s*(?:la\s*)?)?transaction|transaction\s*id|trans\.?\s*id|txn\s*id|r[ée]f(?:[ée]rence)?\.?|\bid)\s*[:#.\-]?\s*([A-Z0-9][A-Za-z0-9._\-]{5,39})/gi;
  for (const m of t.matchAll(refRe)) {
    if (/\d/.test(m[1])) { out.reference = m[1].replace(/[.,;]+$/, ''); break; }
  }

  // Date jj/mm/aaaa
  const d = t.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (d) {
    const y = d[3].length === 2 ? 2000 + parseInt(d[3], 10) : parseInt(d[3], 10);
    const iso = `${y}-${String(d[2]).padStart(2, '0')}-${String(d[1]).padStart(2, '0')}`;
    if (!isNaN(new Date(iso))) out.date = iso;
  }

  // Numéros de téléphone (8 à 13 chiffres), hors référence
  const refDigits = (out.reference || '').replace(/\D/g, '');
  for (const m of t.matchAll(/\+?\d[\d ]{6,16}\d/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 13) continue;
    if (refDigits && digits === refDigits) continue;
    if (/^\d{2}[/\-.]/.test(m[0])) continue;
    out.numbers.push(digits);
  }

  const nm = t.match(/(?:\bà|\ba|\bvers|\bto)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'’. -]{2,40}?)(?=\s*[(\d]|\s+le\s|\s+au\s|\.|,)/);
  if (nm) out.recipient_name = nm[1].trim();
  return out;
}

const last8 = (s) => String(s || '').replace(/\D/g, '').slice(-8);

/**
 * Compare le SMS aux comptes de paiement configurés et à la cotisation attendue.
 * ctx : { methods, expectedAmount, isDuplicate(ref) }
 */
export function analyzePaymentSms(text, ctx) {
  const p = parsePaymentSms(text);
  const flags = [];
  const info = [];
  if (!String(text || '').trim()) return { parsed: p, flags: [], info: [], level: 'none', matched_method_id: null };

  if (!p.amount) flags.push('no_amount');
  if (!p.reference) flags.push('no_reference');

  // Compte destinataire : un des numéros du SMS doit correspondre à un compte Mobile Money configuré
  const mobile = ctx.methods.filter((m) => m.type === 'mobile_money');
  let matched = null;
  if (mobile.length) {
    for (const n of p.numbers) {
      matched = mobile.find((m) => last8(m.account_number) === last8(n)) || null;
      if (matched) break;
    }
    if (!matched) flags.push('recipient_mismatch');
  }

  if (p.amount && ctx.expectedAmount && p.amount < ctx.expectedAmount) flags.push('amount_low');
  if (p.amount && ctx.expectedAmount && p.amount > ctx.expectedAmount) info.push('amount_high');

  if (p.reference && ctx.isDuplicate?.(p.reference)) flags.push('duplicate_reference');

  if (p.date) {
    const age = (Date.now() - new Date(p.date + 'T12:00:00Z')) / 864e5;
    if (age > 45) flags.push('old_date');
    if (age < -1) flags.push('future_date');
  } else info.push('no_date');

  const level = flags.length === 0 ? 'consistent' : 'review';
  return { parsed: p, flags, info, level, matched_method_id: matched?.id ?? null };
}

export const FLAG_LABELS = {
  no_amount: 'Montant introuvable dans le SMS',
  no_reference: 'Référence de transaction introuvable',
  recipient_mismatch: "Le numéro destinataire ne correspond à aucun compte de l'association",
  amount_low: 'Montant inférieur à la cotisation attendue',
  duplicate_reference: 'Référence déjà utilisée pour un autre paiement',
  old_date: 'Date du SMS trop ancienne (plus de 45 jours)',
  future_date: 'Date du SMS dans le futur',
};
