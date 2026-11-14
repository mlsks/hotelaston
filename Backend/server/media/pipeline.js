/**
 * Pipeline des médias à l'upload.
 *  - Contrôles : type réel (premiers octets), poids maximal par type, empreinte SHA-256 contre les doublons.
 *  - Images (sharp) : orientation EXIF appliquée, métadonnées retirées, WebP et AVIF en 640 / 1024 / 1600 / 2400 px
 *    (jamais au-delà de l'original, dont la largeur est gardée aussi), recadrage portrait 9:16 centré sur le point
 *    d'intérêt en 540 / 780 / 900 px de large (WebP et AVIF), image de partage JPEG 1200×630, miniature.
 *    L'AVIF pèse environ deux fois moins que le WebP ; les navigateurs qui ne le lisent pas prennent le WebP.
 *  - Vidéos et sons (ffprobe / ffmpeg) : durée et dimensions ; poster WebP extrait des vidéos.
 * Les originaux restent dans storage/uploads (jamais servis) ; les variantes vont dans media/v/
 * avec un nom tiré de l'empreinte, donc immuables.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { config } from '../config.js';
import { nowIso } from '../lib/util.js';
import { HttpError } from '../lib/http.js';
import { sniff } from './sniff.js';

const WIDTHS = [640, 1024, 1600, 2400];
/** Largeurs du recadrage portrait (téléphones) : 900 px garde le nom historique « portrait ». */
const PORTRAIT_WIDTHS = [540, 780, 900];
const portraitPurpose = (w) => (w === 900 ? 'portrait' : `portrait-w${w}`);
const WEBP = { quality: 78 };
// effort 2 : dix fois plus rapide que le réglage par défaut, pour un fichier à peine plus lourd
const AVIF = { quality: 50, effort: 2 };
const MB = 1024 * 1024;
const VARIANT_DIR = 'v';
// Chaque image n'est lue qu'une fois par opération : le cache de libvips ne ferait que garder de la mémoire
sharp.cache(false);

/* File de traitement : un média à la fois, sans bloquer les requêtes */
let chain = Promise.resolve();
const jobs = new Map();
export function enqueue(id, fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  jobs.set(id, p);
  p.finally(() => jobs.delete(id));
  return p;
}
/** Attend la fin du traitement d'un média (tests, commandes). */
export const waitFor = (id) => jobs.get(id) || Promise.resolve();

/*
 * Traitement des images dans un processus à part (media/worker.js), qui se termine ensuite.
 * L'encodage AVIF laisse plusieurs centaines de Mo à l'allocateur mémoire, qui ne les rend pas au système :
 * dans le serveur, cette mémoire s'ajoutait à celle d'une publication et dépassait les 512 Mo de la démo
 * Render (instance arrêtée, 14/11/2026). Le processus qui se termine rend tout.
 */
const WORKER = fileURLToPath(new URL('./worker.js', import.meta.url));
export function inWorker(task, id) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, task, String(id)], { env: process.env, windowsHide: true });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(Buffer.concat(err).toString().trim().split('\n').at(-1)?.slice(0, 300) || `traitement interrompu (code ${code})`));
      try {
        return resolve(JSON.parse(Buffer.concat(out).toString() || 'null'));
      } catch {
        return resolve(null);
      }
    });
  });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(Buffer.concat(err).toString().slice(-300) || `${cmd} : code ${code}`))));
  });
}

async function probe(file) {
  const json = JSON.parse((await run(config.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])).toString());
  const video = json.streams?.find((s) => s.codec_type === 'video');
  return { duration: Number(json.format?.duration) || null, width: video?.width || null, height: video?.height || null };
}

