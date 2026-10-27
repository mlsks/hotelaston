#!/usr/bin/env node
/**
 * Commandes du back-office (les mêmes actions seront exposées dans l'admin, brique 2) :
 *
 *   node server/cli.js migrate                  applique les migrations
 *   node server/cli.js import [--force]         importe le site actuel (une seule fois)
 *   node server/cli.js preview [--date=AAAA-MM-JJ]   génère /preview (brouillons compris)
 *   node server/cli.js publish                  fige le contenu (snapshot), génère et met en ligne
 *   node server/cli.js rebuild                  régénère la version en ligne (ce que fait le cron)
 *   node server/cli.js restore [id] [--with-content]   remet en ligne la version précédente (ou la version id)
 *   node server/cli.js builds                   liste les derniers builds
 *   node server/cli.js user:add <email> <rôle>  crée un compte (mot de passe généré, affiché une fois)
 *   node server/cli.js user:password <email>    nouveau mot de passe
 *   node server/cli.js media:gc                 supprime définitivement les médias supprimés inutilisés
 *   node server/cli.js stats:aggregate          agrégats quotidiens et purge des statistiques (fait chaque nuit)
 *   node server/cli.js geoip:update [--city]    télécharge la base de géolocalisation DB-IP Lite du mois
 */
import { getDb } from './db/connection.js';

const [command = 'help', ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--') && !a.includes('=')));
const option = (name) => rest.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const positional = rest.filter((a) => !a.startsWith('--'));

async function main() {
  const db = getDb();
  switch (command) {
    case 'migrate':
      console.log('Base à jour.');
      break;
    case 'import': {
      const { importLegacy } = await import('./db/import-legacy.js');
      importLegacy(db, { force: flags.has('--force'), forceAssets: flags.has('--force-assets') });
      break;
    }
    case 'preview':
    case 'publish':
    case 'rebuild': {
      const { runBuild } = await import('./ssg/build.js');
      const date = option('date');
      const build = await runBuild({
        kind: command === 'preview' ? 'preview' : 'production',
        trigger: command === 'rebuild' ? 'cron' : 'manual',
        now: date ? new Date(`${date}T12:00:00`) : new Date(),
      });
      printBuild(build);
      if (build.status === 'failed') process.exitCode = 1;
      break;
    }
    case 'restore': {
      const { restoreRelease } = await import('./ssg/release.js');
      const build = await restoreRelease({ buildId: positional[0] ? Number(positional[0]) : null, withContent: flags.has('--with-content') });
      console.log(`Version #${build.id} remise en ligne.`);
      break;
    }
    case 'user:add': {
      // node server/cli.js user:add email@exemple.fr editor --name="Prénom Nom" [--langs=en,it] [--scopes=live-music]
      const { hashPassword, generatePassword } = await import('./auth/auth.js');
      const [email, role = 'admin'] = positional;
      if (!email || !['admin', 'editor', 'translator'].includes(role)) throw new Error('Usage : user:add <email> <admin|editor|translator> [--name="Nom"] [--langs=en,it] [--scopes=live-music]');
      if (db.prepare('SELECT 1 FROM sys_users WHERE email = ?').get(email)) throw new Error('Un compte existe déjà avec cet e-mail.');
      const password = generatePassword();
      const langs = option('langs') ? JSON.stringify(option('langs').split(',')) : null;
      const { SCOPES } = await import('./auth/scopes.js');
      const scopes = option('scopes') ? option('scopes').split(',') : [];
      const unknown = scopes.filter((s) => !SCOPES[s]);
      if (unknown.length) throw new Error(`Périmètre inconnu : ${unknown.join(', ')} (disponibles : ${Object.keys(SCOPES).join(', ')})`);
      if (scopes.length && role !== 'editor') throw new Error('Seul un éditeur peut être limité à un périmètre.');
      db.prepare(`INSERT INTO sys_users (email, name, password_hash, role, langs, scopes, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`)
        .run(email, option('name') || email, await hashPassword(password), role, langs, scopes.length ? JSON.stringify(scopes) : null, new Date().toISOString());
      console.log(`Compte ${role}${scopes.length ? ` limité à ${scopes.join(', ')}` : ''} créé pour ${email}.\nMot de passe (affiché une seule fois) : ${password}`);
      break;
    }
    case 'user:password': {
      const { hashPassword, generatePassword } = await import('./auth/auth.js');
      const user = db.prepare('SELECT id FROM sys_users WHERE email = ?').get(positional[0] || '');
      if (!user) throw new Error('Compte introuvable.');
      const password = generatePassword();
      db.prepare('UPDATE sys_users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
      db.prepare('DELETE FROM sys_sessions WHERE user_id = ?').run(user.id);
      console.log(`Nouveau mot de passe (affiché une seule fois) : ${password}`);
      break;
    }
    case 'media:gc': {
      const { collectGarbage } = await import('./media/gc.js');
      console.log(`${collectGarbage(db)} média(s) supprimé(s) définitivement.`);
      break;
    }
    case 'stats:aggregate': {
      const { nightly } = await import('./analytics/aggregate.js');
      const { aggregated, purged } = nightly(db);
      console.log(`${aggregated.length} jour(s) agrégé(s) ; purge : ${purged.events} événement(s), ${purged.visits} visite(s), ${purged.daily} agrégat(s).`);
      break;
    }
    case 'geoip:update': {
      // Base DB-IP Lite (gratuite, CC BY 4.0) : pays seulement, ou pays + région avec --city (≈ 130 Mo)
      const { updateGeoip } = await import('./analytics/geoip.js');
      await updateGeoip({ city: flags.has('--city') });
      break;
    }
    case 'builds': {
      const rows = db.prepare('SELECT * FROM sys_builds ORDER BY id DESC LIMIT 15').all();
      for (const b of rows) {
        console.log(`#${b.id}\t${b.kind}/${b.triggered_by}\t${b.status}${b.is_current ? ' (en ligne)' : ''}\t${b.finished_at || b.started_at || ''}\t${b.pages_count ?? ''} pages`);
      }
      break;
    }
    default:
      console.log('Commandes : migrate, import [--force], preview [--date=AAAA-MM-JJ], publish, rebuild, restore [id] [--with-content], builds,\n'
        + '            user:add <email> <admin|editor|translator> [--name=…] [--langs=en,it] [--scopes=live-music], user:password <email>, media:gc,\n'
        + '            stats:aggregate, geoip:update [--city]');
  }
}

function printBuild(b) {
  const warnings = b.warnings ? JSON.parse(b.warnings) : [];
  console.log(`Build #${b.id} (${b.kind}/${b.triggered_by}) : ${b.status}${b.duration ? ` en ${b.duration} ms` : ''}`);
  if (b.pages_count) console.log(`  ${b.pages_count} pages · langues ${JSON.parse(b.langs || '[]').join(', ')}`);
  if (b.error) console.log(`  Erreur : ${b.error}`);
  if (warnings.length) {
    console.log(`  ${warnings.length} avertissement(s) :`);
    for (const w of warnings.slice(0, 25)) console.log(`   - ${w}`);
    if (warnings.length > 25) console.log(`   … et ${warnings.length - 25} autres`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
