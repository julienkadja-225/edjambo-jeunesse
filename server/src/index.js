import { createApp } from './app.js';
import { getSetting } from './db.js';
import { sendContributionReminders } from './utils.js';
import { runBackup } from './backup.js';

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

// Sauvegarde quotidienne automatique
if (process.env.AUTO_BACKUP !== '0') {
  setInterval(() => {
    try { runBackup(); } catch (e) { console.error('Sauvegarde :', e); }
  }, 24 * 3600 * 1000).unref();
}
