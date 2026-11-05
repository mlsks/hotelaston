/**
 * Pays et région depuis une base GeoIP locale (DB-IP Lite, licence CC BY 4.0 :
 * « IP Geolocation by DB-IP », mention à faire figurer dans le tableau de bord).
 * La base est lue en mémoire ; aucune adresse IP n'est jamais envoyée ailleurs ni enregistrée.
 * Sans fichier .mmdb dans storage/geoip/, pays et région restent vides.
 * Mise à jour automatique (GEOIP_UPDATE, activée par défaut) : téléchargement au démarrage si
 * la base manque, puis chaque nuit dès que la base du mois est publiée ; rechargée sans redémarrage.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import maxmind from 'maxmind';
import { config } from '../config.js';

const DIR = path.join(config.storageDir, 'geoip');
let reader = null;
let loaded = false;

const mmdbFiles = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.mmdb')) : []);

export async function loadGeoip({ log = () => {} } = {}) {
  loaded = true;
  // Base « city » de préférence (pays + région), sinon « country »
  const files = mmdbFiles().sort((a, b) => Number(b.includes('city')) - Number(a.includes('city')));
  if (!files.length) return null;
  // La base est lue entièrement en mémoire : le fichier peut ensuite être remplacé
  reader = await maxmind.open(path.join(DIR, files[0]));
  log(`GeoIP : ${files[0]}`);
  return files[0];
}

/** Pour les tests : lecteur factice { get(ip) }. */
export function setGeoReader(r) {
  reader = r;
  loaded = true;
}

export function geoOf(ip) {
  if (!reader || !ip) return { country: null, region: null };
  try {
    const rec = reader.get(ip);
    const sub = rec?.subdivisions?.[0];
    return {
      country: rec?.country?.iso_code || null,
      // Jamais plus précis que la région (pas de ville)
      region: sub ? (sub.iso_code ? `${rec.country?.iso_code}-${sub.iso_code}` : sub.names?.en || null) : null,
    };
  } catch {
    return { country: null, region: null };
  }
}

export const geoipLoaded = () => loaded;
/** Une base est-elle lue ? (le tableau de bord affiche alors la mention DB-IP) */
export const geoipActive = () => Boolean(reader);

/**
 * Télécharge la base DB-IP Lite du mois (pays, ou pays + région avec city = true).
 * Mise à jour conseillée chaque mois.
 */
export async function updateGeoip({ city = false, log = console.log, month = currentMonth(), fetchImpl = fetch } = {}) {
  const name = `dbip-${city ? 'city' : 'country'}-lite-${month}.mmdb`;
  const url = `https://download.db-ip.com/free/${name}.gz`;
  log(`Téléchargement de ${url}…`);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`DB-IP : réponse ${res.status}`);
  fs.mkdirSync(DIR, { recursive: true });
  const buf = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()));
  const tmp = path.join(DIR, `${name}.tmp`);
  fs.writeFileSync(tmp, buf);
  // Fichier illisible (téléchargement tronqué…) : l'ancienne base reste en place
  try {
    await maxmind.open(tmp);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`DB-IP : fichier reçu illisible (${err.message})`);
  }
  for (const f of fs.readdirSync(DIR)) if (f.endsWith('.mmdb') && f.includes(city ? 'city' : 'country')) fs.rmSync(path.join(DIR, f));
  fs.renameSync(tmp, path.join(DIR, name));
  log(`Base GeoIP enregistrée : ${name} (${(buf.length / 1024 / 1024).toFixed(1)} Mo).`);
  return name;
}

const currentMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Que faire de la base installée ? Garde l'édition déjà en place (city ou country) ;
 * sinon `edition` (GEOIP_EDITION), par défaut country. `update` : vrai si la base manque
 * ou date d'un mois précédent.
 */
export function planGeoipUpdate(files, month, edition = '') {
  const bases = files.map((f) => /^dbip-(city|country)-lite-(\d{4}-\d{2})\.mmdb$/.exec(f)).filter(Boolean);
  const installed = bases.find((m) => m[1] === 'city') || bases.find((m) => m[1] === 'country');
  const city = installed ? installed[1] === 'city' : edition === 'city';
  // Un fichier .mmdb d'une autre origine (posé à la main) n'est jamais remplacé
  if (!installed && files.length) return { update: false, city };
  return { update: !installed || installed[2] < month, city };
}

let refreshing = null;

/**
 * Télécharge la base du mois si besoin, puis la recharge en mémoire. Ne lève jamais d'erreur :
 * si DB-IP n'a pas encore publié le mois (début de mois) ou ne répond pas, l'ancienne base reste
 * en service et l'essai reprend la nuit suivante.
 */
export function refreshGeoip({ edition = '', log = () => {}, fetchImpl = fetch } = {}) {
  refreshing ||= (async () => {
    const plan = planGeoipUpdate(mmdbFiles(), currentMonth(), edition);
    if (!plan.update) return null;
    try {
      const name = await updateGeoip({ city: plan.city, log, fetchImpl });
      await loadGeoip({ log });
      return name;
    } catch (err) {
      log(`GeoIP : mise à jour impossible pour le moment (${err.message}), nouvel essai la nuit prochaine.`);
      return null;
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}
