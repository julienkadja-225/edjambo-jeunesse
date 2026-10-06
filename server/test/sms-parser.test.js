import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePaymentSms, parsePaymentSms } from '../src/payment-sms.js';

const methods = [
  { id: 1, type: 'mobile_money', label: 'Orange Money', account_number: '07 00 00 00 01' },
  { id: 2, type: 'mobile_money', label: 'MTN Money', account_number: '05 00 00 00 02' },
  { id: 3, type: 'bank', label: 'Virement bancaire', account_number: 'CI00 0000' },
];
const today = () => { const d = new Date(); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
const ctx = (extra = {}) => ({ methods, expectedAmount: 1000, isDuplicate: () => false, ...extra });

test('Orange Money : montant, référence, numéro, date, solde et frais ignorés', () => {
  const sms = `Orange Money: Vous avez envoye 1 000 FCFA a 0700000001 (JEUNESSE EDJAMBO) le ${today()} a 10:15. Frais: 0 FCFA. ID de transaction: CI251002.1015.A12345. Nouveau solde: 15 200 FCFA.`;
  const p = parsePaymentSms(sms);
  assert.equal(p.operator, 'Orange Money');
  assert.equal(p.amount, 1000);
  assert.equal(p.reference, 'CI251002.1015.A12345');
  assert.ok(p.numbers.includes('0700000001'));
  const a = analyzePaymentSms(sms, ctx());
  assert.equal(a.level, 'consistent');
  assert.equal(a.matched_method_id, 1);
});

test('MTN MoMo : format différent', () => {
  const sms = `MTN MoMo: Transfert effectue. Vous avez envoye 2.000F a JEUNESSE EDJAMBO (0500000002) le ${today()}. Ref: 123456789. Solde: 3.500F`;
  const p = parsePaymentSms(sms);
  assert.equal(p.operator, 'MTN Money');
  assert.equal(p.amount, 2000);
  assert.equal(p.reference, '123456789');
  const a = analyzePaymentSms(sms, ctx());
  assert.equal(a.matched_method_id, 2);
  assert.equal(a.level, 'consistent');
  assert.ok(a.info.includes('amount_high'));
});

test('Wave et numéros internationaux', () => {
  const sms = `Wave: Vous avez envoyé 1000F à JEUNESSE (+2250700000001). ID: T_8f3a91c2d. ${today()}`;
  const a = analyzePaymentSms(sms, ctx());
  assert.equal(a.parsed.operator, 'Wave');
  assert.equal(a.parsed.amount, 1000);
  assert.equal(a.parsed.reference, 'T_8f3a91c2d');
  assert.equal(a.matched_method_id, 1);
});

test('incohérences : mauvais compte, montant insuffisant, doublon, date ancienne', () => {
  const bad = analyzePaymentSms('Vous avez envoye 500 FCFA a 0799999999 le 01/01/2020. ID de transaction: AB123456', ctx({ isDuplicate: (r) => r === 'AB123456' }));
  assert.equal(bad.level, 'review');
  for (const f of ['recipient_mismatch', 'amount_low', 'duplicate_reference', 'old_date']) assert.ok(bad.flags.includes(f), f);
});

test('texte vide ou sans information exploitable', () => {
  assert.equal(analyzePaymentSms('', ctx()).level, 'none');
  const junk = analyzePaymentSms('bonjour je paie demain', ctx());
  assert.equal(junk.level, 'review');
  assert.ok(junk.flags.includes('no_amount') && junk.flags.includes('no_reference'));
});

test('un identifiant sans chiffre n\'est pas pris pour une référence', () => {
  assert.equal(parsePaymentSms('Transaction reussie. Reference: validation').reference, null);
});
