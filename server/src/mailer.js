import nodemailer from 'nodemailer';

/** Email facultatif : actif uniquement si SMTP_HOST est défini (SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM). */
export const mailerConfigured = () => !!process.env.SMTP_HOST;

let transport;
export async function sendMail({ to, subject, text }) {
  if (!mailerConfigured()) return false;
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === '1',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transport.sendMail({ from: process.env.MAIL_FROM || "Jeunesse d'EDJAMBO <no-reply@edjambo.org>", to, subject, text });
  return true;
}
