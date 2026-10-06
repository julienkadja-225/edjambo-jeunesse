# API — Plateforme Jeunesse d'EDJAMBO

Base : `/api` · JSON · limite : 900 requêtes/min par compte connecté, 240/min par IP pour les anonymes (HTTP 429) · authentification `Authorization: Bearer <accessToken>` (sauf mention « public »).
Erreurs : `{ "error": "message en français" }` avec le code HTTP adapté (400, 401, 403, 404, 409, 413).
Listes paginées : `?page=1&limit=20` → `{ items, total, page, limit, pages }`.

Rôles : `member`, `admin` (permissions : `members`, `payments`, `forum`, `announcements`, `elections`), `super_admin` (toutes).
Légende : 🔓 public · 👤 tout utilisateur connecté · 🛠️ admin avec la permission indiquée · 👑 Super Admin.

## Authentification
| Méthode | Route | Accès | Description |
|---|---|---|---|
| POST | `/auth/register` | 🔓 | `multipart` : `first_name, last_name, age, neighborhood, password, accept_terms (obligatoire), email` et/ou `phone` (stocké au format international), `photo` (JPG/PNG ≤ 5 Mo). Compte créé en statut `pending`. |
| POST | `/auth/login` | 🔓 | `{identifier (email ou téléphone), password}` → `{user, accessToken (15 min), refreshToken (7 j)}`. 403 si compte en attente/suspendu/inactif. |
| POST | `/auth/refresh` | 🔓 | `{refreshToken}` → nouveaux jetons (rotation : l'ancien refresh est invalidé). |
| POST | `/auth/logout` | 🔓 | `{refreshToken}` — révoque la session. |
| POST | `/auth/forgot` | 🔓 | `{identifier}` — envoie un lien de réinitialisation (valable 1 h, usage unique). Réponse identique que le compte existe ou non. Sans SMTP configuré, en développement uniquement, le lien est renvoyé dans `dev_link` et affiché dans la console du serveur. |
| GET | `/auth/reset/:token` | 🔓 | `{valid}` — vérifie un lien avant d'afficher le formulaire. |
| POST | `/auth/reset` | 🔓 | `{token, password}` — définit le nouveau mot de passe, ferme toutes les sessions, notifie le membre. |
| GET | `/auth/me` | 👤 | Profil courant. |
| PUT | `/auth/me` | 👤 | `multipart` : mise à jour du profil + `photo`. |
| GET | `/auth/me/export` | 👤 | Télécharge toutes ses données personnelles (JSON) : profil, cotisations, forum, messages envoyés, participation aux élections (jamais le choix), notifications… |
| DELETE | `/auth/me` | 👤 membre | `{password}` — supprime le compte : données personnelles et messages privés effacés, compte anonymisé (« Ancien membre »), cotisations et contenu du forum conservés sans identité. Refusé pour les comptes d'administration. |
| PUT | `/auth/me/password` | 👤 | `{current, next}` — règle : 8 caractères min., lettres + chiffres, différent de l'actuel. Révoque les autres sessions et renvoie une nouvelle session `{user, accessToken, refreshToken}`. Seule route (avec `/auth/*`) accessible quand `must_change_password` est vrai. |

**Sécurité des connexions** : après 5 échecs consécutifs, le compte est verrouillé 15 min (HTTP 423). Un mot de passe temporaire impose le changement : toute autre route répond `403` avec `code: "PASSWORD_CHANGE_REQUIRED"`.

## Membres
| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/members` | 👤 | Annuaire. Filtres : `q, neighborhood`. Pour `members` : + `status, payment=paid\|unpaid, from, to` (dates d'inscription) et contacts complets. Les simples membres ne voient que les profils actifs (sans coordonnées). |
| GET | `/members/neighborhoods` | 👤 | Liste des quartiers. |
| GET | `/members/:id` | 👤 | Profil (+ historique de cotisation pour `members`). |
| POST | `/members/:id/reset-password` | 🛠️ members | Génère un mot de passe temporaire (affiché une seule fois), ferme les sessions du membre, impose le changement à la prochaine connexion. |
| POST | `/members/:id/unlock` | 🛠️ members | Lève un verrouillage après échecs de connexion. |
| PATCH | `/members/:id/status` | 🛠️ members | `{status: pending\|active\|suspended\|inactive, reason}` — notifie le membre à l'approbation/rejet. |

## Cotisations
| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/payment-methods` | 👤 | Comptes de paiement affichés (les admins `payments` voient aussi les inactifs). |
| POST/PUT/DELETE | `/payment-methods[/:id]` | 🛠️ payments | `{type: bank\|mobile_money, label, account_number, account_name, details, active}`. |
| GET/PUT | `/contribution-settings` | 👤 / 🛠️ payments | `monthly_amount, grace_days, reminder_day`. |
| POST | `/contributions` | 👤 membre | `multipart` : `month (AAAA-MM), method_id, amount, reference, proof, sms_text` — le SMS est ré-analysé côté serveur (le client ne peut pas imposer le niveau de cohérence) ; capture, SMS ou référence suffisent (JPG/PNG/PDF ≤ 5 Mo). Preuve **ou** référence requise. 409 si mois déjà payé/en attente ou référence déjà utilisée. |
| GET | `/contributions/mine` | 👤 | Historique + `current_status` + `up_to_date`. |
| GET | `/contributions/:id/proof` | auteur ou 🛠️ payments | Fichier de la preuve (accès protégé). |
| GET | `/contributions` | 🛠️ payments | File de vérification. Filtres : `status, month, q, level (consistent, review, none)`. Chaque ligne contient `sms_level`, `sms_flags`, `sms_text`. |
| POST | `/contributions/:id/approve` | 🛠️ payments | Valide et notifie le membre. |
| POST | `/contributions/:id/reject` | 🛠️ payments | `{reason}` obligatoire. |
| GET | `/contributions/stats` | 🛠️ payments | Total collecté, mois courant, taux, en attente, retardataires, historique 6 mois. |
| GET | `/contributions/defaulters` | 🛠️ payments | Membres actifs sans cotisation validée pour le mois. |
| POST | `/contributions/reminders` | 🛠️ payments | Envoie les rappels (aussi automatique, voir `reminder_day`). |
| POST | `/contributions/parse-sms` | 👤 | `{text}` — analyse un SMS de confirmation Mobile Money (Orange, MTN, Moov, Wave) : renvoie `parsed` (opérateur, montant, référence, date), `flags` (incohérences), `level` (`consistent` ou `review`) et `suggested` (compte, montant, référence à pré-remplir). Contrôle de **cohérence** uniquement (compte destinataire connu, montant ≥ cotisation attendue, référence jamais utilisée, date récente), pas d'authenticité. |
| POST | `/contributions/bulk-approve` | 🛠️ payments | `{ids[]}` — valide en masse, mais **uniquement** les paiements en attente dont le SMS est cohérent (les autres sont ignorés). |

## Forum & propositions
| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/forum/categories` | 👤 | Catégories + nombre de sujets. |
| POST/DELETE | `/forum/categories[/:id]` | 🛠️ forum | `{name, description}`. |
| GET | `/forum/threads` | 👤 | `type=discussion\|proposal, category, q, sort=top (propositions), hidden=1 (modérateurs)`. |
| POST | `/forum/threads` | 👤 | `{type, title, body, category_id (discussions)}`. Une proposition notifie les admins `forum`. |
| GET | `/forum/threads/:id` | 👤 | Sujet + réponses paginées. |
| POST | `/forum/threads/:id/posts` | 👤 | `{body}` — notifie l'auteur et les participants. 403 si sujet fermé. |
| POST | `/forum/react` | 👤 | `{target_type: thread\|post, target_id}` — bascule le « j'aime ». |
| POST | `/forum/threads/:id/vote` | 👤 | `{value: 1\|-1}` — vote pour/contre une proposition (renvoyer la même valeur l'annule). |
| PATCH | `/forum/threads/:id` | 🛠️ forum | `{pinned, closed, hidden}`. |
| DELETE | `/forum/threads/:id` | 🛠️ forum | Suppression. |
| PATCH | `/forum/posts/:id` | 🛠️ forum | `{hidden}`. |

## Élections
| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/elections` | 👤 | Liste (brouillons réservés à `elections`) avec `can_vote`, `has_voted`, `eligible`. |
| GET | `/elections/:id` | 👤 | Détail + candidats. Les voix ne sont visibles qu'après publication (ou pour `elections`). |
| POST | `/elections` | 🛠️ elections | `{title, description, start_at, end_at, require_contribution, candidates[]}`. |
| PUT/DELETE | `/elections/:id` | 🛠️ elections | Brouillon uniquement. |
| POST/DELETE | `/elections/:id/candidates[/:cid]` | 🛠️ elections | Brouillon uniquement. |
| POST | `/elections/:id/open` | 🛠️ elections | ≥ 2 candidats ; notifie tous les membres actifs. |
| POST | `/elections/:id/close` | 🛠️ elections | Clôture anticipée (la fin de période clôture aussi automatiquement). |
| POST | `/elections/:id/publish` | 🛠️ elections | Publie les résultats (élection clôturée). |
| POST | `/elections/:id/vote` | 👤 membre | `{candidate_id}` → `{receipt}`. Exige : élection ouverte, dans la période, membre actif, cotisation à jour (si requis), pas de vote antérieur. |
| GET | `/elections/:id/live` | 🛠️ elections | Résultats et participation en temps réel. |
| GET | `/elections/:id/audit` | 👤 (après publication) / 🛠️ elections | Liste anonyme des bulletins chaînés par hachage + `chain_valid`, `consistent`. |
| POST | `/elections/:id/verify-receipt` | 👤 | `{receipt}` — le votant retrouve son bulletin sans lien avec son identité. |

**Intégrité du vote** : la table `voters` (qui a voté) est séparée de `ballots` (quoi) ; chaque bulletin contient `hash = SHA-256(prev_hash | election | candidat | hash(reçu) | date)`. Toute modification d'un bulletin rompt la chaîne et est détectée par `/audit`.

## Annonces & événements
| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/public/announcements/:id` | 🔓 | Page de partage public. |
| GET | `/announcements` | 👤 | Archive. Filtres : `q, type=announcement\|event, upcoming=1`. |
| GET | `/announcements/:id` | 👤 | Détail. |
| POST | `/announcements` | 🛠️ announcements | `multipart` : `type, title, body (HTML assaini), event_date, location, media` (JPG/PNG/PDF ≤ 5 Mo). Notifie tous les membres actifs. |
| PUT/DELETE | `/announcements/:id` | 🛠️ announcements | Modification (`remove_media=1` pour retirer) / suppression. |
| POST | `/announcements/:id/rsvp` | 👤 | Bascule la participation. |
| POST | `/announcements/:id/reshare` | 👤 | Bascule la republication sur le profil. |

## Finances (transparence)

Principe : solde = solde initial + cotisations validées − dépenses validées. Une dépense n'est comptabilisée qu'après validation par un **responsable financier différent de son auteur** (double validation). Les membres voient les chiffres globaux et les dépenses validées, jamais le nom d'un cotisant.

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/finance/meta` | 👤 | Catégories de dépenses et seuil de justificatif obligatoire. |
| GET | `/finance/summary` | 👤 | Solde, recettes/dépenses du mois et totales, historique 12 mois, dépenses par catégorie, budgets de l'année. |
| GET | `/finance/expenses` | 👤 | Dépenses (membres : validées uniquement, sans noms ; 🛠️ finance : tous statuts, auteurs et validateurs). Filtres : `status, category, month, q`. |
| POST | `/finance/expenses` | 🛠️ finance | `multipart` : `amount, category, description, spent_at, receipt` (justificatif obligatoire au-delà du seuil). Notifie les autres responsables. |
| PUT / DELETE | `/finance/expenses/:id` | 🛠️ finance (auteur) | Modification (une dépense rejetée corrigée repasse « en attente ») / suppression. 409 si déjà validée. |
| POST | `/finance/expenses/:id/approve` · `/reject` | 🛠️ finance | `reject` : `{reason}`. 403 si le valideur est l'auteur. Journalisé. |
| GET | `/finance/expenses/:id/receipt` | 🛠️ finance / membres | Justificatif (membres : dépenses validées, si la transparence des justificatifs est activée). |
| GET | `/finance/expenses.csv` | 🛠️ finance | Export CSV (`?month=`). |
| GET / PUT | `/finance/settings` | 🛠️ finance | `opening_balance, public_receipts, receipt_required_above`. |
| PUT / DELETE | `/finance/budgets[/:year/:category]` | 🛠️ finance | `{year, category, amount}`. |
| GET | `/finance/report?month=AAAA-MM` | 👤 | Rapport mensuel (ouverture, recettes par moyen de paiement, dépenses, clôture). Version PDF : page imprimable `/finances/rapport`. |
| POST | `/finance/report/publish` | 🛠️ finance | Publie le rapport du mois en annonce et notifie les membres. |

## Passerelle SMS / WhatsApp

Les messages sont **mis en file** (table `outbox`) et envoyés par un processus d'arrière-plan (toutes les 15 s, 3 tentatives avec délai croissant). Envoi **uniquement** aux membres qui ont donné leur accord, pour les événements activés, dans la limite du plafond journalier. Fournisseurs : `console` (simulation, par défaut), `twilio` (SMS + WhatsApp), `webhook` (POST JSON vers l'API de votre opérateur). Voir `server/.env.example`.

