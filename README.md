# 🔥 Jeunesse d'EDJAMBO — Plateforme de gestion

Application web (React + Node/Express + base SQL) pour gérer une communauté de 2 000+ jeunes :
inscriptions validées par l'équipe, forum & propositions, élections du bureau, annonces & événements,
cotisations mensuelles (virement / Mobile Money, sans passerelle de paiement) et notifications.

## Identité visuelle

L'emblème d'EDJAMBO (rivière, palmier, collines et toits du village, flamme de la jeunesse) est un SVG vectoriel dans `client/public/` :
`logo-mark.svg` (emblème, utilisé dans l'application et comme favicon), `logo-full.svg` (emblème + nom, pour affiches et documents) et `edjambo-paysage.jpg` (photo du village, utilisée en arrière-plan de l'accueil et de la connexion). Les couleurs de l'interface (bleu marine, bleu, rouge) en sont tirées. Pour utiliser un autre logo, remplacez simplement ces fichiers.

## Démarrage rapide

Prérequis : **Node.js 22.13+** (testé avec Node 24). Aucune base à installer : la base SQLite est intégrée à Node.

```bash
npm install            # outils racine
npm run setup          # dépendances serveur + client
npm run seed           # données de test (2 000 membres, annonces, élections…)
npm run dev            # API http://localhost:4000 + interface http://localhost:5173
```

Version « production » (un seul processus qui sert l'API **et** l'interface) :

```bash
npm run build && npm start      # http://localhost:4000
```

Tests d'intégration de l'API : `npm test`.

## Comptes de test (après `npm run seed`)

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Super Admin | `superadmin@edjambo.org` | `Admin@2026` |
| Admin (toutes permissions) | `aicha@edjambo.org` | `Admin@2026` |
| Admin membres + cotisations | `serge@edjambo.org` | `Admin@2026` |
| Admin cotisations seules | `nadia@edjambo.org` | `Admin@2026` |
| Admin forum + annonces | `boris@edjambo.org` | `Admin@2026` |
| Admin élections + annonces | `lea@edjambo.org` | `Admin@2026` |
| Membre à jour (peut voter) | `membre1@edjambo.org` | `Jeunesse2026!` |
| Membre en attente de validation | `membre2@edjambo.org` | `Jeunesse2026!` |
| Membre avec preuve en attente | `membre3@edjambo.org` | `Jeunesse2026!` |
| Membre en retard de cotisation | `membre4@edjambo.org` | `Jeunesse2026!` |

`membre5` … `membre2000` : membres générés (statuts et cotisations variés). Le téléphone fonctionne aussi comme identifiant.
⚠️ Ces comptes sont **uniquement** pour les tests : ne jamais lancer le seed en production.

## Parcours à tester

1. **Inscription** (`/inscription`) → connexion refusée (en attente) → un admin approuve dans `/admin/membres` → le membre est notifié et peut se connecter.
2. **Cotisation** : membre4 → *Mes cotisations* → copie du numéro, envoi d'une preuve (image/PDF) ou d'une référence → un admin ouvre `/admin/paiements`, examine la preuve, approuve ou rejette avec motif.
3. **Vote** : membre1 vote dans « Président de la Jeunesse » (reçu fourni) ; membre4 (non à jour) est bloqué tant que sa cotisation n'est pas validée. Un admin élections suit la participation en direct, clôture, publie, puis l'audit devient public.
4. **Annonces** : un admin forum/annonces publie avec éditeur riche + média → tous les membres sont notifiés → republication et lien de partage public `/a/<id>`.
5. **Forum / propositions** : discussions, réponses, « j'aime », vote ▲▼ sur les propositions ; épinglage / fermeture / masquage côté admin.

## Messagerie privée et de groupe

Accessible depuis « Messagerie » (menu et icône en haut à droite, avec compteur de messages non lus).

- **Discussion privée** : le premier message est une *demande* ; le destinataire l'**accepte ou la refuse** (onglet « Invitations »). Tant qu'elle n'est pas acceptée, l'expéditeur ne peut envoyer qu'un seul message. Un refus empêche de renouveler la demande.
- **Groupes** : on crée un groupe et on invite des membres ; **chaque invité doit accepter** pour rejoindre. Rôles : créateur, administrateurs du groupe (invitent, retirent, suppriment des messages) et membres. Un nouvel arrivant ne voit pas l'historique antérieur à son acceptation. Si le créateur part, la propriété est transmise.
- **Au quotidien** : messages non lus, modification (24 h) et suppression de ses messages, actualisation automatique (≈ 4 s), historique chargé par pages.
- **Protection** : blocage d'un membre, signalement d'un message, limite de 20 messages / 30 s, 200 membres max par groupe, pas de ré-invitation d'une personne qui vient de refuser (7 jours).
- **Vie privée** : l'équipe d'administration ne peut pas lire les conversations. Seul un message **signalé** (et les deux précédents) est transmis à la modération, dans « Messages signalés » (`/admin/signalements`, permission forum) : supprimer le message, suspendre l'auteur ou classer sans suite.
- Comptes de démo : connectez-vous avec `membre1@edjambo.org` (Aya) pour voir un groupe actif, une discussion, une demande et une invitation en attente.

## Gestion des comptes et mots de passe

