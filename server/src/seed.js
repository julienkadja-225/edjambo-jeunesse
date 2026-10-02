// Données de test : node src/seed.js  (réinitialise la base)
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import db, { DB_PATH, setSetting, tx } from './db.js';
import { currentMonth, sha256 } from './utils.js';

const MEMBER_COUNT = parseInt(process.env.SEED_MEMBERS || '2000');
const ADMIN_PASSWORD = 'Admin@2026';
const MEMBER_PASSWORD = 'Jeunesse2026!';

for (const t of ['message_reports','messages','conversation_members','conversations','blocks','password_resets','audit_logs','notifications','ballots','voters','candidates','elections','proposal_votes','reactions','posts','threads','forum_categories','rsvps','reshares','announcements','contributions','payment_methods','refresh_tokens','users','settings'])
  db.exec(`DELETE FROM ${t}`);
db.exec("DELETE FROM sqlite_sequence");

// PRNG déterministe pour des jeux de données reproductibles
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const firsts = ['Kouassi','Yao','Koffi','Kouadio','Konan','Aya','Adjoua','Amenan','Awa','Fatou','Mariam','Aminata','Ibrahim','Moussa','Seydou','Jean','Marc','Paul','Grace','Esther','Ruth','Samuel','David','Joël','Christian','Fabrice','Nadège','Prisca','Larissa','Cédric','Eric','Hervé','Mireille','Sandrine','Yves','Brice','Armel','Judith','Emmanuel','Bintou'];
const lasts = ['Kouassi','Yao','Koffi','Traoré','Koné','Ouattara','Bamba','Diallo','N\'Guessan','Konan','Brou','Kouamé','Touré','Soro','Coulibaly','Aka','Gnagne','Tano','Dosso','Zadi','Assi','Ehui','Loukou','Fofana','Camara','Sidibé'];
const hoods = ['Centre-ville','Quartier Commerce','Résidentiel','Zone Industrielle','Dougba','Kennedy','Abattoir','Marché','Plateau','Cité Verte','Lycée','Gare'];

const hash = (p) => bcrypt.hashSync(p, 10);
const adminHash = hash(ADMIN_PASSWORD);
const memberHash = hash(MEMBER_PASSWORD); // même hash réutilisé : seed rapide