| Méthode | Route | Accès | Description |
|---|---|---|---|
| PUT | `/auth/me/notification-prefs` | 👤 | `{sms_optin, whatsapp_optin}` — consentement (numéro de téléphone requis). |
| GET | `/notifications/channels` | 👤 | Canaux disponibles et événements concernés (affiché avant consentement). |
| GET | `/admin/sms/status` | 👑 | Fournisseur, événements activés, plafond, statistiques du mois, coût estimé, nombre de consentements. |
| PUT | `/admin/sms/settings` | 👑 | `{events[], daily_cap, unit_cost, default_country_code}`. |
| GET | `/admin/sms/outbox` | 👑 | Journal d'envoi (`status`, `channel`) ; numéros masqués. |
| POST | `/admin/sms/test` | 👑 | `{channel}` — envoie un message de test à son propre numéro. |
| POST | `/admin/sms/process` · `/retry-failed` | 👑 | Envoi immédiat de la file / remise en file des échecs. |

## Messagerie (discussions privées et groupes)

Principe : **personne ne peut être ajouté de force**. Une discussion privée est une *demande* que le destinataire accepte ou refuse ; un groupe envoie des *invitations* que chaque invité accepte ou refuse. Tant que l'invitation n'est pas acceptée, l'invité ne voit que le message de demande (discussion privée) ou rien du tout (groupe), et ne peut pas écrire. Les messages sont privés : l'équipe d'administration n'y a pas accès, sauf le message signalé par un participant et ses deux précédents.

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/messages` | 👤 | Mes conversations (`tab=invitations` pour les invitations reçues). Contient `unread`, dernier message, interlocuteur. |
| GET | `/messages/unread-count` | 👤 | `{messages, invitations, total}` (badge de navigation). |
| GET | `/messages/people?q=` | 👤 | Recherche de personnes par nom (2 lettres min.) ; exclut les personnes bloquées dans les deux sens. Aucune coordonnée exposée. |
| POST | `/messages/direct` | 👤 | `{user_id, body}` — envoie une demande de discussion (un seul message tant qu'elle n'est pas acceptée). 403 si refusée ou bloquée. Répondre à quelqu'un qui vous a écrit vaut acceptation. |
| POST | `/messages/groups` | 👤 | `{title, description, member_ids[]}` — crée le groupe (créateur = propriétaire) et envoie les invitations. |
| GET | `/messages/:id` | participant / invité | Détails : membres (statut `active`/`invited`, rôle), droits (`can_manage`, `is_owner`), état de la demande. 404 pour un non-participant. |
| POST | `/messages/:id/accept` · `/decline` | invité | Accepte / refuse l'invitation. À l'arrivée dans un groupe, l'historique antérieur reste masqué. Le refus interdit une nouvelle demande directe ; un groupe ne peut pas ré-inviter avant 7 jours. |
| POST | `/messages/:id/leave` | participant | Quitte (groupe : la propriété passe à un admin/membre si le créateur part). |
| PATCH / DELETE | `/messages/:id` | admin du groupe / propriétaire | Renommer le groupe / supprimer le groupe. |
| POST | `/messages/:id/invite` | propriétaire, admin du groupe | `{user_ids[]}` — nouvelles invitations (max 200 participants). |
| PATCH / DELETE | `/messages/:id/members/:uid` | propriétaire (rôles) / admins (retrait) | `{role: admin\|member}` / retire un membre ou annule une invitation. |
| GET | `/messages/:id/messages` | participant | `?limit=40`, `?before=<id>` (historique), `?after=<id>` (nouveaux messages — utilisé pour l'actualisation automatique toutes les 4 s). Marque la conversation comme lue. |
| POST | `/messages/:id/messages` | participant actif | `{body}` (≤ 2000 car., 20 messages / 30 s max). |
| PATCH / DELETE | `/messages/:id/messages/:mid` | auteur (modif. sous 24 h) ; suppression : auteur ou admin du groupe | Modification / suppression (le message devient « Message supprimé »). |
| POST | `/messages/:id/messages/:mid/report` | participant | `{reason}` — signale un message d'un autre participant. |
| GET / POST / DELETE | `/messages/blocks[/:uid]` | 👤 | Liste / bloque / débloque. Un blocage retire la discussion privée et empêche toute demande ou invitation dans les deux sens. |
| GET | `/messages/reports` | 🛠️ forum | Signalements (`status=open\|actioned\|dismissed`) avec contexte. |
| PATCH | `/messages/reports/:rid` | 🛠️ forum | `{action: dismiss\|delete_message\|suspend_sender}` — journalisé dans le journal d'activité. |

## Notifications
| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/notifications` | 👤 | Liste paginée. |
| GET | `/notifications/unread-count` | 👤 | `{count}`. |
| POST | `/notifications/:id/read`, `/notifications/read-all` | 👤 | Marque comme lu. |

Types : `registration, payment, announcement, event, election, proposal, reply, reminder`.

## Administration
| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/admin/stats` | admin | Indicateurs du tableau de bord. |
| GET/POST | `/admin/admins` | 👑 | Liste / création d'un admin (10 maximum) avec `permissions[]`. |
| PUT/DELETE | `/admin/admins/:id` | 👑 | Permissions, statut, mot de passe / suppression. |
| POST | `/admin/backup` | 👑 | Sauvegarde à chaud de la base. |
| GET | `/admin/audit` | 👑 | Journal d'activité (acteur, action, détail). Filtres : `action` (préfixe : `member`, `payment`, `election`, `announcement`, `admin`, `system`), `q`. |

## Fichiers
- `/uploads/<fichier>` — public : photos de profil et médias d'annonces.
- Preuves de paiement : jamais publiques, uniquement via `/contributions/:id/proof`.
- Contrôles : extension, type MIME **et** signature binaire (JPEG/PNG/PDF), 5 Mo maximum.
