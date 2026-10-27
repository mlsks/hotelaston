/**
 * Pays et région depuis une base GeoIP locale (DB-IP Lite, licence CC BY 4.0 :
 * « IP Geolocation by DB-IP », mention à faire figurer dans le tableau de bord).
 * La base est lue en mémoire ; aucune adresse IP n'est jamais envoyée ailleurs ni enregistrée.
 * Sans fichier .mmdb dans storage/geoip/, pays et région restent vides.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import maxmind from 'maxmind';
import { config } from '../config.js';

const DIR = path.join(config.storageDir, 'geoip');
let reader = null;
let loaded = false;

export async function loadGeoip({ log = () => {} } = {}) {
  loaded = true;
  if (!fs.existsSync(DIR)) return null;
  // Base « city » de préférence (pays + région), sinon « country »
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.mmdb')).sort((a, b) => Number(b.includes('city')) - Number(a.includes('city')));
  if (!files.length) return null;
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
export async function updateGeoip({ city = false, log = console.log } = {}) {
  const month = new Date().toISOString().slice(0, 7);
  const name = `dbip-${city ? 'city' : 'country'}-lite-${month}.mmdb`;
  const url = `https://download.db-ip.com/free/${name}.gz`;
  log(`Téléchargement de ${url}…`);
  const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`DB-IP : réponse ${res.status}`);
  fs.mkdirSync(DIR, { recursive: true });
  const buf = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()));
  const tmp = path.join(DIR, `${name}.tmp`);
  fs.writeFileSync(tmp, buf);
  for (const f of fs.readdirSync(DIR)) if (f.endsWith('.mmdb') && f.includes(city ? 'city' : 'country')) fs.rmSync(path.join(DIR, f));
  fs.renameSync(tmp, path.join(DIR, name));
  log(`Base GeoIP enregistrée : ${name} (${(buf.length / 1024 / 1024).toFixed(1)} Mo).`);
  return name;
}
