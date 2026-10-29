/**
 * Page « Mentions légales » (gabarit pages/mentions-legales.html), reprise de l'ancien site :
 * créée une fois après l'import, avec ses textes dans toutes les langues livrées
 * (seeds/mentions-legales-page.json) et son adresse dans chaque langue.
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
const SEED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seeds', 'mentions-legales-page.json');
// Code d'une langue du site → langue des traductions livrées
const SEED_ALIASES = { nb: 'no' };
// Réglage qui retient la création : une page supprimée ensuite n'est pas recréée
const CREATED = 'legal_page_seeded';
const FREE_HELP = 'Identique dans toutes les langues. Laisser vide tant que l’information n’est pas connue : la ligne est alors masquée sur le site.';

/**
 * Crée la page si elle n'a jamais été créée, puis les textes absents et les traductions qui manquent.
 * Une traduction livrée n'est « prête » que si le français de la base est celui qu'elle traduit ;
 * sinon elle arrive en brouillon, à relire. Une valeur déjà saisie n'est jamais remplacée.
 * @returns 1 si la page vient d'être créée, sinon 0
 */
export function ensureLegalPage(db, { seed = readSeed() } = {}) {
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  const home = db.prepare('SELECT id FROM cms_pages WHERE key = ?').pluck().get(seed?.page?.parent);
  if (!def || !home || !seed.page.i18n[def]) return 0; // site pas encore importé : créée après l'import
  const langs = db.prepare('SELECT code FROM cms_languages').pluck().all();
  const pageOf = db.prepare('SELECT * FROM cms_pages WHERE key = ?');
  const done = db.prepare('SELECT 1 FROM cms_settings WHERE key = ?').get(CREATED);
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
    db.prepare(`INSERT INTO cms_settings (key, value, updated_at) VALUES (?, 'true', ?) ON CONFLICT (key) DO NOTHING`).run(CREATED, now);
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

function readSeed() {
  return fs.existsSync(SEED) ? JSON.parse(fs.readFileSync(SEED, 'utf8')) : null;
}
