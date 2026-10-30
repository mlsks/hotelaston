/**
 * Configuration : chemins du projet et variables d'environnement (.env facultatif).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && !process.env.ASTON_NO_DOTENV) process.loadEnvFile(envFile);

const env = (key, fallback) => (process.env[key] === undefined || process.env[key] === '' ? fallback : process.env[key]);

// Données modifiables (base, médias, versions) : déplaçables d'un bloc, par exemple pour les tests
const VAR = path.resolve(env('ASTON_VAR_DIR', ROOT));

export const config = {
  root: ROOT,
  varDir: VAR,
  legacyDir: path.resolve(ROOT, '..'), // site actuel (hotelaston/), source de l'import
  templatesDir: path.resolve(env('ASTON_TEMPLATES_DIR', path.join(ROOT, 'templates-src'))),
  adminDir: path.join(ROOT, 'admin'),
  storageDir: path.join(VAR, 'storage'),
  dbPath: path.join(VAR, 'storage', 'db', 'aston.sqlite'),
  snapshotsDir: path.join(VAR, 'storage', 'snapshots'),
  backupsDir: path.join(VAR, 'storage', 'backups'),
  uploadsDir: path.join(VAR, 'storage', 'uploads'),
  mediaDir: path.join(VAR, 'media'),
  previewDir: path.join(VAR, 'preview'),
  releasesDir: path.join(VAR, 'releases'),
  publicDist: path.join(VAR, 'public-dist'),
  lockFile: path.join(VAR, 'storage', 'build.lock'),

  host: env('HOST', '127.0.0.1'),
  port: Number(env('PORT', 3000)),
  siteUrl: env('SITE_URL', 'https://www.hotel-aston.com').replace(/\/+$/, ''),
  timezone: env('SITE_TZ', 'Europe/Paris'),
  cron: env('CRON_REBUILD', '0 0 * * *'),
  indexNowKey: env('INDEXNOW_KEY', ''),
  serveLegacy: env('SERVE_LEGACY', '0') === '1',
  keepReleases: 3,

  sessionHours: Number(env('SESSION_HOURS', 12)),
  ffmpeg: env('FFMPEG_PATH', 'ffmpeg'),
  ffprobe: env('FFPROBE_PATH', 'ffprobe'),
  // Poids maximal accepté au téléversement, puis seuils d'alerte (Mo)
  uploadMaxMb: { image: Number(env('UPLOAD_MAX_IMAGE_MB', 25)), video: Number(env('UPLOAD_MAX_VIDEO_MB', 200)), audio: Number(env('UPLOAD_MAX_AUDIO_MB', 30)), document: Number(env('UPLOAD_MAX_DOCUMENT_MB', 20)) },
  warnMb: { video: 8, audio: 5, document: 5 },

  // Avis Google : API Google Business Profile (OAuth du compte gestionnaire de la fiche). Vide : pas de synchronisation.
  gbp: {
    clientId: env('GBP_CLIENT_ID', ''),
    clientSecret: env('GBP_CLIENT_SECRET', ''),
    refreshToken: env('GBP_REFRESH_TOKEN', ''),
    accountId: env('GBP_ACCOUNT_ID', ''),
    locationId: env('GBP_LOCATION_ID', ''),
    cron: env('GBP_SYNC_CRON', ''), // ex. « 0 6 * * * » : chaque matin, puis publication des avis seuls
  },
};

/**
 * Chemins enregistrés en base (sys_builds.snapshot_path, release_path) : relatifs à varDir,
 * avec des « / », pour que la base suive le dossier d'un ordinateur ou d'un système à l'autre.
 */
export const toVarPath = (abs) => (abs ? path.relative(VAR, abs).split(path.sep).join('/') : abs);

// Dossiers de varDir qui peuvent figurer dans un chemin enregistré
const VAR_ROOTS = new Set(['releases', 'storage']);

/**
 * Chemin enregistré → chemin absolu. Accepte aussi les anciens chemins absolus, y compris
 * Windows (C:\dev\…\Backend\releases\12) : ils sont replacés sous le varDir actuel.
 */
export function fromVarPath(stored) {
  if (!stored) return stored;
  const absolute = path.isAbsolute(stored) || /^[A-Za-z]:[\\/]/.test(stored) || stored.startsWith('\\\\');
  if (!absolute) return path.resolve(VAR, ...stored.split('/'));
  if (fs.existsSync(stored)) return stored;
  const parts = stored.split(/[\\/]+/);
  const i = parts.findLastIndex((p, k) => VAR_ROOTS.has(p) && k < parts.length - 1);
  return i < 0 ? stored : path.join(VAR, ...parts.slice(i));
}
