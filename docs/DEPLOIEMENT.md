# Mise en ligne de la plateforme

Un petit serveur suffit pour 2 000 membres : l'application tourne dans **un seul processus Node** qui sert à la fois l'API et l'interface, avec une base SQLite (testée à 2 000 membres : réponses en quelques millisecondes).

## Avant de commencer

| À prévoir | Détail |
|---|---|
| Un serveur | VPS Linux (1 Go de RAM, 10 Go de disque suffisent) ou un hébergeur Node.js |
| Un nom de domaine + HTTPS | Obligatoire : mots de passe et preuves de paiement circulent |
| `JWT_SECRET` | Longue chaîne aléatoire (ex. `openssl rand -hex 48`). **Le serveur refuse de démarrer en production sans lui.** |
| `APP_URL` | Adresse publique (`https://jeunesse.exemple.org`), utilisée dans les liens des emails / SMS |

## Option A — Docker (recommandée)

```bash
git clone https://github.com/<compte>/edjambo-jeunesse.git && cd edjambo-jeunesse
export JWT_SECRET=$(openssl rand -hex 48)
export APP_URL=https://jeunesse.exemple.org
docker compose up -d --build
```

Les données (base, preuves de paiement, photos, sauvegardes) sont dans le volume `edjambo-data`. **Conservez la valeur de `JWT_SECRET`** (si elle change, tous les membres devront se reconnecter).

## Option B — Node.js directement (systemd)

Prérequis : Node.js 24 (ou ≥ 22.13).

```bash
npm install && npm run setup && npm run build
cp server/.env.example server/.env      # puis renseignez JWT_SECRET, APP_URL, NODE_ENV=production…
NODE_ENV=production npm start           # à placer sous systemd ou pm2 pour redémarrer automatiquement
```

Exemple d'unité systemd (`/etc/systemd/system/jeunesse.service`) :

```ini
[Service]
WorkingDirectory=/opt/edjambo-jeunesse
Environment=NODE_ENV=production
EnvironmentFile=/opt/edjambo-jeunesse/server/.env
ExecStart=/usr/bin/node --no-warnings server/src/index.js
Restart=always
User=jeunesse
[Install]
WantedBy=multi-user.target
```

## Option C — Render (hébergeur « clé en main »)

1. **New → Blueprint**, choisissez le dépôt : le fichier `render.yaml` crée le service, un secret `JWT_SECRET` généré automatiquement et un **disque persistant**. (Ou **New → Web Service** → Runtime *Docker* ; dans ce cas ajoutez les variables ci-dessous à la main.)
2. Variables d'environnement (onglet **Environment**) :

