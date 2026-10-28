/**
 * Blocs des pages : sections et lignes qu'on masque, réordonne ou duplique dans l'admin
 * (onglet « Blocs » d'une page), sans toucher au gabarit.
 *
 * Dans un gabarit : <… data-cms-blocks="zone" data-cms-blocks-label="Libellé"> dont les enfants
 * <… data-cms-block="id"> sont les blocs (contigus) ; une zone peut contenir des blocs qui ont
 * eux-mêmes des zones (une section et ses lignes).
 *
 * En base (cms_page_blocks) : une ligne par bloc dont l'ordre ou la visibilité a changé, et une
 * par copie. Une copie (copy_of = id du bloc du gabarit) est un clone du bloc d'origine dont
 * toutes les clés data-cms-* et les id HTML reçoivent le suffixe « ~<id de la ligne> » : ses
 * textes sont des entrées à part (copiées de la source au moment de la copie), modifiables et
 * traduisibles dans l'onglet Textes.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { nowIso } from '../lib/util.js';
import { parseAttrMap, injectTexts } from './annotations.js';

const KEY_ATTRS = ['data-cms-key', 'data-cms-html', 'data-cms-media'];
const ID_REFS = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'for'];

/** Clés data-cms-* d'un élément et de ses descendants, dans l'ordre du document. */
export function keysOf($, el) {
  const keys = [];
  $(el).find('*').addBack().each((i, node) => {
    const a = node.attribs || {};
    for (const name of KEY_ATTRS) if (a[name]) keys.push(a[name]);
    if (a['data-cms-text']) keys.push(...a['data-cms-text'].split(','));
    if (a['data-cms-attr']) keys.push(...parseAttrMap(a['data-cms-attr']).map(([, key]) => key));
  });
  return keys;
}

/** Clone d'un bloc pour une copie : clés, zones et id HTML suffixés. */
function cloneBlock($, src, rowId) {
  const el = src.clone();
  const sfx = `~${rowId}`;
  const nodes = el.find('*').addBack();
  const ids = new Map();
  nodes.each((i, node) => {
    const a = node.attribs || {};
    for (const name of [...KEY_ATTRS, 'data-cms-blocks']) if (a[name]) a[name] += sfx;
    if (a['data-cms-text']) a['data-cms-text'] = a['data-cms-text'].split(',').map((k) => k + sfx).join(',');
    if (a['data-cms-attr']) a['data-cms-attr'] = parseAttrMap(a['data-cms-attr']).map(([attr, key]) => `${attr}:${key}${sfx}`).join(';');
    if (a.id) {
      ids.set(a.id, `${a.id}-${rowId}`);
      a.id = ids.get(a.id);
    }
  });
  nodes.each((i, node) => {
    const a = node.attribs || {};
    for (const name of ID_REFS) if (a[name]) a[name] = a[name].split(/\s+/).map((id) => ids.get(id) || id).join(' ');
    if (a.href?.startsWith('#') && ids.has(a.href.slice(1))) a.href = `#${ids.get(a.href.slice(1))}`;
  });
  return el;
}

const byPosition = (a, b) => a.position - b.position || a.id - b.id;

/**
 * Applique l'ordre, la visibilité et les copies des blocs d'une page, zone par zone (les zones
 * extérieures d'abord, pour que les copies d'une section emportent leurs lignes).
 * keepHidden : les blocs masqués restent, repérés par data-cms-hidden (écran Blocs, copies).
 */
export function applyBlocks($, root, rows, { keepHidden = false } = {}) {
  const byZone = new Map();
  for (const r of rows) {
    if (!byZone.has(r.zone)) byZone.set(r.zone, []);
    byZone.get(r.zone).push(r);
  }
  const done = new Set();
  for (;;) {
    const zone = $(root).find('[data-cms-blocks]').filter((i, el) => !done.has(el)).first();
    if (!zone.length) break;
    done.add(zone[0]);
    const list = (byZone.get(zone.attr('data-cms-blocks')) || []).slice().sort(byPosition);
    if (!list.length) continue;
    const originals = new Map(zone.children('[data-cms-block]').map((i, el) => [[el.attribs['data-cms-block'], $(el)]]).get());
    if (!originals.size) continue;
    const placed = [];
    const listed = new Set();
    for (const r of list) {
      const src = originals.get(r.copy_of || r.block);
      if (!src) continue;
      const el = r.copy_of ? cloneBlock($, src, r.id).attr('data-cms-block', r.block) : src;
      if (!r.copy_of) listed.add(r.block);
      placed.push({ el, hidden: !r.is_active, copy: Boolean(r.copy_of) });
    }
    // Bloc ajouté au gabarit depuis : à la suite
    for (const [id, el] of originals) if (!listed.has(id)) placed.push({ el, hidden: false, copy: false });
    const anchor = $('<cms-anchor></cms-anchor>');
    zone.children('[data-cms-block]').first().before(anchor);
    for (const el of originals.values()) el.remove();
    for (const p of placed) {
      if (p.hidden && !keepHidden) continue;
      if (p.hidden) p.el.attr('data-cms-hidden', '');
      if (p.copy && keepHidden) p.el.attr('data-cms-copy', '');
      anchor.before(p.el, '\n');
    }
    anchor.remove();
  }
}