const insUser = db.prepare(
  `INSERT INTO users(role, permissions, first_name, last_name, email, phone, password_hash, age, neighborhood, status, created_at, approved_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

const ALL = ['members','payments','forum','announcements','elections'];
const admins = [
  ['super_admin', ALL, 'Super', 'Admin', 'superadmin@edjambo.org', '+22501000000'],
  ['admin', ALL, 'Aïcha', 'Koné', 'aicha@edjambo.org', '+22501000001'],
  ['admin', ['members','payments'], 'Serge', 'Yao', 'serge@edjambo.org', '+22501000002'],
  ['admin', ['payments'], 'Nadia', 'Traoré', 'nadia@edjambo.org', '+22501000003'],
  ['admin', ['forum','announcements'], 'Boris', 'Aka', 'boris@edjambo.org', '+22501000004'],
  ['admin', ['elections','announcements'], 'Léa', 'Diallo', 'lea@edjambo.org', '+22501000005'],
];

tx(() => {
  for (const [role, perms, f, l, email, phone] of admins)
    insUser.run(role, JSON.stringify(role === 'super_admin' ? [] : perms), f, l, email, phone, adminHash, 28, 'Bureau', 'active', daysAgo(400), daysAgo(400));

  const memberIds = [];
  for (let i = 1; i <= MEMBER_COUNT; i++) {
    const roll = rnd();
    const status = roll < 0.82 ? 'active' : roll < 0.9 ? 'pending' : roll < 0.95 ? 'suspended' : 'inactive';
    const created = daysAgo(Math.floor(rnd() * 360) + 1);
    const r = insUser.run(
      'member', '[]', pick(firsts), pick(lasts), `membre${i}@edjambo.org`, `+2250700${String(100000 + i).slice(-6)}`,
      memberHash, 16 + Math.floor(rnd() * 20), pick(hoods), status, created, status === 'pending' ? null : created
    );
    memberIds.push([Number(r.lastInsertRowid), status]);
  }
  // Comptes de démonstration faciles à retenir
  db.prepare("UPDATE users SET first_name='Aya', last_name='Konan', status='active', neighborhood='Centre-ville' WHERE email='membre1@edjambo.org'").run();
  db.prepare("UPDATE users SET first_name='Moussa', last_name='Bamba', status='pending', approved_at=NULL WHERE email='membre2@edjambo.org'").run();

  // Moyens de paiement
  const pm = db.prepare('INSERT INTO payment_methods(type,label,account_number,account_name,details) VALUES(?,?,?,?,?)');
  pm.run('mobile_money', 'Orange Money', '07 00 00 00 01', 'Jeunesse EDJAMBO', 'Indiquez votre nom en référence');
  pm.run('mobile_money', 'MTN Money', '05 00 00 00 02', 'Jeunesse EDJAMBO', null);
  pm.run('bank', 'Virement bancaire', 'CI00 0000 0000 0000 0000 0000', 'Association Jeunesse EDJAMBO', 'Banque : Banque Populaire — Agence EDJAMBO');
  setSetting('monthly_amount', 1000); setSetting('currency', 'FCFA'); setSetting('grace_days', 10); setSetting('reminder_day', 5);

  // Cotisations : mois courant et 3 mois précédents
  const insC = db.prepare("INSERT INTO contributions(user_id, month, amount, method_id, method_label, reference, status, reviewed_by, reviewed_at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
  const labels = ['Orange Money', 'MTN Money', 'Virement bancaire'];
  const months = [0, 1, 2, 3].map((k) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k); return currentMonth(d); });
  let ref = 100000;
  for (const [id, status] of memberIds) {
    if (status !== 'active') continue;
    const reliability = rnd();
    months.forEach((m, k) => {
      const p = k === 0 ? 0.6 * reliability + 0.15 : reliability;
      if (rnd() > p) return;
      const mi = Math.floor(rnd() * 3);
      const cs = k === 0 && rnd() < 0.15 ? 'pending' : 'approved';
      const when = `${m}-${String(2 + Math.floor(rnd() * 20)).padStart(2, '0')}T10:00:00Z`;
      insC.run(id, m, 1000, mi + 1, labels[mi], `TX${ref++}`, cs, cs === 'approved' ? 1 : null, cs === 'approved' ? when : null, when);
    });
  }
  // Comptes démo : membre1 à jour (paiement approuvé), membre3 avec preuve en attente, membre4 en retard
  db.prepare("DELETE FROM contributions WHERE user_id IN (SELECT id FROM users WHERE email IN ('membre1@edjambo.org','membre3@edjambo.org','membre4@edjambo.org')) AND month = ?").run(months[0]);
  db.prepare("UPDATE users SET status='active' WHERE email IN ('membre3@edjambo.org','membre4@edjambo.org')").run();
  const u = (e) => db.prepare('SELECT id FROM users WHERE email = ?').get(e).id;
  insC.run(u('membre1@edjambo.org'), months[0], 1000, 1, 'Orange Money', 'TX-DEMO-1', 'approved', 1, daysAgo(1), daysAgo(2));
  insC.run(u('membre3@edjambo.org'), months[0], 1000, 2, 'MTN Money', 'TX-DEMO-3', 'pending', null, null, daysAgo(1));

  // Forum
  const cat = db.prepare('INSERT INTO forum_categories(name, description) VALUES(?,?)');
  cat.run('Général', 'Discussions libres entre jeunes'); cat.run('Emploi & Formation', 'Opportunités, stages, formations');
  cat.run('Sport & Culture', 'Tournois, concerts, talents'); cat.run('Vie de la cité', 'Environnement, salubrité, sécurité');
  const actives = memberIds.filter(([, s]) => s === 'active').map(([id]) => id);
  const thr = db.prepare('INSERT INTO threads(category_id, author_id, type, title, body, pinned, created_at) VALUES(?,?,?,?,?,?,?)');
  const post = db.prepare('INSERT INTO posts(thread_id, author_id, body, created_at) VALUES(?,?,?,?)');
  const pvote = db.prepare('INSERT OR IGNORE INTO proposal_votes(thread_id, user_id, value) VALUES(?,?,?)');
  const welcome = Number(thr.run(1, 1, 'discussion', 'Bienvenue sur la plateforme de la Jeunesse d\'EDJAMBO !', 'Présentez-vous, partagez vos idées et respectez les règles de courtoisie.', 1, daysAgo(30)).lastInsertRowid);
  for (let i = 0; i < 12; i++) post.run(welcome, pick(actives), pick(['Merci pour cette initiative !', 'Content de rejoindre la communauté ', 'Super idée, on est ensemble.', 'Présent !']), daysAgo(29 - i));
  const topics = [
    [2, 'Offres de stage pour les jeunes diplômés', 'Partagez ici les offres de stage et d\'emploi dont vous avez connaissance.'],
    [3, 'Tournoi de football inter-quartiers', 'Qui est partant pour organiser le tournoi pendant les vacances ?'],
    [4, 'Opération de nettoyage du marché', 'Proposons une journée de salubrité chaque premier samedi du mois.'],
    [1, 'Comment améliorer la participation aux réunions ?', 'Les réunions mensuelles attirent peu de monde. Vos idées ?'],
  ];
  for (const [c, t, b] of topics) {
    const id = Number(thr.run(c, pick(actives), 'discussion', t, b, 0, daysAgo(Math.floor(rnd() * 20))).lastInsertRowid);
    for (let i = 0; i < 3 + Math.floor(rnd() * 6); i++) post.run(id, pick(actives), 'Je suis d\'accord, faisons-le !', daysAgo(Math.floor(rnd() * 10)));
  }
  const props = [
    ['Créer un centre informatique pour les jeunes', 'Un espace équipé de 10 ordinateurs avec connexion internet pour la formation numérique.'],
    ['Mettre en place une mutuelle de solidarité', 'Une caisse de solidarité alimentée par une petite part des cotisations pour soutenir les membres en difficulté.'],
    ['Organiser un forum annuel de l\'emploi', 'Inviter des entreprises de la région pour des entretiens et des conférences.'],
    ['Lancer un jardin communautaire', 'Cultiver des légumes sur un terrain communal pour financer nos activités.'],
  ];
  for (const [t, b] of props) {
    const id = Number(thr.run(null, pick(actives), 'proposal', t, b, 0, daysAgo(Math.floor(rnd() * 25))).lastInsertRowid);
    for (let i = 0; i < 40; i++) pvote.run(id, pick(actives), rnd() < 0.8 ? 1 : -1);
    post.run(id, pick(actives), 'Excellente proposition, je soutiens.', daysAgo(2));
  }

  // Annonces & événements
  const ann = db.prepare('INSERT INTO announcements(type, title, body, event_date, location, author_id, created_at) VALUES(?,?,?,?,?,?,?)');
  const future = (d) => new Date(Date.now() + d * 864e5).toISOString();
  ann.run('announcement', 'Lancement de la plateforme numérique de la Jeunesse', '<p>Nous sommes heureux de lancer notre plateforme : <strong>forum, votes, cotisations</strong> et annonces au même endroit.</p>', null, null, 2, daysAgo(14));
  ann.run('event', 'Assemblée générale de la Jeunesse', '<p>Présentation du bilan et du programme d\'activités. <em>Présence vivement souhaitée.</em></p><ul><li>Bilan financier</li><li>Élection du bureau</li></ul>', future(10), 'Salle des fêtes d\'EDJAMBO', 2, daysAgo(5));
  ann.run('event', 'Journée de salubrité du marché', '<p>Venez avec gants et sacs. Un rafraîchissement sera offert.</p>', future(21), 'Marché central', 2, daysAgo(3));
  ann.run('announcement', 'Rappel : cotisations mensuelles', '<p>Pensez à régler votre cotisation avant le 10 de chaque mois via Orange Money, MTN Money ou virement, puis déposez votre preuve sur la plateforme.</p>', null, null, 2, daysAgo(1));
  for (let a = 1; a <= 4; a++) for (let i = 0; i < 30; i++) db.prepare('INSERT OR IGNORE INTO rsvps(announcement_id, user_id) VALUES(?,?)').run(a, pick(actives));

  // Élections : une ouverte, une publiée, un brouillon
  const el = db.prepare('INSERT INTO elections(title, description, start_at, end_at, require_contribution, status, created_by) VALUES(?,?,?,?,?,?,?)');
  const cd = db.prepare('INSERT INTO candidates(election_id, user_id, name, program) VALUES(?,?,?,?)');
  const e1 = Number(el.run('Président de la Jeunesse', 'Élection du président du bureau pour le mandat 2026-2028.', daysAgo(1), future(6), 1, 'open', 1).lastInsertRowid);
  [['Serge Aka', 'Priorité à l\'emploi et à la formation numérique.'], ['Mariam Touré', 'Plus de transparence et d\'activités culturelles.'], ['Yves Gnagne', 'Sport, solidarité et unité des quartiers.']].forEach(([n, p], i) => cd.run(e1, actives[i], n, p));
  const e2 = Number(el.run('Secrétaire général', 'Élection du secrétaire général.', daysAgo(40), daysAgo(33), 0, 'published', 1).lastInsertRowid);
  const c2 = [['Fatou Bamba', 'Archives et communication.'], ['Brice Koné', 'Digitalisation des procès-verbaux.']].map(([n, p], i) => Number(cd.run(e2, actives[10 + i], n, p).lastInsertRowid));
  const e3 = Number(el.run('Trésorier', 'Élection du trésorier (brouillon).', future(15), future(22), 1, 'draft', 1).lastInsertRowid);
  cd.run(e3, null, 'Candidat A', null); cd.run(e3, null, 'Candidat B', null);
  // Bulletins de l'élection publiée (chaîne de hachage)
  let prev = 'GENESIS';
  const insB = db.prepare('INSERT INTO ballots(election_id, candidate_id, receipt_hash, prev_hash, hash, created_at) VALUES(?,?,?,?,?,?)');
  const insV = db.prepare('INSERT INTO voters(election_id, user_id, voted_at) VALUES(?,?,?)');
  actives.slice(100, 400).forEach((uid, i) => {
    const cid = rnd() < 0.55 ? c2[0] : c2[1];
    const ts = new Date(Date.now() - 36 * 864e5 + i * 1000).toISOString();
    const rh = sha256('seed-receipt-' + i);
    const h = sha256([prev, e2, cid, rh, ts].join('|'));
    insV.run(e2, uid, ts); insB.run(e2, cid, rh, prev, h, ts); prev = h;
  });
  // Quelques votes sur l'élection ouverte (hors comptes démo) — mêmes règles de chaînage
  prev = 'GENESIS';
  const cands1 = db.prepare('SELECT id FROM candidates WHERE election_id = ?').all(e1).map((c) => c.id);
  actives.slice(600, 700).forEach((uid, i) => {
    const cid = pick(cands1);
    const ts = new Date(Date.now() - 20 * 3600e3 + i * 1000).toISOString();
    const rh = sha256('seed-open-' + i);
    const h = sha256([prev, e1, cid, rh, ts].join('|'));
    insV.run(e1, uid, ts); insB.run(e1, cid, rh, prev, h, ts); prev = h;
  });
  // Rendre éligibles quelques votants de l'élection ouverte : cotisation du mois approuvée
  db.prepare("INSERT INTO notifications(user_id, type, title, body, link) SELECT id, 'announcement', 'Bienvenue sur la plateforme', 'Découvrez le forum, les votes et vos cotisations.', '/' FROM users WHERE email IN ('membre1@edjambo.org','membre3@edjambo.org','membre4@edjambo.org')").run();
});


// ---- Messagerie de démonstration (membre1 = Aya) ----
tx(() => {
  const uid = (n) => db.prepare('SELECT id FROM users WHERE email = ?').get(`membre${n}@edjambo.org`).id;
  const [aya, m3, m4, m5, m6, m7] = [1, 3, 4, 5, 6, 7].map(uid);
  db.prepare("UPDATE users SET status='active' WHERE id IN (?,?,?,?)").run(m5, m6, m7, m3);
  const now = Date.now();
  const ts = (min) => new Date(now - min * 60000).toISOString();
  const conv = db.prepare("INSERT INTO conversations(type, title, description, direct_key, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?)");
  const mem = db.prepare("INSERT INTO conversation_members(conversation_id, user_id, role, status, invited_by, invited_at, joined_at, last_read_id) VALUES(?,?,?,?,?,?,?,?)");
  const msg = db.prepare("INSERT INTO messages(conversation_id, sender_id, kind, body, created_at) VALUES(?,?,?,?,?)");
  const read = (c, u) => db.prepare('UPDATE conversation_members SET last_read_id = (SELECT MAX(id) FROM messages WHERE conversation_id = ?) WHERE conversation_id = ? AND user_id = ?').run(c, c, u);

  // 1. Groupe actif : Aya (créatrice) + membres 5, 6, 7 ; membre4 invité (en attente)
  const g = Number(conv.run('group', 'Organisation du tournoi', 'Tournoi inter-quartiers de fin d\'année', null, aya, ts(3000), ts(20)).lastInsertRowid);
  mem.run(g, aya, 'owner', 'active', null, null, ts(3000), 0);
  for (const u of [m5, m6, m7]) mem.run(g, u, u === m5 ? 'admin' : 'member', 'active', aya, ts(2990), ts(2980), 0);
  mem.run(g, m4, 'member', 'invited', aya, ts(30), null, 0);
  msg.run(g, aya, 'system', 'Aya Konan a créé le groupe « Organisation du tournoi »', ts(3000));
  msg.run(g, aya, 'text', 'Bonjour à tous ! On se coordonne ici pour le tournoi.', ts(2900));
  msg.run(g, m5, 'text', "Super idée. Je m'occupe de la liste des équipes.", ts(2800));
  msg.run(g, m6, 'text', 'Je peux gérer le matériel et le terrain.', ts(600));
  msg.run(g, m7, 'text', 'Quelle date on vise ?', ts(20));
  for (const u of [aya, m5, m6]) read(g, u);

  // 2. Discussion privée active Aya ↔ membre5
  const d = Number(conv.run('direct', null, null, `${Math.min(aya, m5)}:${Math.max(aya, m5)}`, m5, ts(500), ts(5)).lastInsertRowid);
  mem.run(d, m5, 'member', 'active', null, null, ts(500), 0);
  mem.run(d, aya, 'member', 'active', m5, ts(500), ts(480), 0);
  msg.run(d, m5, 'text', "Salut Aya, tu as vu les nouvelles propositions sur le forum ?", ts(500));
  msg.run(d, aya, 'text', "Oui ! Celle du centre informatique est excellente.", ts(480));
  msg.run(d, m5, 'text', 'On en reparle à la prochaine réunion ?', ts(5));
  read(d, m5);

  // 3. Demande de discussion en attente pour Aya (membre3 → Aya)
  const q = Number(conv.run('direct', null, null, `${Math.min(aya, m3)}:${Math.max(aya, m3)}`, m3, ts(60), ts(60)).lastInsertRowid);
  mem.run(q, m3, 'member', 'active', null, null, ts(60), 0);
  mem.run(q, aya, 'member', 'invited', m3, ts(60), null, 0);
  msg.run(q, m3, 'text', "Bonjour Aya, je voudrais te parler de l'organisation de la journée de salubrité.", ts(60));
  read(q, m3);

  // 4. Invitation de groupe en attente pour Aya (créé par membre4)
  const g2 = Number(conv.run('group', 'Comité Culture', 'Concerts, théâtre et talents de la jeunesse', null, m4, ts(120), ts(120)).lastInsertRowid);
  mem.run(g2, m4, 'owner', 'active', null, null, ts(120), 0);
  mem.run(g2, m6, 'member', 'active', m4, ts(119), ts(100), 0);
  mem.run(g2, aya, 'member', 'invited', m4, ts(120), null, 0);
  msg.run(g2, m4, 'system', 'Membre4 a créé le groupe « Comité Culture »', ts(120));
});

console.log(`Base initialisée : ${DB_PATH}`);
console.log(`  Super Admin : superadmin@edjambo.org / ${ADMIN_PASSWORD}`);
console.log(`  Admins      : aicha@, serge@, nadia@, boris@, lea@edjambo.org / ${ADMIN_PASSWORD}`);
console.log(`  Membres     : membre1@edjambo.org … membre${MEMBER_COUNT}@edjambo.org / ${MEMBER_PASSWORD}`);
console.log('  membre1 = à jour · membre2 = en attente · membre3 = preuve en attente · membre4 = en retard');
