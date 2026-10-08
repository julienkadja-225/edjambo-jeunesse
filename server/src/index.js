import { createApp } from './app.js';
import { getSetting } from './db.js';
import { sendContributionReminders } from './utils.js';
import { runBackup } from './backup.js';
import { providerInfo, startOutboxWorker } from './gateway.js';
import { bootstrap, bootstrapAdminFromEnv, purgeOldData } from './maintenance.js';

const PORT = parseInt(process.env.PORT || '4000');
createApp().listen(PORT, () => console.log(`API Jeunesse EDJAMBO → http://localhost:${PORT}`));

// Rappels automatiques : vérifiés toutes les 6 h, envoyés à partir du jour configuré du mois
setInterval(() => {
  try {
    if (new Date().getUTCDate() >= parseInt(getSetting('reminder_day', '5'))) {
      const n = sendContributionReminders();
      if (n) console.log(`${n} rappel(s) de cotisation envoyé(s)`);
    }
  } catch (e) {
    console.error('Rappels :', e);
  }
}, 6 * 3600 * 1000).unref();

// Passerelle SMS / WhatsApp
startOutboxWorker();
console.log(`Notifications SMS/WhatsApp : fournisseur « ${providerInfo().name} »${providerInfo().simulated ? ' (simulation, aucun envoi réel)' : ''}`);

if (bootstrap()) console.log('Catégories du forum créées.');
const firstAdmin = bootstrapAdminFromEnv();
if (firstAdmin) console.log(`Premier Super Admin créé : ${firstAdmin} (mot de passe à changer à la première connexion ; retirez ensuite les variables BOOTSTRAP_ADMIN_*).`);

// Nettoyage quotidien des données techniques périmées (jetons, files d'envoi, notifications lues)
const purge = () => { try { purgeOldData(); } catch (e) { console.error('Nettoyage :', e); } };
purge();
setInterval(purge, 24 * 3600 * 1000).unref();

// Sauvegarde quotidienne automatique
if (process.env.AUTO_BACKUP !== '0') {
  setInterval(() => {
    try { runBackup(); } catch (e) { console.error('Sauvegarde :', e); }
  }, 24 * 3600 * 1000).unref();
}
