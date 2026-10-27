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
  uploadMaxMb: { image: Number(env('UPLOAD_MAX_IMAGE_MB', 25)), video: Number(env('UPLOAD_MAX_VIDEO_MB', 200)), audio: Number(env('UPLOAD_MAX_AUDIO_MB', 30)) },
  warnMb: { video: 8, audio: 5 },
};
