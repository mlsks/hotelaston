/**
 * Données structurées dans toutes les langues : le réglage jsonld_graph, autrefois un graphe figé par langue
 * (le français seulement), devient un modèle unique dont les valeurs traduisibles renvoient à des textes
 * « jsonld.* » (Textes → Données structurées) et les adresses aux pages du site ({{url:page}}).
 * Les traductions des textes repris du graphe français sont livrées dans seeds/jsonld.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha, nowIso } from '../lib/util.js';

const SECTION = 'Données structurées (JSON-LD)';
const SEED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seeds', 'jsonld.json');
// Code d'une langue du site → langue des traductions livrées
const SEED_ALIASES = { nb: 'no' };

/**
 * Nœuds du graphe (fin de leur @id) : textes traduisibles et pages liées.
 * [propriété, clé, libellé] ; « [] » : chaque élément d'une liste, numéroté à partir de 1.
 */
const NODES = {
  website: { urls: { url: 'accueil' }, inLanguage: true },
  hotel: {
    urls: { url: 'accueil' },
    texts: [['description', 'jsonld.hotel.description', "Hôtel : description"], ['amenityFeature[].name', 'jsonld.hotel.equipement-{n}', 'Hôtel : équipement {n}']],
  },
  horloge: {
    urls: { url: 'restaurant-horloge', hasMenu: 'menu-restaurant-horloge' },
    texts: [['description', 'jsonld.horloge.description', 'Restaurant L’Horloge : description'],
      ['servesCuisine[]', 'jsonld.horloge.cuisine-{n}', 'Restaurant L’Horloge : cuisine {n}'],
      ['priceRange', 'jsonld.horloge.prix', 'Restaurant L’Horloge : gamme de prix']],
  },
  moonbar: {
    urls: { url: 'moon-bar', hasMenu: 'carte-moon-bar' },
    texts: [['name', 'jsonld.moonbar.nom', 'Moon Bar : nom'], ['description', 'jsonld.moonbar.description', 'Moon Bar : description']],
  },
  astonclub: {
    urls: { url: 'aston-club' },
    texts: [['description', 'jsonld.astonclub.description', 'L’Aston Club : description']],
  },
};

const isOldFormat = (g) => g && typeof g === 'object' && !Array.isArray(g['@graph']);

/** Remplace les textes d'un nœud par {{clé}} ; add(key, value, label) crée le texte. */
function templateNode(node, spec, pages, add) {
  const out = { ...node };
  for (const [prop, key, label] of spec.texts || []) {
    const m = /^(\w+)\[\](?:\.(\w+))?$/.exec(prop);
    if (!m) {
      if (typeof out[prop] !== 'string' || !out[prop]) continue;
      add(key, out[prop], label);
      out[prop] = `{{${key}}}`;
      continue;
    }
    const [, list, field] = m;
    if (!Array.isArray(out[list])) continue;
    out[list] = out[list].map((el, i) => {
      const n = String(i + 1);
      const k = key.replace('{n}', n);
      const l = label.replace('{n}', n);
      if (!field) {
        if (typeof el !== 'string' || !el) return el;
        add(k, el, l);
        return `{{${k}}}`;
      }
      if (!el || typeof el[field] !== 'string' || !el[field]) return el;
      add(k, el[field], l);
      return { ...el, [field]: `{{${k}}}` };
    });
  }
  // Adresses dans la langue de la page ; une page absente de la base n'est pas liée
  for (const [prop, page] of Object.entries(spec.urls || {})) {
    if (pages.has(page)) out[prop] = `{{url:${page}}}`;
  }
  if (spec.inLanguage) out.inLanguage = '{{inLanguage}}';
  return out;
}

/**
 * Convertit l'ancien réglage (une fois) et complète les traductions livrées qui manquent.
 * Une traduction livrée n'est « prête » que si le français de la base est celui qu'elle traduit ;
 * sinon elle arrive en brouillon, à relire.
 * @returns nombre de textes créés
 */
export function ensureJsonLd(db, { seed = readSeed() } = {}) {
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  const row = db.prepare("SELECT value FROM cms_settings WHERE key = 'jsonld_graph'").pluck().get();
  if (!def || !row) return 0;
  const setting = JSON.parse(row);
  const langs = db.prepare('SELECT code FROM cms_languages').pluck().all();
  const now = nowIso();
  const entryId = db.prepare('SELECT id FROM cms_entries WHERE key = ?').pluck();
  const insEntry = db.prepare(`INSERT INTO cms_entries (key, page_id, section, type, label, translatable, required, position, created_at, updated_at)
    VALUES (?, NULL, ?, 'text', ?, 1, 1, ?, ?, ?)`);
  const valueOf = db.prepare('SELECT value FROM cms_entry_values WHERE entry_id = ? AND lang = ?').pluck();
  const insValue = db.prepare(`INSERT INTO cms_entry_values (entry_id, lang, value, status, source_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (entry_id, lang) DO NOTHING`);
  let added = 0;

  db.transaction(() => {
    if (isOldFormat(setting)) {
      const old = setting[def] || Object.values(setting)[0];
      if (!old?.['@graph']) return;
      const pages = new Set(db.prepare('SELECT key FROM cms_pages').pluck().all());
      let position = 11000;
      const add = (key, value, label) => {
        if (entryId.get(key)) return;
        const id = insEntry.run(key, SECTION, label, position++, now, now).lastInsertRowid;
        insValue.run(id, def, value, 'ready', sha(value), now);
        added += 1;
      };
      const graph = old['@graph'].map((node) => {
        const spec = NODES[String(node['@id'] || '').split('#')[1]];
        return spec ? templateNode(node, spec, pages, add) : node;
      });
      db.prepare("UPDATE cms_settings SET value = ?, updated_at = ? WHERE key = 'jsonld_graph'")
        .run(JSON.stringify({ '@context': old['@context'] || 'https://schema.org', '@graph': graph }), now);
    }
    // Traductions livrées : seulement là où la langue n'a encore rien
    for (const [key, byLang] of Object.entries(seed)) {
      const id = entryId.get(key);
      if (!id) continue;
      const fr = valueOf.get(id, def);
      if (!fr || !byLang[def]) continue;
      const same = fr === byLang[def];
      for (const lang of langs) {
        if (lang === def) continue;
        const value = byLang[lang] ?? byLang[SEED_ALIASES[lang]];
        if (!value) continue;
        insValue.run(id, lang, value, same ? 'ready' : 'draft', sha(byLang[def]), now);
      }
    }
  })();
  return added;
}

function readSeed() {
  return fs.existsSync(SEED) ? JSON.parse(fs.readFileSync(SEED, 'utf8')) : {};
}
