/**
 * Fichiers du site : CSS et JS renommés avec leur empreinte (cache long sans risque),
 * fichiers statiques (icônes, logos), manifeste et service worker adaptés aux adresses réelles.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { sha } from '../lib/util.js';

const FINGERPRINTED = ['styles.css', 'remotion-vanilla.js', 'popup.js', 'track.js'];

// track.js est livré précédé de web-vitals (Google, licence Apache 2.0) : un seul fichier
const require = createRequire(import.meta.url);
// (le paquet n'expose pas sa version « iife » : on la prend à côté de son point d'entrée)
const BUNDLES = { 'track.js': () => path.join(path.dirname(require.resolve('web-vitals')), 'web-vitals.iife.js') };

function readAsset(templatesDir, name) {
  const own = fs.readFileSync(path.join(templatesDir, 'assets', name));
  if (!BUNDLES[name]) return own;
  const vendor = fs.readFileSync(BUNDLES[name]()).toString('utf8').replace(/\/\/# sourceMappingURL=.*$/m, '');
  return Buffer.from(`/*! web-vitals — Apache-2.0 — https://github.com/GoogleChrome/web-vitals */\n${vendor}\n${own.toString('utf8')}`);
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(dir, path.join(d.parentPath, d.name)).split(path.sep).join('/'));
}

/** Prépare les fichiers à écrire et la correspondance « adresse du gabarit » → « adresse publiée ». */
export function prepareAssets({ templatesDir, mediaDir, basePath }) {
  const files = new Map();
  const urls = new Map();
  for (const name of FINGERPRINTED) {
    if (!fs.existsSync(path.join(templatesDir, 'assets', name))) continue;
    const buf = readAsset(templatesDir, name);
    const out = name.replace(/(\.[a-z]+)$/i, `.${sha(buf, 10)}$1`);
    files.set(`assets/${out}`, buf);
    urls.set(name, `${basePath}/assets/${out}`);
  }
  for (const rel of listFiles(path.join(templatesDir, 'static'))) {
    if (rel !== 'site.webmanifest') files.set(rel, fs.readFileSync(path.join(templatesDir, 'static', rel)));
    urls.set(rel, `${basePath}/${rel}`);
  }
  // Médias : servis depuis media/ (communs à toutes les versions), jamais copiés dans une version
  for (const rel of listFiles(mediaDir)) urls.set(`media/${rel}`, `/media/${rel}`);
  return { files, url: (ref) => urls.get(String(ref).split(/[?#]/)[0]) ?? null };
}

export function webManifest({ templatesDir, assets, basePath, defaultLang }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(templatesDir, 'static', 'site.webmanifest'), 'utf8'));
  manifest.start_url = `${basePath}/${defaultLang}/`;
  manifest.icons = (manifest.icons || []).map((icon) => ({ ...icon, src: assets.url(icon.src) ?? icon.src }));
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** sw.js : version et liste de pré-cache recalculées à chaque build. */
export function serviceWorker({ templatesDir, assets, basePath, defaultLang, version }) {
  let js = fs.readFileSync(path.join(templatesDir, 'assets', 'sw.js'), 'utf8');
  const list = /const PRECACHE = \[([\s\S]*?)\];/.exec(js);
  if (!list) throw new Error('sw.js : liste PRECACHE introuvable');
  const entries = [...list[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const mapped = [...new Set(entries.map((e) => (e === './' || e === 'index.html' ? `${basePath}/${defaultLang}/` : assets.url(e))).filter(Boolean))];
  js = js.replace(list[0], `const PRECACHE = ${JSON.stringify(mapped, null, 2).replace(/"/g, "'")};`);
  return js.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
}
