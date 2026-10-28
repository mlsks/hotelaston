/**
 * Photos du site actuel → médiathèque.
 *
 * Le site importé lit encore ses photos sur le CDN de hotel-aston.com (et de la Résidence).
 * Cette commande, relançable sans risque :
 *  1. remplace dans les gabarits chaque <img src="…cloudfront…"> par <img data-cms-media="clé">
 *     et note la photo d'origine dans templates-src/photos.json (versionné) ;
 *  2. télécharge chaque photo une seule fois (la plus grande taille utilisée sur le site),
 *     la fait passer par le pipeline (WebP, recadrage portrait) et la range dans la médiathèque ;
 *  3. relie les clés des gabarits, les photos des fiches chambre, service et offre, l'image de partage
 *     et les images des données structurées aux médias.
 * Sur une base neuve (import sur un dépôt cloné), elle refait les étapes 2 et 3 depuis photos.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from '../config.js';
import { nowIso } from '../lib/util.js';
import { ingestUpload, waitFor, shareImagePath } from './pipeline.js';

const CDN_RE = /^https:\/\/[a-z0-9]+\.cloudfront\.net\/cache\/img\//;
const IMG_TAG = /<img\b[^>]*>/g;
const MANIFEST = 'photos.json';

/** Photo d'origine : même numéro sur le CDN = même photo, quelle que soit la taille demandée. */
function identify(url) {
  const m = /^https:\/\/([^/]+)\/.*-(\d+)-(\d+)-(\d+)-[a-z]+\.\w+$/.exec(url);
  return m ? { id: `${m[1]}#${m[2]}`, area: Number(m[3]) * Number(m[4]) } : { id: url, area: 0 };
}

