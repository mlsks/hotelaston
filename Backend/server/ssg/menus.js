/**
 * Cartes du restaurant et des bars : une page par carte (gabarit commun pages/carte.html),
 * dont le contenu vient d'un élément de la collection « menus » (clé = clé de la page).
 *
 * Élément : data = { page, venue, sections: [{ dishes: [{ price }] }] } ;
 * traduits : title, subtitle, backLabel, note, sections[].title, sections[].dishes[].name / .desc.
 * Un plat ou une rubrique pas encore traduits s'affichent dans la langue par défaut.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeTranslation } from './collections.js';
import { nowIso, sha } from '../lib/util.js';

export const MENUS = 'menus';
export const MENU_TEMPLATE = 'pages/carte.html';
export const MENU_TRANSLATABLE = ['title', 'subtitle', 'backLabel', 'note', 'sections[].title', 'sections[].dishes[].name', 'sections[].dishes[].desc'];

/** Lieux qui ont des cartes : page du lieu → ancre du bloc « Réserver une table ». */
export const VENUES = {
  'restaurant-horloge': { label: "Restaurant L'Horloge", table: 'reserver-horloge', links: 'cartes-horloge' },
  'moon-bar': { label: 'Moon Bar', table: 'reserver-moonbar', links: 'cartes-moon-bar' },
  'aston-club': { label: "L'Aston Club", table: 'reserver-astonclub', links: null },
};

const SEED_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seeds', 'cartes.json');

/**
 * Cartes écrites en dur dans un gabarit (carte du Moon Bar, carte des tapas) : reprises dans la
 * collection, traductions et état compris, puis la page passe au gabarit commun. Sans effet ensuite.
 */
export function ensureMenus(db) {
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  if (!def || !db.prepare('SELECT 1 FROM cms_collections WHERE key = ?').get(MENUS) || !fs.existsSync(SEED_FILE)) return 0;
  const seeds = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const entry = db.prepare('SELECT e.id FROM cms_entries e WHERE e.key = ?').pluck();
  const values = db.prepare('SELECT lang, value, status, source_hash FROM cms_entry_values WHERE entry_id = ?');
  const langs = db.prepare('SELECT code FROM cms_languages').pluck().all();
  const now = nowIso();
  let converted = 0;

  db.transaction(() => {
    for (const [key, seed] of Object.entries(seeds)) {
      const page = db.prepare('SELECT * FROM cms_pages WHERE key = ?').get(key);
      if (!page || page.template === MENU_TEMPLATE || db.prepare('SELECT 1 FROM cms_items WHERE collection = ? AND key = ?').get(MENUS, key)) continue;
      // Texte d'un emplacement dans chaque langue : { lang: { value, status, upToDate } }
      const cache = new Map();
      const read = (slot) => {
        if (!cache.has(slot.key)) {
          const id = entry.get(slot.key);
          const rows = id ? values.all(id) : [];
          const fr = rows.find((r) => r.lang === def)?.value || slot.text;
          const out = { [def]: { value: fr, status: 'ready', upToDate: true } };
          for (const r of rows) {
            if (r.lang === def || !r.value) continue;
            out[r.lang] = { value: r.value, status: r.status, upToDate: !r.source_hash || r.source_hash === sha(String(fr)) };
          }
          cache.set(slot.key, out);
        }
        return cache.get(slot.key);
      };
      const state = Object.fromEntries(langs.map((l) => [l, { complete: true, ready: true, upToDate: true }]));
      const pick = (slot, lang) => {
        const v = read(slot)[lang];
        if (!v) {
          state[lang].complete = false;
          return undefined;
        }
        if (v.status !== 'ready') state[lang].ready = false;
        if (!v.upToDate) state[lang].upToDate = false;
        return v.value;
      };
      const build = (lang) => ({
        title: pick(seed.title, lang),
        subtitle: pick(seed.subtitle, lang),
        backLabel: pick(seed.backLabel, lang),
        sections: seed.sections.map((s) => ({
          title: pick(s.title, lang),
          dishes: s.dishes.map((d) => ({ name: pick(d.name, lang), ...(d.desc ? { desc: pick(d.desc, lang) } : {}) })),
        })),
      });
      const base = { page: key, venue: seed.venue, sections: seed.sections.map((s) => ({ dishes: s.dishes.map((d) => ({ price: d.price })) })) };
      const id = db.prepare('INSERT INTO cms_items (collection, key, data, is_active, position, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)')
        .run(MENUS, key, JSON.stringify(base), page.position, now, now).lastInsertRowid;
      const frData = JSON.stringify(build(def));
      const ins = db.prepare('INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)');
      ins.run(id, def, frData, 'ready', sha(frData), now);
      for (const lang of langs) {
        if (lang === def) continue;
        const data = build(lang);
        const st = state[lang];
        if (!JSON.stringify(data).match(/"(title|name|desc|subtitle|backLabel)":"/)) continue; // rien de traduit
        ins.run(id, lang, JSON.stringify(data), st.complete && st.ready ? 'ready' : 'draft', st.upToDate ? sha(frData) : 'avant-reprise', now);
      }
      db.prepare('UPDATE cms_pages SET template = ?, updated_at = ? WHERE id = ?').run(MENU_TEMPLATE, now, page.id);
      db.prepare('DELETE FROM cms_entries WHERE page_id = ?').run(page.id); // textes de l'ancien gabarit
      converted += 1;
    }
  })();
  return converted;
}

/** Retire les textes vides d'une traduction : le texte de la langue par défaut reste affiché. */
function dropEmpty(v) {
  if (Array.isArray(v)) return v.map(dropEmpty);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x != null).map(([k, x]) => [k, dropEmpty(x)]));
  return v;
}

