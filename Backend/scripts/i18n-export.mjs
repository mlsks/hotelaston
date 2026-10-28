/**
 * Exporte en JSON tous les textes traduisibles de la langue par défaut (base de travail), pour une traduction hors ligne.
 *   node scripts/i18n-export.mjs [fichier]      (par défaut storage/translations/source.<langue>.json)
 * Le fichier traduit garde la même forme ; il se réimporte avec scripts/i18n-import.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../server/db/connection.js';
import { config } from '../server/config.js';

const db = getDb();
const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
const out = process.argv[2] || path.join(config.storageDir, 'translations', `source.${def}.json`);

const entries = {};
for (const r of db.prepare(`SELECT e.id, e.key, e.max_length, v.value FROM cms_entries e
    JOIN cms_entry_values v ON v.entry_id = e.id AND v.lang = ?
    WHERE e.translatable = 1 AND e.type IN ('text', 'richtext') AND v.value IS NOT NULL AND v.value <> ''
    ORDER BY e.page_id IS NOT NULL, e.page_id, e.position, e.id`).all(def)) {
  entries[r.id] = r.max_length ? { key: r.key, max: r.max_length, value: r.value } : { key: r.key, value: r.value };
}

const pages = {};
for (const r of db.prepare(`SELECT p.id, p.key, t.slug, t.nav_label, t.title, t.meta_description, t.og_title, t.og_description, t.focus_keyword
    FROM cms_pages p JOIN cms_page_i18n t ON t.page_id = p.id AND t.lang = ? ORDER BY p.position, p.id`).all(def)) {
  const { id, ...rest } = r;
  pages[id] = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null && v !== ''));
}

const items = {};
for (const r of db.prepare(`SELECT i.id, i.collection, i.key, c.item_template, t.slug, t.data FROM cms_items i
    JOIN cms_collections c ON c.key = i.collection
    JOIN cms_item_i18n t ON t.item_id = i.id AND t.lang = ? ORDER BY i.collection, i.position, i.id`).all(def)) {
  const data = JSON.parse(r.data);
  if (!Object.values(data).some((v) => v !== '' && !(Array.isArray(v) && !v.length))) continue;
  items[r.id] = { collection: r.collection, key: r.key, ...(r.item_template ? { slug: r.slug } : {}), data };
}

const media = {};
for (const r of db.prepare(`SELECT m.id, t.alt, t.title, t.caption FROM cms_media m JOIN cms_media_i18n t ON t.media_id = m.id AND t.lang = ?
    WHERE m.deleted_at IS NULL ORDER BY m.id`).all(def)) {
  const row = Object.fromEntries(Object.entries({ alt: r.alt, title: r.title, caption: r.caption }).filter(([, v]) => v));
  if (Object.keys(row).length) media[r.id] = row;
}

const banners = {};
for (const r of db.prepare('SELECT banner_id, text, cta_label FROM cms_banner_i18n WHERE lang = ?').all(def)) {
  banners[r.banner_id] = r.cta_label ? { text: r.text, cta_label: r.cta_label } : { text: r.text };
}

const popups = {};
for (const r of db.prepare('SELECT popup_id, title, body, cta_label FROM cms_popup_i18n WHERE lang = ?').all(def)) {
  popups[r.popup_id] = Object.fromEntries(Object.entries({ title: r.title, body: r.body, cta_label: r.cta_label }).filter(([, v]) => v));
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ lang: def, entries, pages, items, media, banners, popups }, null, 1));
const n = (o) => Object.keys(o).length;
console.log(`${out} : ${n(entries)} textes, ${n(pages)} pages, ${n(items)} fiches, ${n(media)} médias, ${n(banners)} bandeaux, ${n(popups)} popups`);