const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/\s([\w:@-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Tailles d'affichage par défaut (les héros gardent les leurs). */
function sizesFor(file, attrs) {
  if (attrs.sizes) return attrs.sizes;
  if (file === 'layout.html') return '160px';
  if (file === 'pages/seminaires.html' && attrs.alt === '') return '(min-width: 700px) 96px, 100vw';
  return '(min-width: 1100px) 50vw, 100vw';
}

function readManifest(dir) {
  const file = path.join(dir, MANIFEST);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

/** Étape 1 : gabarits. Renvoie le manifeste { clé: { url, alt, page } }. */
export function convertTemplates(dir = config.templatesDir, { log = () => {} } = {}) {
  const manifestFile = path.join(dir, MANIFEST);
  const manifest = readManifest(dir);
  const files = ['layout.html', ...fs.readdirSync(path.join(dir, 'pages')).filter((f) => f.endsWith('.html')).sort().map((f) => `pages/${f}`)];
  let changed = 0;
  for (const file of files) {
    const full = path.join(dir, file);
    const html = fs.readFileSync(full, 'utf8');
    const page = file === 'layout.html' ? null : path.basename(file, '.html');
    const prefix = page || 'global';
    let n = Object.keys(manifest).filter((k) => k.startsWith(`${prefix}.photo-`)).length;
    const out = html.replace(IMG_TAG, (tag) => {
      const attrs = attrsOf(tag);
      if (!CDN_RE.test(attrs.src || '')) return tag;
      const candidates = [attrs.src, ...(attrs.srcset || '').split(',').map((p) => p.trim().split(/\s+/)[0]).filter(Boolean)];
      const url = candidates.sort((a, b) => identify(b).area - identify(a).area)[0];
      const key = file === 'layout.html' ? 'global.logo' : `${prefix}.photo-${++n}`;
      manifest[key] = { url, alt: decode(attrs.alt || ''), page };
      const keep = Object.entries(attrs).filter(([k]) => !['src', 'srcset', 'sizes', 'width', 'height', 'decoding'].includes(k));
      const extra = [`data-cms-media="${key}"`, `data-cms-sizes="${sizesFor(file, attrs)}"`];
      if (attrs.alt === '') extra.push('data-cms-decorative');
      if (!attrs.srcset) extra.push('data-cms-portrait="off"'); // seuls les grands visuels de tête ont un recadrage pour téléphone
      changed += 1;
      return `<img ${[...extra, ...keep.map(([k, v]) => `${k}="${v}"`)].join(' ')}>`;
    });
    if (out !== html) fs.writeFileSync(full, out);
  }
  // L'ancien CDN n'est plus contacté : plus besoin de préconnexion
  const layout = path.join(dir, 'layout.html');
  const lhtml = fs.readFileSync(layout, 'utf8');
  const lout = lhtml.replace(/\n?[ \t]*<link rel="preconnect" href="https:\/\/[a-z0-9]+\.cloudfront\.net"[^>]*>/, '');
  if (lout !== lhtml) fs.writeFileSync(layout, lout);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  if (changed) log(`Gabarits : ${changed} image(s) basculée(s) sur la médiathèque.`);
  return manifest;
}

/** Télécharge une photo et la fait entrer dans la médiathèque (doublon = média existant). */
async function ingestUrl(db, url, folder, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  const { id } = await ingestUpload(db, { stream: Readable.fromWeb(res.body), filename: decodeURIComponent(url.split('/').pop()), folder });
  await waitFor(id);
  const m = db.prepare('SELECT status, error FROM cms_media WHERE id = ?').get(id);
  if (m.status !== 'ready') throw new Error(`${url} : ${m.error || m.status}`);
  return id;
}

/** URL publique absolue d'un média (grande taille), pour l'image de partage et le JSON-LD. */
function publicUrl(db, mediaId) {
  const paths = db.prepare("SELECT path FROM cms_media_variants WHERE media_id = ? AND purpose LIKE 'w%' AND format = 'webp' ORDER BY width = 1600 DESC, width DESC").pluck().all(mediaId);
  return `${config.siteUrl}/media/${paths[0]}`;
}

/** Étapes 2 et 3 : base de données. */
export async function importSitePhotos(db, { dir = config.templatesDir, convert = true, fetchImpl = fetch, log = () => {} } = {}) {
  const manifest = convert ? convertTemplates(dir, { log }) : readManifest(dir);
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM cms_settings').all().map((r) => [r.key, JSON.parse(r.value)]));
  const cdn = settings.cdn_base || '';
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get() || 'fr';

  /* Ce qu'il faut relier : une demande = { url, alt, folder } */
  const wanted = [];
  const pageIds = new Map(db.prepare('SELECT key, id FROM cms_pages').all().map((p) => [p.key, p.id]));
  const entryRow = db.prepare('SELECT e.id, v.media_id FROM cms_entries e LEFT JOIN cms_entry_values v ON v.entry_id = e.id AND v.lang = ? WHERE e.key = ?');
  for (const [key, m] of Object.entries(manifest)) {
    if (!entryRow.get(def, key)?.media_id) wanted.push({ url: m.url, alt: m.alt, folder: `/site/${m.page || 'commun'}` });
  }
  const items = db.prepare("SELECT id, collection, key, data FROM cms_items WHERE collection IN ('rooms', 'services')").all()
    .map((it) => ({ ...it, data: JSON.parse(it.data), field: it.collection === 'rooms' ? 'gallery' : 'photos' }));
  const altOf = (it, i) => {
    const tr = db.prepare('SELECT data FROM cms_item_i18n WHERE item_id = ? AND lang = ?').pluck().get(it.id, def);
    return tr ? JSON.parse(tr)[it.field]?.[i]?.alt || '' : '';
  };
  for (const it of items) {
    (it.data[it.field] || []).forEach((row, i) => {
      if (!row.media && row.src) wanted.push({ url: /^https?:/.test(row.src) ? row.src : cdn + row.src, alt: altOf(it, i), folder: `/site/${it.collection === 'rooms' ? 'chambres' : 'services'}` });
    });
  }
  // Offres et salles de séminaire : une photo par fiche (media), encore à l'adresse du CDN (src) sur une base neuve
  const offers = db.prepare("SELECT id, collection, data FROM cms_items WHERE collection IN ('offers', 'meeting_rooms')").all().map((it) => ({ ...it, data: JSON.parse(it.data) }));
  for (const it of offers) if (!it.data.media && it.data.src) wanted.push({ url: /^https?:/.test(it.data.src) ? it.data.src : cdn + it.data.src, alt: '', folder: it.collection === 'offers' ? '/site/offres' : '/site/seminaires' });
  const settingUrls = new Set();
  const collect = (v) => {
    if (typeof v === 'string' && CDN_RE.test(v)) settingUrls.add(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(settings.og_image_default);
  collect(settings.jsonld_graph);
  for (const url of settingUrls) wanted.push({ url, alt: '', folder: '/site/commun' });

  /* Une seule photo téléchargée par numéro du CDN : la plus grande taille demandée quelque part */
  const best = new Map();
  for (const w of wanted) {
    const { id, area } = identify(w.url);
    const cur = best.get(id);
    if (!cur || area > cur.area) best.set(id, { ...w, area, alt: w.alt || cur?.alt || '' });
    else if (!cur.alt && w.alt) cur.alt = w.alt;
  }
  const mediaOf = new Map(); // identité CDN → id du média
  let done = 0;
  for (const [id, w] of best) {
    const mediaId = await ingestUrl(db, w.url, w.folder, fetchImpl);
    mediaOf.set(id, mediaId);
    if (w.alt && !db.prepare('SELECT alt FROM cms_media_i18n WHERE media_id = ? AND lang = ?').pluck().get(mediaId, def)) {
      db.prepare(`INSERT INTO cms_media_i18n (media_id, lang, alt, status) VALUES (?, ?, ?, 'ready')
        ON CONFLICT (media_id, lang) DO UPDATE SET alt = excluded.alt, status = 'ready'`).run(mediaId, def, w.alt);
    }
    done += 1;
    if (done % 10 === 0) log(`Photos : ${done} / ${best.size}…`);
  }
  const media = (url) => mediaOf.get(identify(url).id);

  /* Liens */
  const now = nowIso();
  db.transaction(() => {
    let position = db.prepare('SELECT COALESCE(MAX(position), 0) FROM cms_entries').pluck().get();
    const insEntry = db.prepare(`INSERT INTO cms_entries (key, page_id, section, type, label, translatable, required, position, created_at, updated_at)
      VALUES (?, ?, 'Photos', 'media', ?, 0, 1, ?, ?, ?) ON CONFLICT (key) DO NOTHING`);
    const setValue = db.prepare(`INSERT INTO cms_entry_values (entry_id, lang, value, media_id, status, source_hash, updated_at) VALUES (?, ?, NULL, ?, 'ready', '', ?)
      ON CONFLICT (entry_id, lang) DO UPDATE SET media_id = excluded.media_id, value = NULL, status = 'ready', updated_at = excluded.updated_at`);
    for (const [key, m] of Object.entries(manifest)) {
      const label = m.alt ? `Photo : ${m.alt.length > 70 ? `${m.alt.slice(0, 69)}…` : m.alt}` : `Photo ${key.split('-').pop()}`;
      insEntry.run(key, m.page ? pageIds.get(m.page) ?? null : null, key === 'global.logo' ? 'Logo du pied de page' : label, ++position, now, now);
      const row = entryRow.get(def, key);
      if (!row.media_id && media(m.url)) setValue.run(row.id, def, media(m.url), now);
    }
    const saveItem = db.prepare('UPDATE cms_items SET data = ?, updated_at = ? WHERE id = ?');
    for (const it of items) {
      let touched = false;
      for (const row of it.data[it.field] || []) {
        if (row.media || !row.src) continue;
        const id = media(/^https?:/.test(row.src) ? row.src : cdn + row.src);
        if (!id) continue;
        row.media = id;
        delete row.src;
        touched = true;
      }
      if (touched) saveItem.run(JSON.stringify(it.data), now, it.id);
    }
    for (const it of offers) {
      const id = !it.data.media && it.data.src ? media(/^https?:/.test(it.data.src) ? it.data.src : cdn + it.data.src) : null;
      if (!id) continue;
      const { src, ...data } = it.data;
      saveItem.run(JSON.stringify({ ...data, media: id }), now, it.id);
    }
    const swap = (v) => {
      if (typeof v === 'string') return CDN_RE.test(v) && media(v) ? publicUrl(db, media(v)) : v;
      if (Array.isArray(v)) return v.map(swap);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
      return v;
    };
    const saveSetting = db.prepare('UPDATE cms_settings SET value = ?, updated_at = ? WHERE key = ?');
    for (const key of ['og_image_default', 'jsonld_graph']) {
      if (settings[key] === undefined) continue;
      const next = swap(settings[key]);
      if (JSON.stringify(next) !== JSON.stringify(settings[key])) saveSetting.run(JSON.stringify(next), now, key);
    }
  })();
  /* Image de partage par défaut : variante JPEG 1200×630 (aussi pour une base déjà basculée en WebP) */
  const og = db.prepare("SELECT value FROM cms_settings WHERE key = 'og_image_default'").pluck().get();
  const ogUrl = og ? JSON.parse(og) : null;
  const ogHash = /\/media\/v\/([0-9a-f]{16})-(?!share-)[^/]+$/.exec(ogUrl || '')?.[1];
  const ogMedia = ogHash && db.prepare('SELECT id FROM cms_media WHERE substr(sha256, 1, 16) = ? AND deleted_at IS NULL').pluck().get(ogHash);
  const share = ogMedia && await shareImagePath(db, ogMedia);
  if (share) {
    db.prepare("UPDATE cms_settings SET value = ?, updated_at = ? WHERE key = 'og_image_default'").run(JSON.stringify(`${config.siteUrl}/media/${share}`), nowIso());
    log('Image de partage : JPEG 1200×630.');
  }
  log(`Médiathèque : ${best.size} photo(s) traitée(s), ${Object.keys(manifest).length} emplacement(s) dans les gabarits.`);
  return { photos: best.size, slots: Object.keys(manifest).length };
}