/** Contenu d'une carte dans une langue : langue par défaut, puis traduction utilisable par-dessus. */
export function menuFor(source, key, lang) {
  const item = source.items.find((it) => it.collection === MENUS && it.key === key);
  if (!item) return null;
  const rows = source.itemI18n.get(item.id) || {};
  const parse = (row) => (row ? JSON.parse(row.data) : undefined);
  let data = mergeTranslation(JSON.parse(item.data), parse(rows[source.defaultLang]));
  const own = lang !== source.defaultLang && source.usable(rows[lang], lang) ? rows[lang] : null;
  if (own) data = mergeTranslation(data, dropEmpty(parse(own)));
  return { key, data, missing: lang !== source.defaultLang && !own };
}

const ICON_BACK = '<svg class="icon" aria-hidden="true"><use href="#i-back"></use></svg>';
const ICON_ARROW = '<svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg>';

/**
 * Remplit une page de carte (gabarit commun) : retour vers le lieu, rubriques et plats,
 * bouton « Réserver une table », liens vers les autres cartes du lieu.
 * @returns false si la page n'est pas une carte
 */
export function renderMenu($, view, { source, lang, page, text, warn }) {
  const box = view.find('[data-cms-menu]').first();
  if (!box.length) return false;
  box.removeAttr('data-cms-menu');
  const slot = (name) => box.find(`[data-f="${name}"]`).first().removeAttr('data-f');
  const menu = menuFor(source, page.key, lang);
  if (!menu) {
    warn(`${lang.toUpperCase()} : page « ${page.key} » sans carte`);
    return true;
  }
  const m = menu.data;
  const venue = VENUES[m.venue] ? m.venue : null;
  view.attr({ 'data-route': page.key, 'data-view': page.key });
  if (venue) view.attr({ 'data-table-target': VENUES[venue].table, 'data-table-route': venue });
  else view.removeAttr('data-cta');

  const back = slot('back');
  if (venue && m.backLabel) back.attr('href', `#/${venue}`).append(ICON_BACK, $('<span>').text(m.backLabel).contents());
  else back.remove();
  slot('title').text(m.title || '');
  const sub = slot('subtitle');
  if (m.subtitle) sub.text(m.subtitle); else sub.remove();
  slot('sections').replaceWith((m.sections || []).filter((s) => s.title || s.dishes?.length).map((s) => {
    const section = $('<section class="menu-section">').append($('<h2>').text(s.title || ''));
    const list = $('<ul class="menu-list">');
    for (const d of s.dishes || []) {
      if (!d.name) continue;
      const li = $('<li>').append($('<span class="menu-list__name">').text(d.name));
      if (d.price) li.append($('<span class="menu-list__price">').text(d.price));
      if (d.desc) li.append($('<span class="menu-list__desc">').text(d.desc));
      list.append('\n  ', li);
    }
    return section.append('\n', list, '\n');
  }));
  const note = slot('note');
  if (m.note) note.text(m.note); else note.remove();

  const cta = slot('cta');
  if (venue) cta.attr('href', `#/${venue}?a=${VENUES[venue].table}`).text(text('ui.cta.table'));
  else cta.remove();
  const others = source.items
    .filter((it) => it.collection === MENUS && it.key !== page.key && source.pagesByKey.has(it.key))
    .map((it) => menuFor(source, it.key, lang))
    .filter((o) => o.data.venue === m.venue && o.data.title);
  slot('others').replaceWith(others.map((o) => $('<a class="link-arrow">').attr('href', `#/${o.key}`).append($('<span>').text(o.data.title).contents(), ICON_ARROW)));
  return true;
}