/* ---------- Base de données ---------- */

/** Lignes cms_page_blocks d'une page (table absente d'un ancien snapshot : aucune). */
export function blockRows(db, pageId) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cms_page_blocks'").get()) return [];
  return db.prepare('SELECT * FROM cms_page_blocks WHERE page_id = ? ORDER BY zone, position, id').all(pageId);
}

/** Gabarit de la page avec ses blocs (masqués compris), et ses textes dans la langue par défaut. */
export function pageStructure(db, page, { texts = false } = {}) {
  const file = path.join(config.templatesDir, page.template);
  const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const $ = cheerio.load(`<div id="cms-root">${html}</div>`, null, false);
  const root = $('#cms-root');
  applyBlocks($, root, blockRows(db, page.id), { keepHidden: true });
  if (texts) {
    const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
    const value = db.prepare('SELECT v.value FROM cms_entries e JOIN cms_entry_values v ON v.entry_id = e.id AND v.lang = ? WHERE e.key = ?').pluck();
    injectTexts($, (key) => ({ value: value.get(def, key) ?? '' }));
  }
  return { $, root };
}

const zoneEl = ($, root, zone) => root.find('[data-cms-blocks]').filter((i, el) => el.attribs['data-cms-blocks'] === zone).first();
const blockEl = ($, zone, block) => zone.children('[data-cms-block]').filter((i, el) => el.attribs['data-cms-block'] === block).first();
/** Zones directement contenues dans un élément, lui compris (pas celles des zones plus profondes). */
const childZones = ($, el, owner) => $(el).find('[data-cms-blocks]').addBack('[data-cms-blocks]').filter((i, z) => ($(z).parent().closest('[data-cms-blocks]')[0] || null) === owner);

/** Zones d'un bloc, lui compris s'il en est une, à toutes les profondeurs. */
const zonesIn = (el) => el.find('[data-cms-blocks]').addBack('[data-cms-blocks]');

const excerpt = (s, n = 70) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Libellé d'un bloc : son titre, sinon le premier texte, sinon la description de sa photo. */
function blockLabel($, el) {
  const fixed = el.attr('data-cms-block-label');
  if (fixed) return fixed;
  for (const sel of ['h2', 'h3', 'summary', 'dt', 'strong', 'figcaption']) {
    const t = el.find(sel).addBack(sel).first().text();
    if (t.trim()) return excerpt(t);
  }
  const text = el.text();
  if (text.trim()) return excerpt(text);
  const alt = el.find('img').addBack('img').first().attr('alt');
  return alt ? `Photo : ${excerpt(alt, 60)}` : 'Bloc';
}

/** Arbre des zones et blocs d'une page, pour l'écran Blocs. */
export function blockTree(db, page) {
  const { $, root } = pageStructure(db, page, { texts: true });
  const zoneOf = (z) => ({
    zone: z.attribs['data-cms-blocks'],
    label: z.attribs['data-cms-blocks-label'] || 'Blocs',
    blocks: $(z).children('[data-cms-block]').map((i, b) => ({
      block: b.attribs['data-cms-block'],
      label: blockLabel($, $(b)),
      hidden: 'data-cms-hidden' in b.attribs,
      copy: 'data-cms-copy' in b.attribs,
      zones: childZones($, b, z).map((j, inner) => zoneOf(inner)).get(),
    })).get(),
  });
  return childZones($, root, null).map((i, z) => zoneOf(z)).get();
}

/** Lignes d'une zone, créées au besoin depuis l'ordre du gabarit (avant un premier changement). */
function materialize(db, page, zone, blocks) {
  const now = nowIso();
  const has = db.prepare('SELECT 1 FROM cms_page_blocks WHERE page_id = ? AND zone = ? AND block = ?');
  const ins = db.prepare('INSERT INTO cms_page_blocks (page_id, zone, block, copy_of, is_active, position, created_at, updated_at) VALUES (?, ?, ?, NULL, 1, ?, ?, ?)');
  blocks.forEach((b, i) => {
    if (!has.get(page.id, zone, b)) ins.run(page.id, zone, b, i, now, now);
  });
}

