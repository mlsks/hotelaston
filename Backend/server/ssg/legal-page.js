/**
 * Pages « Mentions légales » et « Politique de confidentialité » (gabarits pages/<clé>.html) :
 * créées une fois après l'import, avec leurs textes dans toutes les langues livrées
 * (seeds/mentions-legales-page.json, seeds/politique-de-confidentialite-page.json)
 * et leur adresse dans chaque langue.
 *
 * Les coordonnées de l'hébergeur et le directeur de la publication sont des textes facultatifs,
 * identiques dans toutes les langues et livrés vides : tant qu'ils le sont, leur ligne est masquée
 * (data-cms-optional, voir render.js). L'identité de la société reprend le texte commun du pied de page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha, nowIso } from '../lib/util.js';

export const LEGAL_PAGE = 'mentions-legales';
export const PRIVACY_PAGE = 'politique-de-confidentialite';
const SEEDS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seeds');
// Code d'une langue du site → langue des traductions livrées
const SEED_ALIASES = { nb: 'no' };
// Réglage qui retient la création : une page supprimée ensuite n'est pas recréée
const CREATED = { [LEGAL_PAGE]: 'legal_page_seeded', [PRIVACY_PAGE]: 'privacy_page_seeded' };
// Liens vers la politique de l'ancien site (pied de page, formulaire de devis), dans toutes les langues
const OLD_PRIVACY_URL = /https?:\/\/(?:www\.)?hotel-aston\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:politique-de-confidentialite|privacy-policy)\/?/g;
const FREE_HELP = 'Identique dans toutes les langues. Laisser vide tant que l’information n’est pas connue : la ligne est alors masquée sur le site.';

/**
 * Crée la page si elle n'a jamais été créée, puis les textes absents et les traductions qui manquent.
 * Une traduction livrée n'est « prête » que si le français de la base est celui qu'elle traduit ;
 * sinon elle arrive en brouillon, à relire. Une valeur déjà saisie n'est jamais remplacée.
 * @returns 1 si la page vient d'être créée, sinon 0
 */