| Variable | Valeur |
|---|---|
| `JWT_SECRET` | **Obligatoire.** Bouton *Generate* de Render, ou `openssl rand -hex 48`. À conserver : si elle change, tout le monde est déconnecté. |
| `NODE_ENV` | `production` (déjà défini dans l'image) |
| `APP_URL` | `https://<votre-service>.onrender.com` (ou votre domaine) |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` (+ `BOOTSTRAP_ADMIN_FIRST`, `BOOTSTRAP_ADMIN_LAST`) | Premier Super Admin, créé au démarrage s'il n'en existe aucun. Mot de passe : 8 caractères minimum, lettres **et** chiffres. Il devra être changé à la première connexion ; **retirez ensuite ces variables**. |

3. **Disque persistant — indispensable.** Le conteneur Render est éphémère : sans disque monté sur `/data`, la base et les fichiers envoyés sont **effacés à chaque redéploiement ou redémarrage**. Les disques exigent une offre payante (Starter). Sur l'offre gratuite, la plateforme fonctionne pour une démonstration mais **ne doit pas recevoir de vraies données** (le service s'endort aussi après quelques minutes d'inactivité).
4. Ouvrez l'adresse du service et connectez-vous avec le compte créé à l'étape 2.

> Erreur `JWT_SECRET doit être défini en production` dans les journaux : la variable `JWT_SECRET` est absente. Ajoutez-la dans **Environment**, puis **Manual Deploy → Deploy latest commit**.

## HTTPS (reverse proxy)

Placez Nginx ou Caddy devant l'application (port 4000). Avec **Caddy**, deux lignes suffisent (certificat gratuit et renouvelé automatiquement) :

```
jeunesse.exemple.org {
    reverse_proxy localhost:4000
}
```

Avec Nginx : `proxy_pass http://127.0.0.1:4000;` + `client_max_body_size 6m;` (les envois sont limités à 5 Mo) + certificat Let's Encrypt (`certbot`). Le serveur est configuré pour reconnaître **un** proxy (`trust proxy 1`).

## Premier compte Super Admin

En production, le jeu de données de test (`npm run seed`) est **interdit** (il efface la base). Créez le premier Super Admin en ligne de commande :

```bash
# Docker
docker compose exec jeunesse node --no-warnings src/create-admin.js --email moi@exemple.org --first Prénom --last Nom --phone 0700000000
# Node direct
npm run create-admin -- --email moi@exemple.org --first Prénom --last Nom --phone 0700000000
```

(Sans accès terminal, par exemple sur Render : définissez les variables `BOOTSTRAP_ADMIN_*`, voir l'option C.) Un mot de passe temporaire est affiché **une seule fois** ; il devra être changé à la première connexion. Ensuite, depuis `/admin/equipe`, créez les autres administrateurs et donnez-leur les permissions utiles (membres, cotisations, forum, annonces, élections, **finances**). Dans `/admin/paiement-infos`, saisissez les numéros Orange Money / MTN / le compte bancaire de l'association.

## Configuration facultative

- **Emails** (mot de passe oublié, validations) : `SMTP_*` et `MAIL_FROM`.
- **SMS / WhatsApp** : `SMS_PROVIDER=twilio` (ou `webhook`) et les clés du prestataire — chaque message réel est facturé. Réglez ensuite les événements et le plafond journalier dans `/admin/sms`. Voir `server/.env.example`.
- **CORS** : inutile quand l'interface est servie par le même serveur (comportement par défaut en production).

## Sauvegardes — à ne pas négliger

- Le serveur crée **chaque jour** un dossier `backups/edjambo-<date>/` contenant `edjambo.db` **et** `uploads/` (photos, preuves de paiement, justificatifs) et garde les 14 dernières. Sauvegarde manuelle : bouton « Sauvegarder » dans `/admin/equipe`, ou `npm run backup`.
- Une sauvegarde sur le **même disque** ne protège pas d'une panne du serveur : copiez régulièrement le dossier `backups/` ailleurs (autre serveur, stockage cloud, disque externe). Exemple (cron quotidien) : `rsync -a /data/backups/ utilisateur@autre-serveur:/sauvegardes/edjambo/`
- **Restauration** : arrêtez l'application, remplacez `edjambo.db` (et le dossier `uploads/`) par ceux de la sauvegarde choisie, puis redémarrez. **Testez une restauration au moins une fois**, avant d'en avoir besoin.

## Mises à jour

```bash
git pull
docker compose up -d --build          # ou : npm run setup && npm run build && redémarrage du service
```

La base est mise à jour automatiquement au démarrage (ajout de colonnes/tables), sans perte de données. Faites une sauvegarde avant chaque mise à jour.

## Surveillance

- `GET /api/health` répond `{"ok":true}` : à brancher sur un outil de supervision gratuit (UptimeRobot, etc.).
- Les erreurs sont écrites dans la sortie du serveur (`docker compose logs -f jeunesse` ou `journalctl -u jeunesse -f`).
- Un nettoyage quotidien supprime les données techniques périmées (sessions, journaux d'envoi anciens, notifications lues).

## Liste de contrôle avant ouverture

- [ ] HTTPS actif, `JWT_SECRET` défini et conservé en lieu sûr
- [ ] Premier Super Admin créé ; mot de passe personnel choisi
- [ ] Comptes de paiement saisis, montant de la cotisation réglé (`/admin/paiement-infos`)
- [ ] Solde initial de la caisse renseigné (`/admin/finances` → Budgets et paramètres)
- [ ] Texte de `/confidentialite` relu et complété par le bureau (responsable, coordonnées)
- [ ] Sauvegarde copiée hors du serveur **et** restauration testée
- [ ] Au moins deux administrateurs avec la permission « finances » (double validation des dépenses)

## Si la plateforme grandit

SQLite convient pour un seul serveur. Au-delà (plusieurs serveurs, très fortes charges), `server/src/schema.sql` est écrit en SQL standard et `server/src/db.js` est le seul fichier qui parle au moteur : la migration vers PostgreSQL consiste à adapter ce fichier et les types de dates.
