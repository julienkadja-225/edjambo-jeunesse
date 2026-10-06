// Création du premier Super Admin (déploiement) :
//   npm run create-admin -- --email prenom.nom@exemple.org --first Prénom --last Nom [--phone 0700000000] [--password ...]
// Sans --password, un mot de passe temporaire robuste est généré et affiché UNE seule fois (à changer à la première connexion).
import bcrypt from 'bcryptjs';
import db from './db.js';
import { normalizePhone } from './gateway.js';
import { audit, tempPassword, validatePassword } from './utils.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), [])
);

function fail(msg) {
  console.error(`Erreur : ${msg}`);
  process.exit(1);
}

const email = (args.email || '').trim().toLowerCase();
const phone = args.phone ? normalizePhone(args.phone) : null;
const first = (args.first || '').trim();
const last = (args.last || '').trim();
if (!first || !last) fail('--first et --last sont requis (prénom et nom).');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('--email valide requis (il servira d\'identifiant et à récupérer le mot de passe).');
if (args.phone && !phone) fail('numéro de téléphone invalide.');

const existing = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'super_admin'").get().n;
if (existing && args.force !== 'true') fail('un Super Admin existe déjà. Ajoutez --force pour en créer un autre.');
if (db.prepare('SELECT 1 FROM users WHERE email = ? OR (phone IS NOT NULL AND phone = ?)').get(email, phone)) fail('cet email ou ce téléphone est déjà utilisé.');

const generated = !args.password;
const password = args.password || tempPassword();
if (!generated) { try { validatePassword(password); } catch (e) { fail(e.message); } }

const info = db
  .prepare(
    `INSERT INTO users(role, permissions, first_name, last_name, email, phone, password_hash, neighborhood, status, approved_at, consent_at, must_change_password)
     VALUES('super_admin', '[]', ?, ?, ?, ?, ?, 'Bureau', 'active', ?, ?, 1)`
  )
  .run(first, last, email, phone, bcrypt.hashSync(password, 10), new Date().toISOString(), new Date().toISOString());
audit(Number(info.lastInsertRowid), 'admin.create', 'user', Number(info.lastInsertRowid), 'Premier Super Admin créé en ligne de commande');

console.log('Super Admin créé.');
console.log(`  Identifiant : ${email}`);
if (generated) console.log(`  Mot de passe temporaire : ${password}   (noté nulle part ailleurs : conservez-le maintenant)`);
console.log('  Le changement du mot de passe sera demandé à la première connexion.');