export function ensureLegalPage(db, { seed = readSeed(LEGAL_PAGE) } = {}) {
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  const home = db.prepare('SELECT id FROM cms_pages WHERE key = ?').pluck().get(seed?.page?.parent);
  if (!def || !home || !seed.page.i18n[def]) return 0; // site pas encore importé : créée après l'import
  const langs = db.prepare('SELECT code FROM cms_languages').pluck().all();
  const pageOf = db.prepare('SELECT * FROM cms_pages WHERE key = ?');
  const flag = CREATED[seed.page.key] || `${seed.page.key}_page_seeded`;
  const done = db.prepare('SELECT 1 FROM cms_settings WHERE key = ?').get(flag);
  const tr = (byLang, lang) => byLang[lang] ?? byLang[SEED_ALIASES[lang]];
  const metaHash = (p) => sha(`${p.title}\n${p.description}`);
  const now = nowIso();
  let created = 0;

  db.transaction(() => {
    const src = seed.page.i18n[def];
    if (!pageOf.get(seed.page.key) && !done) {
      const id = db.prepare(`INSERT INTO cms_pages (key, template, parent_id, in_sitemap, is_active, position, created_at, updated_at)
        VALUES (?, ?, ?, 1, 1, (SELECT COALESCE(MAX(position), 0) + 1 FROM cms_pages), ?, ?)`).run(seed.page.key, `pages/${seed.page.key}.html`, home, now, now).lastInsertRowid;
      db.prepare(`INSERT OR IGNORE INTO cms_page_i18n (page_id, lang, slug, path, title, meta_description, status, source_hash, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?)`).run(id, def, src.slug, `/${def}/${src.slug}/`, src.title, src.description, metaHash(src), now);
      created = 1;
    }
    db.prepare(`INSERT INTO cms_settings (key, value, updated_at) VALUES (?, 'true', ?) ON CONFLICT (key) DO NOTHING`).run(flag, now);
    const page = pageOf.get(seed.page.key);
    if (!page) return;

    // Adresse et title dans chaque langue (une adresse déjà prise par une autre page est laissée de côté)
    const defMeta = db.prepare('SELECT title, meta_description AS description FROM cms_page_i18n WHERE page_id = ? AND lang = ?').get(page.id, def);
    const sameMeta = defMeta && defMeta.title === src.title && defMeta.description === src.description;
    const insMeta = db.prepare(`INSERT OR IGNORE INTO cms_page_i18n (page_id, lang, slug, path, title, meta_description, status, source_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const lang of langs) {
      const m = lang === def ? null : tr(seed.page.i18n, lang);
      if (m) insMeta.run(page.id, lang, m.slug, `/${lang}/${m.slug}/`, m.title, m.description, sameMeta ? 'ready' : 'draft', metaHash(src), now);
    }

    const entryId = db.prepare('SELECT id FROM cms_entries WHERE key = ?').pluck();
    const insEntry = db.prepare(`INSERT INTO cms_entries (key, page_id, section, type, label, help, translatable, required, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const valueOf = db.prepare('SELECT value FROM cms_entry_values WHERE entry_id = ? AND lang = ?').pluck();
    const insValue = db.prepare(`INSERT INTO cms_entry_values (entry_id, lang, value, status, source_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (entry_id, lang) DO NOTHING`);
    Object.entries(seed.entries).forEach(([key, e], i) => {
      const source = e.values[def];
      if (source === undefined) return;
      let id = entryId.get(key);
      if (!id) {
        id = insEntry.run(key, page.id, e.section, e.type, e.label, e.translatable ? null : FREE_HELP, e.translatable, e.required, i, now, now).lastInsertRowid;
        insValue.run(id, def, source, 'ready', sha(source), now);
      }
      if (!e.translatable) return;
      const same = valueOf.get(id, def) === source;
      for (const lang of langs) {
        if (lang === def) continue;
        const value = tr(e.values, lang);
        if (value) insValue.run(id, lang, value, same ? 'ready' : 'draft', sha(source), now);
      }
    });
  })();
  return created;
}

/** Page Politique de confidentialité, puis liens de l'ancien site redirigés vers elle. */
export function ensurePrivacyPage(db, { seed = readSeed(PRIVACY_PAGE) } = {}) {
  const created = ensureLegalPage(db, { seed });
  if (db.prepare('SELECT 1 FROM cms_pages WHERE key = ?').get(PRIVACY_PAGE)) relinkOldPrivacy(db);
  return created;
}

/**
 * Remplace l'adresse de l'ancienne politique (hotel-aston.com/fr/politique-de-confidentialite…)
 * par un lien vers la nouvelle page dans les textes déjà en base. Une traduction qui suivait le
 * français le suit encore : son empreinte de source passe à celle du nouveau texte.
 */
function relinkOldPrivacy(db) {
  const rows = db.prepare(`SELECT v.entry_id, v.lang, v.value, v.source_hash FROM cms_entry_values v
    WHERE v.value LIKE '%hotel-aston.com%' AND (v.value LIKE '%politique-de-confidentialite%' OR v.value LIKE '%privacy-policy%')`).all();
  if (!rows.length) return;
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  const update = db.prepare('UPDATE cms_entry_values SET value = ?, source_hash = COALESCE(?, source_hash) WHERE entry_id = ? AND lang = ?');
  const follow = db.prepare('UPDATE cms_entry_values SET source_hash = ? WHERE entry_id = ? AND lang <> ? AND source_hash = ?');
  const link = `#/${PRIVACY_PAGE}`;
  db.transaction(() => {
    for (const r of rows) {
      const value = r.value.replace(OLD_PRIVACY_URL, link);
      if (value === r.value) continue;
      if (r.lang !== def) { update.run(value, null, r.entry_id, r.lang); continue; }
      update.run(value, sha(value), r.entry_id, r.lang);
      follow.run(sha(value), r.entry_id, def, sha(r.value));
    }
  })();
}

function readSeed(key) {
  const file = path.join(SEEDS, `${key}-page.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}
