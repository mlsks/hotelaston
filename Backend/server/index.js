/**
 * Démarrage du serveur : application Fastify + tâches planifiées
 * (régénération de minuit, nettoyage des médias supprimés, agrégats statistiques).
 */
import cron from 'node-cron';
import { config } from './config.js';
import { getDb } from './db/connection.js';
import { buildApp } from './app.js';
import { runBuild } from './ssg/build.js';
import { currentBuild } from './ssg/release.js';
import { collectGarbage } from './media/gc.js';
import { completeVariants } from './media/pipeline.js';
import { audit } from './lib/audit.js';
import { nightly } from './analytics/aggregate.js';
import { refreshGeoip } from './analytics/geoip.js';
import { gbpConfigured, syncAndPublish } from './reviews/gbp-sync.js';

const app = await buildApp();
const db = getDb();
const updateGeoip = () => (config.geoip.autoUpdate ? refreshGeoip({ edition: config.geoip.edition, log: (m) => app.log.info(m) }) : null);

/* Régénération planifiée : active ou retire les éléments programmés, sans publier de brouillon */
cron.schedule(config.cron, async () => {
  if (currentBuild(db)) {
    const build = await runBuild({ kind: 'production', trigger: 'cron', log: (m) => app.log.info(m) });
    app.log.info(`Régénération planifiée : build #${build.id} ${build.status}${build.error ? ` (${build.error})` : ''}`);
  } else {
    app.log.info('Régénération planifiée : rien de publié pour le moment.');
  }
  collectGarbage(db, { log: (m) => app.log.info(m) });
  nightly(db, { log: (m) => app.log.info(m) }); // agrégats statistiques et purge (13 / 25 mois)
  await updateGeoip(); // base de géolocalisation du nouveau mois, dès que DB-IP l'a publiée
}, { timezone: config.timezone });

/* Avis Google : synchronisation par l'API puis publication des avis seuls (si GBP_SYNC_CRON et les identifiants sont renseignés) */
if (config.gbp.cron && gbpConfigured()) {
  cron.schedule(config.gbp.cron, async () => {
    try {
      await syncAndPublish(db, { log: (m) => app.log.info(m) });
    } catch (err) {
      app.log.error(`Avis Google : ${err.message}`);
    }
  }, { timezone: config.timezone });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Base de géolocalisation absente ou d'un mois passé : téléchargée en arrière-plan, sans retarder le démarrage
updateGeoip();

// Photos envoyées avant l'AVIF et les recadrages portrait en plusieurs tailles : variantes créées en arrière-plan,
// une seule fois (rien à faire aux démarrages suivants). Noté dans le Journal ; une publication les met en ligne.
completeVariants(db, { log: (m) => app.log.info(m) })
  .then((r) => { if (r.variants) audit(db, {}, 'optimize', 'media', null, { after: r }); })
  .catch((err) => app.log.error(`Médiathèque : ${err.message}`));