/** Enregistre un fichier envoyé (flux) ; renvoie le média, existant si c'est un doublon. */
export async function ingestUpload(db, { stream, filename, folder = '/', userId = null }) {
  const tmpDir = path.join(config.uploadsDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, crypto.randomUUID());
  const hash = crypto.createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  try {
    await pipeline(stream, new Transform({
      transform(chunk, enc, cb) {
        hash.update(chunk);
        size += chunk.length;
        if (head.length < 64) head = Buffer.concat([head, chunk]).subarray(0, 64);
        cb(null, chunk);
      },
    }), fs.createWriteStream(tmp));
    if (stream.truncated) throw new HttpError(413, 'Fichier trop lourd.');
    const type = sniff(head);
    if (!type) throw new HttpError(415, 'Type de fichier non pris en charge : images JPEG, PNG, WebP, AVIF, GIF ; vidéos MP4, WebM ; sons MP3, M4A, WAV, OGG, FLAC ; documents PDF.');
    if (type.mime === 'image/heic') throw new HttpError(415, 'Photo HEIC (iPhone) : exportez-la en JPEG avant de l’envoyer.');
    const max = config.uploadMaxMb[type.kind];
    if (size > max * MB) throw new HttpError(413, `Fichier trop lourd : ${(size / MB).toFixed(1)} Mo pour ${max} Mo au plus.`);

    const digest = hash.digest('hex');
    const existing = db.prepare('SELECT * FROM cms_media WHERE sha256 = ?').get(digest);
    if (existing) {
      if (existing.deleted_at) db.prepare('UPDATE cms_media SET deleted_at = NULL WHERE id = ?').run(existing.id);
      return { id: existing.id, duplicate: true };
    }
    const now = new Date();
    const rel = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${digest.slice(0, 16)}.${type.ext}`;
    fs.mkdirSync(path.dirname(path.join(config.uploadsDir, rel)), { recursive: true });
    fs.renameSync(tmp, path.join(config.uploadsDir, rel));
    const id = Number(db.prepare(`INSERT INTO cms_media (kind, folder, original_name, storage_key, mime, bytes, sha256, status, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?)`).run(type.kind, folder, path.basename(String(filename || 'fichier')).slice(0, 200), rel, type.mime, size, digest, nowIso(), userId).lastInsertRowid);
    enqueue(id, () => inWorker('process', id).catch((err) => {
      db.prepare("UPDATE cms_media SET status = 'error', error = ? WHERE id = ?").run(`Traitement impossible : ${err.message}`.slice(0, 500), id);
    }));
    return { id, duplicate: false };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function saveVariant(db, mediaId, purpose, format, info, rel) {
  db.prepare(`INSERT INTO cms_media_variants (media_id, purpose, format, width, height, bytes, path) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (media_id, purpose, format) DO UPDATE SET width = excluded.width, height = excluded.height, bytes = excluded.bytes, path = excluded.path`)
    .run(mediaId, purpose, format, info.width ?? null, info.height ?? null, info.size, rel);
}

/** Nom de fichier lisible, sans accents ni extension : « Carte des vins (2026).pdf » → « carte-des-vins-2026 ». */
const fileSlug = (name) => String(name || '').replace(/\.[a-z0-9]+$/i, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const variantPath = (m, suffix) => `${VARIANT_DIR}/${m.sha256.slice(0, 16)}-${suffix}`;
const absolute = (rel) => path.join(config.mediaDir, ...rel.split('/'));

/** Zone du recadrage 9:16 centré sur le point d'intérêt, ou null pour une image déjà verticale. */
function portraitCrop(m, width, height) {
  if (width / height < 0.8) return null; // déjà vertical
  let cw = Math.round(height * (9 / 16));
  let ch = height;
  if (cw > width) {
    cw = width;
    ch = Math.round(width * (16 / 9));
  }
  const left = Math.min(Math.max(0, Math.round(m.focal_x * width - cw / 2)), width - cw);
  const top = Math.min(Math.max(0, Math.round(m.focal_y * height - ch / 2)), height - ch);
  return { left, top, width: cw, height: ch };
}

/** Largeurs de recadrage portrait utiles : la plus grande toujours (ramenée à la zone recadrée si elle est plus petite), les autres si elles sont plus petites que la zone. */
const portraitWidths = (crop) => PORTRAIT_WIDTHS.filter((w) => w === 900 || w < crop.width);

/**
 * Recadrage 9:16 centré sur le point d'intérêt (pour les téléphones), en plusieurs largeurs, WebP et AVIF.
 * only : ne crée que les variantes absentes de cette liste de couples « but/format » (rattrapage).
 */
async function portrait(db, m, src, width, height, { only = null } = {}) {
  const crop = portraitCrop(m, width, height);
  if (!crop) return;
  const base = `portrait-${Math.round(m.focal_x * 100)}-${Math.round(m.focal_y * 100)}`;
  for (const w of portraitWidths(crop)) {
    const purpose = portraitPurpose(w);
    const suffix = w === 900 ? base : `${base}-w${w}`;
    for (const [format, opts] of [['webp', WEBP], ['avif', AVIF]]) {
      if (only && !only.has(`${purpose}/${format}`)) continue;
      const rel = variantPath(m, `${suffix}.${format}`);
      const info = await sharp(src).rotate().extract(crop)
        .resize({ width: w, height: Math.round(w * (16 / 9)), fit: 'cover', withoutEnlargement: true })[format](opts).toFile(absolute(rel));
      saveVariant(db, m.id, purpose, format, info, rel);
    }
  }
}

/**
 * Image de partage (og:image) : JPEG 1200×630 centré sur le point d'intérêt.
 * JPEG plutôt que WebP : c'est le seul format lu partout (Facebook, WhatsApp, LinkedIn, messageries).
 */
async function shareVariant(db, m, src, width, height) {
  let cw = width;
  let ch = Math.round(width * (630 / 1200));
  if (ch > height) {
    ch = height;
    cw = Math.round(height * (1200 / 630));
  }
  const left = Math.min(Math.max(0, Math.round(m.focal_x * width - cw / 2)), width - cw);
  const top = Math.min(Math.max(0, Math.round(m.focal_y * height - ch / 2)), height - ch);
  const rel = variantPath(m, `share-${Math.round(m.focal_x * 100)}-${Math.round(m.focal_y * 100)}.jpg`);
  const info = await sharp(src).rotate().extract({ left, top, width: cw, height: ch })
    .resize({ width: 1200, height: 630, fit: 'cover' }).flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toFile(absolute(rel));
  saveVariant(db, m.id, 'share', 'jpeg', info, rel);
}

/** Adresse (relative à media/) de l'image de partage d'une image, créée au besoin (images importées avant cette variante). */
export async function shareImagePath(db, id) {
  const m = db.prepare('SELECT * FROM cms_media WHERE id = ?').get(id);
  if (!m || m.kind !== 'image' || !m.width) return null;
  const find = () => db.prepare("SELECT path FROM cms_media_variants WHERE media_id = ? AND purpose = 'share'").pluck().get(id);
  if (!find()) await shareVariant(db, m, path.join(config.uploadsDir, m.storage_key), m.width, m.height);
  return find();
}

/** Variantes d'une largeur : WebP (lu partout) et AVIF (deux fois plus léger). only : rattrapage, voir portrait(). */
async function widthVariants(db, m, src, w, { only = null } = {}) {
  for (const [format, opts] of [['webp', WEBP], ['avif', AVIF]]) {
    if (only && !only.has(`w${w}/${format}`)) continue;
    const rel = variantPath(m, `w${w}.${format}`);
    const info = await sharp(src).rotate().resize({ width: w, withoutEnlargement: true })[format](opts).toFile(absolute(rel));
    saveVariant(db, m.id, `w${w}`, format, info, rel);
  }
}

/** Variantes attendues d'une image déjà traitée qui manquent encore (images envoyées avant l'AVIF et les portraits multiples). */
export function missingVariants(db, m) {
  if (m.kind !== 'image' || !m.width || !m.height) return [];
  const have = new Set(db.prepare('SELECT purpose || \'/\' || format FROM cms_media_variants WHERE media_id = ?').pluck().all(m.id));
  const want = [];
  for (const purpose of db.prepare("SELECT DISTINCT purpose FROM cms_media_variants WHERE media_id = ? AND purpose GLOB 'w[0-9]*'").pluck().all(m.id)) {
    want.push(`${purpose}/webp`, `${purpose}/avif`);
  }
  const crop = portraitCrop(m, m.width, m.height);
  if (crop) for (const w of portraitWidths(crop)) want.push(`${portraitPurpose(w)}/webp`, `${portraitPurpose(w)}/avif`);
  return want.filter((k) => !have.has(k));
}

/**
 * Rattrapage, au démarrage et en arrière-plan : crée l'AVIF et les recadrages portrait manquants des images
 * déjà dans la médiathèque, une image à la fois dans la file des médias (les envois de l'admin passent entre deux).
 * Les originaux absents (copie partielle de storage/) sont sautés. Renvoie { images, variants, skipped }.
 */
export async function completeVariants(db, { log = () => {} } = {}) {
  const images = db.prepare("SELECT * FROM cms_media WHERE kind = 'image' AND status = 'ready' AND deleted_at IS NULL AND width IS NOT NULL ORDER BY id").all();
  const todo = images.map((m) => ({ m, missing: missingVariants(db, m) })).filter((t) => t.missing.length);
  const result = { images: 0, variants: 0, skipped: 0 };
  if (!todo.length) return result;
  log(`Médiathèque : AVIF et recadrages pour téléphone à créer pour ${todo.length} image(s), en arrière-plan.`);
  for (const { m, missing } of todo) {
    const src = path.join(config.uploadsDir, m.storage_key);
    if (!fs.existsSync(src)) {
      result.skipped += 1;
      continue;
    }
    await enqueue(`variants-${m.id}`, async () => {
      try {
        result.variants += await inWorker('complete', m.id);
        result.images += 1;
      } catch (err) {
        result.skipped += 1;
        log(`Médiathèque : image n° ${m.id} non complétée (${err.message}).`);
      }
    });
  }
  log(`Médiathèque : ${result.variants} variante(s) créée(s) pour ${result.images} image(s)${result.skipped ? `, ${result.skipped} sautée(s) (original absent ou illisible)` : ''}. Publiez pour en profiter sur le site.`);
  return result;
}

/** Crée les variantes manquantes d'une image (rattrapage) ; renvoie leur nombre. */
export async function completeMedia(db, id) {
  const m = db.prepare('SELECT * FROM cms_media WHERE id = ?').get(id);
  const missing = m ? missingVariants(db, m) : [];
  if (!missing.length) return 0;
  const src = path.join(config.uploadsDir, m.storage_key);
  fs.mkdirSync(path.join(config.mediaDir, VARIANT_DIR), { recursive: true });
  const only = new Set(missing);
  for (const purpose of new Set(missing.filter((k) => k.startsWith('w')).map((k) => k.split('/')[0]))) {
    await widthVariants(db, m, src, Number(purpose.slice(1)), { only });
  }
  if (missing.some((k) => k.startsWith('portrait'))) await portrait(db, m, src, m.width, m.height, { only });
  return missing.length;
}

export async function processMedia(db, id) {
  const m = db.prepare('SELECT * FROM cms_media WHERE id = ?').get(id);
  if (!m || m.kind === 'embed') return;
  const src = path.join(config.uploadsDir, m.storage_key);
  fs.mkdirSync(path.join(config.mediaDir, VARIANT_DIR), { recursive: true });
  try {
    if (m.kind === 'image') {
      const { info: oriented } = await sharp(src).rotate().toBuffer({ resolveWithObject: true });
      const { width, height } = oriented;
      // Tailles standard, plus la largeur d'origine quand elle tombe entre deux (900 px → 640 et 900)
      const widths = WIDTHS.filter((w) => w <= width);
      if (width < WIDTHS[WIDTHS.length - 1] && !widths.includes(width)) widths.push(width);
      for (const w of widths) await widthVariants(db, m, src, w);
      await portrait(db, m, src, width, height);
      await shareVariant(db, m, src, width, height);
      const thumbRel = variantPath(m, 'thumb.webp');
      saveVariant(db, m.id, 'thumb', 'webp', await sharp(src).rotate().resize({ width: 320, height: 240, fit: 'cover' }).webp({ quality: 70 }).toFile(absolute(thumbRel)), thumbRel);
      db.prepare("UPDATE cms_media SET width = ?, height = ?, status = 'ready', error = NULL WHERE id = ?").run(width, height, m.id);
      return;
    }

    // Document (PDF) : copie servie telle quelle, sous un nom lisible (carte-des-vins.pdf) précédé de l'empreinte
    if (m.kind === 'document') {
      const rel = variantPath(m, `${fileSlug(m.original_name) || 'document'}.${path.extname(m.storage_key).slice(1)}`);
      fs.copyFileSync(src, absolute(rel));
      saveVariant(db, m.id, 'original', path.extname(m.storage_key).slice(1), { size: m.bytes }, rel);
      db.prepare("UPDATE cms_media SET status = 'ready', error = NULL WHERE id = ?").run(m.id);
      return;
    }

    // Vidéo ou son : copie servie telle quelle, mesures et poster si ffmpeg est disponible
    const rel = variantPath(m, `original${path.extname(m.storage_key)}`);
    fs.copyFileSync(src, absolute(rel));
    let meta = { duration: null, width: null, height: null };
    let note = null;
    try {
      meta = await probe(src);
    } catch {
      note = 'ffprobe indisponible : durée inconnue.';
    }
    saveVariant(db, m.id, 'original', path.extname(m.storage_key).slice(1), { width: meta.width, height: meta.height, size: m.bytes }, rel);
    if (m.kind === 'video') {
      try {
        const at = String(Math.min(1, (meta.duration || 2) / 2));
        const png = await run(config.ffmpeg, ['-v', 'error', '-ss', at, '-i', src, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
        const posterRel = variantPath(m, 'poster.webp');
        saveVariant(db, m.id, 'poster', 'webp', await sharp(png).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toFile(absolute(posterRel)), posterRel);
        saveVariant(db, m.id, 'thumb', 'webp', await sharp(png).resize({ width: 320, height: 240, fit: 'cover' }).webp({ quality: 70 }).toFile(absolute(variantPath(m, 'thumb.webp'))), variantPath(m, 'thumb.webp'));
      } catch {
        note = 'ffmpeg indisponible : téléversez une image pour le poster.';
      }
    }
    db.prepare("UPDATE cms_media SET width = ?, height = ?, duration_s = ?, status = 'ready', error = ? WHERE id = ?")
      .run(meta.width, meta.height, meta.duration, note, m.id);
  } catch (err) {
    db.prepare("UPDATE cms_media SET status = 'error', error = ? WHERE id = ?").run(`Traitement impossible : ${err.message}`.slice(0, 500), m.id);
  }
}

/** Point d'intérêt modifié : nouveau recadrage portrait. */
export async function refreshPortrait(db, id) {
  const m = db.prepare('SELECT * FROM cms_media WHERE id = ?').get(id);
  if (!m || m.kind !== 'image' || !m.width) return;
  await portrait(db, m, path.join(config.uploadsDir, m.storage_key), m.width, m.height);
  await shareVariant(db, m, path.join(config.uploadsDir, m.storage_key), m.width, m.height);
}

/** Lien externe (YouTube, Vimeo, Spotify…) : enregistré tel quel, chargé au clic sur le site. */
export function providerOf(url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return 'youtube';
  if (/(^|\.)vimeo\.com$/.test(host)) return 'vimeo';
  if (/(^|\.)spotify\.com$/.test(host)) return 'spotify';
  if (/(^|\.)soundcloud\.com$/.test(host)) return 'soundcloud';
  return 'other';
}

/** Avertissements affichés dans l'admin (poids élevé pour une vidéo de fond, son lourd). */
export function warningsFor(m) {
  const w = [];
  if (m.kind === 'video' && m.bytes > config.warnMb.video * MB) w.push(`Vidéo de ${(m.bytes / MB).toFixed(1)} Mo : au-delà de ${config.warnMb.video} Mo, elle ralentit les connexions mobiles.`);
  if (m.kind === 'audio' && m.bytes > config.warnMb.audio * MB) w.push(`Son de ${(m.bytes / MB).toFixed(1)} Mo : au-delà de ${config.warnMb.audio} Mo conseillés.`);
  if (m.kind === 'document' && m.bytes > config.warnMb.document * MB) w.push(`Document de ${(m.bytes / MB).toFixed(1)} Mo : au-delà de ${config.warnMb.document} Mo, il est long à ouvrir sur un téléphone.`);
  if (m.error && m.status === 'ready') w.push(m.error);
  return w;
}