- **Mot de passe oublié** (`/mot-de-passe-oublie`) : lien à usage unique valable 1 h, envoyé par email si un serveur SMTP est configuré. En développement (sans SMTP), le lien s'affiche sur la page et dans la console du serveur.
- **Sans email (téléphone seul)** : un admin « membres » clique sur *Mot de passe* dans `/admin/membres` → un mot de passe temporaire est généré et affiché une seule fois ; le membre doit en choisir un nouveau dès sa connexion.
- **Verrouillage** : 5 échecs de connexion → compte bloqué 15 min ; un admin peut le déverrouiller. Les tentatives restantes sont annoncées.
- **Règle de mot de passe** : 8 caractères min., lettres et chiffres ; jauge de robustesse et bouton « afficher » dans les formulaires.
- **Sessions** : un changement ou une réinitialisation de mot de passe ferme les autres appareils.
- **Journal d'activité** (`/admin/journal`, Super Admin) : validations de comptes, réinitialisations, paiements, élections, publications, gestion de l'équipe.

## Outils pour le bureau

- **Export CSV** (membres et cotisations) : boutons « Exporter en CSV » dans `/admin/membres` et `/admin/paiements`. Les filtres en cours sont appliqués ; le fichier s'ouvre directement dans Excel (UTF-8, séparateur « ; ») et les cellules sont protégées contre l'injection de formules.
- **Validation en masse** : cases à cocher sur les inscriptions en attente → « Approuver la sélection » (jusqu'à 500 à la fois).
- **Graphique** des cotisations collectées sur 6 mois dans le tableau de bord.
- **Calendrier de cotisation** du membre (12 mois de l'année, état de chaque mois).
- **Emails transactionnels** (inscription approuvée/refusée, cotisation validée/rejetée, sécurité) envoyés automatiquement si SMTP est configuré ; sinon, notifications dans l'application uniquement.
- **Application installable** (PWA) : en production, le navigateur propose « Ajouter à l'écran d'accueil » sur smartphone ; l'interface reste ouverte hors ligne (les données exigent une connexion).

## Architecture

```
client/   React 19 + Vite + React Router (mobile-first, chargement différé par portail)
server/   Express 5 · JWT (accès 15 min + refresh 7 j avec rotation) · bcrypt · multer · helmet · rate-limit
  src/schema.sql      schéma complet (users, contributions, threads, elections, ballots…)
  src/routes/*.js     un fichier par module
  src/seed.js         données de test      src/backup.js   sauvegarde à chaud
docs/API.md           documentation de tous les endpoints
```

- **RBAC** : rôles `member` / `admin` / `super_admin` + permissions fines par admin (`members`, `payments`, `forum`, `announcements`, `elections`), appliquées côté API (middleware) **et** côté interface (menus et routes `/admin`).
- **Portail** : membres sur `/accueil`, admin sur `/admin`.
- **Vote** : un membre = une voix (clé primaire `voters`), bulletins anonymes chaînés par hachage SHA-256, reçu individuel de vérification, audit public après publication.
- **Éligibilité** : membre actif avec cotisation approuvée pour le mois en cours (délai de grâce configurable, 10 jours par défaut, pendant lequel le mois précédent reste valable).
- **Fichiers** : JPG/PNG/PDF ≤ 5 Mo, signature binaire vérifiée ; preuves de paiement servies uniquement à leur auteur et aux admins `payments`.
- **Rappels** : tâche automatique (toutes les 6 h, à partir du jour configuré du mois) + bouton manuel. Notifications in-app ; email/SMS = extension possible dans `notify()` (`server/src/utils.js`).
- **Performance** : pagination serveur partout, index sur statuts/mois/quartiers, listes chargées page par page (annuaire, forum, cotisations).

## Configuration (`server/.env`, facultatif)

```
PORT=4000
APP_URL=https://mon-domaine.org         # base des liens envoyés par email
SMTP_HOST=smtp.exemple.com  SMTP_PORT=587  SMTP_USER=…  SMTP_PASS=…  MAIL_FROM="Jeunesse d'EDJAMBO <no-reply@mon-domaine.org>"
JWT_SECRET=<longue-chaine-aleatoire>   # OBLIGATOIRE en production (NODE_ENV=production)
CORS_ORIGIN=https://mon-domaine.org     # séparés par des virgules
DB_PATH=./data/edjambo.db
UPLOAD_DIR=./uploads
BACKUP_DIR=./backups   BACKUP_KEEP=14   AUTO_BACKUP=1
```

## Sauvegarde des données

- Automatique : une copie cohérente de la base toutes les 24 h dans `server/backups/` (14 conservées).
- Manuelle : `npm run backup` ou bouton « Sauvegarder la base » (Super Admin).
- À faire en plus en production : copier `server/backups/` **et** `server/uploads/` vers un stockage externe (disque distant, cloud) ; tester régulièrement la restauration (remplacer `edjambo.db` par une sauvegarde, serveur arrêté).

## Passage à PostgreSQL / MySQL

SQLite suffit largement pour 2 000 membres (lecture/écriture rapides, un seul serveur). Si la plateforme doit être répartie sur plusieurs serveurs, `schema.sql` est écrit en SQL standard : remplacer `INTEGER PRIMARY KEY AUTOINCREMENT` par `SERIAL`/`AUTO_INCREMENT`, les dates `TEXT` par `TIMESTAMP`, et adapter `server/src/db.js` (seul fichier qui parle au moteur) vers `pg` ou `mysql2`.