/** Enregistre l'ordre et la visibilité des blocs d'une zone. */
export function saveZone(db, page, zone, blocks) {
  const { $, root } = pageStructure(db, page);
  const z = zoneEl($, root, zone);
  if (!z.length) return { error: 'Zone introuvable.' };
  const known = z.children('[data-cms-block]').map((i, el) => el.attribs['data-cms-block']).get();
  const ids = blocks.map((b) => b.block);
  if (ids.length !== known.length || !known.every((id) => ids.includes(id))) return { error: 'La liste des blocs a changé : rechargez la page.' };
  db.transaction(() => {
    materialize(db, page, zone, known);
    const upd = db.prepare('UPDATE cms_page_blocks SET position = ?, is_active = ?, updated_at = ? WHERE page_id = ? AND zone = ? AND block = ?');
    const now = nowIso();
    blocks.forEach((b, i) => upd.run(i, b.hidden ? 0 : 1, now, page.id, zone, b.block));
  })();
  return {};
}

/** Copie les entrées (textes, photos, traductions) des clés source vers les clés de la copie. */
function copyEntries(db, pairs) {
  const entry = db.prepare('SELECT * FROM cms_entries WHERE key = ?');
  const values = db.prepare('SELECT * FROM cms_entry_values WHERE entry_id = ?');
  const insEntry = db.prepare(`INSERT INTO cms_entries (key, page_id, section, type, label, help, max_length, translatable, required, position, created_at, updated_at)
    VALUES (@key, @page_id, @section, @type, @label, @help, @max_length, @translatable, @required, @position, @now, @now)`);
  const insValue = db.prepare(`INSERT INTO cms_entry_values (entry_id, lang, value, media_id, status, source_hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const now = nowIso();
  for (const [from, to] of pairs) {
    const src = entry.get(from);
    if (!src || entry.get(to)) continue;
    const id = insEntry.run({ ...src, key: to, label: /\(copie\)$/.test(src.label) ? src.label : `${src.label} (copie)`, now }).lastInsertRowid;
    for (const v of values.all(src.id)) insValue.run(id, v.lang, v.value, v.media_id, v.status, v.source_hash, now);
  }
}

/**
 * Duplique un bloc juste après lui : copie de l'original du gabarit, avec les textes, l'ordre et
 * les copies des lignes du bloc dupliqué (qui peut lui-même être une copie).
 */
export function copyBlock(db, page, zone, block) {
  const first = pageStructure(db, page);
  const z = zoneEl(first.$, first.root, zone);
  const src = z.length ? blockEl(first.$, z, block) : null;
  if (!src?.length) return { error: 'Bloc introuvable.' };
  return db.transaction(() => {
    const known = z.children('[data-cms-block]').map((i, el) => el.attribs['data-cms-block']).get();
    materialize(db, page, zone, known);
    const row = db.prepare('SELECT * FROM cms_page_blocks WHERE page_id = ? AND zone = ? AND block = ?').get(page.id, zone, block);
    const base = row.copy_of || block;
    const now = nowIso();
    db.prepare('UPDATE cms_page_blocks SET position = position + 1 WHERE page_id = ? AND zone = ? AND position > ?').run(page.id, zone, row.position);
    const id = db.prepare('INSERT INTO cms_page_blocks (page_id, zone, block, copy_of, is_active, position, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)')
      .run(page.id, zone, `${base}~new`, base, row.position + 1, now, now).lastInsertRowid;
    const copy = `${base}~${id}`;
    db.prepare('UPDATE cms_page_blocks SET block = ? WHERE id = ?').run(copy, id);

    // Lignes des zones intérieures : reprises une zone à la fois (les noms des zones plus
    // profondes dépendent des copies faites au niveau du dessus)
    const insRow = db.prepare('INSERT INTO cms_page_blocks (page_id, zone, block, copy_of, is_active, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const setBlock = db.prepare('UPDATE cms_page_blocks SET block = ? WHERE id = ?');
    const rowsOf = db.prepare('SELECT * FROM cms_page_blocks WHERE page_id = ? AND zone = ? ORDER BY position, id');
    let built;
    for (let guard = 0; guard < 100; guard += 1) {
      built = pageStructure(db, page);
      const zz = zoneEl(built.$, built.root, zone);
      const a = zonesIn(blockEl(built.$, zz, block)).map((i, el) => el.attribs['data-cms-blocks']).get();
      const b = zonesIn(blockEl(built.$, zz, copy)).map((i, el) => el.attribs['data-cms-blocks']).get();
      const k = a.findIndex((name, i) => rowsOf.all(page.id, name).length && b[i] && !rowsOf.all(page.id, b[i]).length);
      if (k < 0) break;
      for (const r of rowsOf.all(page.id, a[k])) {
        const nid = insRow.run(page.id, b[k], r.copy_of ? `${r.copy_of}~new${r.id}` : r.block, r.copy_of, r.is_active, r.position, now, now).lastInsertRowid;
        if (r.copy_of) setBlock.run(`${r.copy_of}~${nid}`, nid);
      }
    }
    const zz = zoneEl(built.$, built.root, zone);
    const from = keysOf(built.$, blockEl(built.$, zz, block));
    const to = keysOf(built.$, blockEl(built.$, zz, copy));
    copyEntries(db, from.map((k, i) => [k, to[i]]).filter(([k, t]) => t && k !== t));
    return { block: copy };
  })();
}

/** Supprime une copie, ses textes et les lignes de ses zones. Un bloc du gabarit se masque. */
export function deleteBlock(db, page, zone, block) {
  const { $, root } = pageStructure(db, page);
  const z = zoneEl($, root, zone);
  const el = z.length ? blockEl($, z, block) : null;
  const row = db.prepare('SELECT * FROM cms_page_blocks WHERE page_id = ? AND zone = ? AND block = ?').get(page.id, zone, block);
  if (!el?.length || !row) return { error: 'Bloc introuvable.' };
  if (!row.copy_of) return { error: 'Seule une copie peut être supprimée : masquez plutôt ce bloc.' };
  const keys = keysOf($, el);
  const zones = zonesIn(el).map((i, n) => n.attribs['data-cms-blocks']).get();
  db.transaction(() => {
    const delEntry = db.prepare('DELETE FROM cms_entries WHERE key = ?');
    for (const key of keys) if (key.includes('~')) delEntry.run(key);
    const delZone = db.prepare('DELETE FROM cms_page_blocks WHERE page_id = ? AND zone = ?');
    for (const name of zones) delZone.run(page.id, name);
    db.prepare('DELETE FROM cms_page_blocks WHERE id = ?').run(row.id);
  })();
  return { keys };
}

/** Textes ajoutés aux gabarits avec les blocs : liens des lieux, chiffres clés (non traduisibles). */
const ADDED_ENTRIES = [
  { key: 'restaurant-bar.lien-restaurant-horloge', near: 'restaurant-bar.007-strong', type: 'url', value: '#/restaurant-horloge', label: 'Lien : Restaurant L’Horloge' },
  { key: 'restaurant-bar.lien-moon-bar', near: 'restaurant-bar.011-strong', type: 'url', value: '#/moon-bar', label: 'Lien : Le Moon Bar' },
  { key: 'restaurant-bar.lien-aston-club', near: 'restaurant-bar.015-strong', type: 'url', value: '#/aston-club', label: 'Lien : L’Aston Club' },
  { key: 'seminaires.chiffre-1', near: 'seminaires.008-span', type: 'text', value: '7', label: 'Chiffre : espaces modulables' },
  { key: 'seminaires.chiffre-3', near: 'seminaires.011-span', type: 'text', value: '250', label: 'Chiffre : personnes en assemblée' },
];

/** Crée les textes ajoutés aux gabarits avec les blocs (une fois par clé, à côté de leur voisin). */
export function ensureBlockEntries(db) {
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  if (!def) return 0;
  const has = db.prepare('SELECT 1 FROM cms_entries WHERE key = ?');
  const near = db.prepare('SELECT page_id, section, position FROM cms_entries WHERE key = ?');
  const ins = db.prepare(`INSERT INTO cms_entries (key, page_id, section, type, label, translatable, required, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`);
  const insValue = db.prepare(`INSERT INTO cms_entry_values (entry_id, lang, value, status, source_hash, updated_at) VALUES (?, ?, ?, 'ready', '', ?)`);
  const now = nowIso();
  let done = 0;
  db.transaction(() => {
    for (const e of ADDED_ENTRIES) {
      const n = near.get(e.near);
      if (!n || has.get(e.key)) continue; // site pas encore importé, ou déjà fait
      const id = ins.run(e.key, n.page_id, n.section, e.type, e.label, n.position, now, now).lastInsertRowid;
      insValue.run(id, def, e.value, now);
      done += 1;
    }
  })();
  return done;
}

/** Compteurs animés (data-count-to) dont le chiffre est un texte modifiable : suivent ce texte. */
export function syncCounters($) {
  $('[data-count-to]').each((i, el) => {
    const m = /^\s*(\d[\d\s  ]*)(.*)$/s.exec($(el).text());
    if (!m) {
      delete el.attribs['data-count-to'];
      delete el.attribs['data-count-suffix'];
      return;
    }
    el.attribs['data-count-to'] = m[1].replace(/\D/g, '');
    if (m[2]) el.attribs['data-count-suffix'] = m[2];
    else delete el.attribs['data-count-suffix'];
  });
}
