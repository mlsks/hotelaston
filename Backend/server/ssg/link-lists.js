/**
 * Listes de liens modifiables (menus, pied de page, cartes du restaurant et du bar).
 *
 * Dans un gabarit, une liste est un <ul data-cms-links="cle" data-cms-links-label="Nom dans l'admin">.
 * Ses <li> d'origine servent de modèle (classes, attributs, pictogrammes) et de contenu de départ :
 * au premier démarrage, chaque lien devient un élément de la collection « links », traductions comprises.
 * Ensuite, la base fait foi : le build reconstruit la liste à partir des éléments, dans leur ordre.
 *
 * Un élément : data = { list, parent (clé de l'élément parent, sous-menu) ou null,
 *   kind: 'page' | 'media' | 'url', page (clé de page), media (identifiant), url }, label traduit.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { collapse, nowIso, sha } from '../lib/util.js';
import { esc } from './media-render.js';

export const LINKS = 'links';
/** Réglage qui liste les listes déjà reprises dans la base (les autres gardent le contenu du gabarit). */
export const SEEDED = 'link_lists';

/** Textes des anciens gabarits remplacés par une liste (L'Horloge renvoyait par erreur aux cartes du Moon Bar). */
const RETIRED_KEYS = ['restaurant-horloge.021-a', 'restaurant-horloge.022-a'];

const linkKey = (a) => a.attribs['data-cms-key'] || a.attribs['data-cms-html'] || a.attribs['data-cms-text']?.split(',')[0] || null;

/** Lien d'un gabarit → { kind, page | url }. */
export function targetOf(href) {
  const m = /^#\/([^?#]*)/.exec(href || '');
  if (m) return { kind: 'page', page: m[1].replace(/\/+$/, '') || 'accueil' };
  return { kind: 'url', url: href || '' };
}

function readList($, ul) {
  const items = [];
  $(ul).children('li').each((i, li) => {
    const a = $(li).children('a').first();
    if (!a.length) return;
    const children = [];
    $(li).children('ul').children('li').each((j, sub) => {
      const sa = $(sub).children('a').first();
      if (sa.length) children.push({ text: collapse(sa.text()).trim(), entry: linkKey(sa[0]), ...targetOf(sa.attr('href')) });
    });
    items.push({ text: collapse(a.text()).trim(), entry: linkKey(a[0]), ...targetOf(a.attr('href')), children });
  });
  return items;
}

/** Listes déclarées dans les gabarits : [{ key, label, page (clé, null = toutes les pages), nested, items }]. */
export function scanLinkLists(dir = config.templatesDir) {
  const files = [['layout.html', null]];
  const pagesDir = path.join(dir, 'pages');
  if (fs.existsSync(pagesDir)) {
    for (const f of fs.readdirSync(pagesDir).filter((n) => n.endsWith('.html')).sort()) files.push([path.join('pages', f), f.slice(0, -5)]);
  }
  const lists = [];
  for (const [rel, page] of files) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) continue;
    const $ = cheerio.load(fs.readFileSync(file, 'utf8'));
    $('[data-cms-links]').each((i, ul) => {
      lists.push({
        key: ul.attribs['data-cms-links'],
        label: ul.attribs['data-cms-links-label'] || ul.attribs['data-cms-links'],
        page,
        nested: $(ul).find('li ul').length > 0,
        items: readList($, ul),
      });
    });
  }
  return lists;
}

/**
 * Reprend dans la base les listes pas encore reprises (libellés dans toutes les langues, état des
 * traductions conservé), puis retire les textes devenus inutiles. Sans effet ensuite.
 */
export function ensureLinkLists(db, lists = scanLinkLists()) {
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  if (!def || !db.prepare('SELECT 1 FROM cms_collections WHERE key = ?').get(LINKS)) return 0;
  const row = db.prepare('SELECT value FROM cms_settings WHERE key = ?').pluck().get(SEEDED);
  const seeded = new Set(row ? JSON.parse(row) : []);
  const entry = db.prepare('SELECT id FROM cms_entries WHERE key = ?').pluck();
  const values = db.prepare('SELECT lang, value, status, source_hash FROM cms_entry_values WHERE entry_id = ?');
  const insItem = db.prepare('INSERT INTO cms_items (collection, key, data, is_active, position, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)');
  const insI18n = db.prepare('INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)');
  const now = nowIso();
  let added = 0;

  /** Libellés par langue : ceux du texte de l'ancien gabarit s'il existe, sinon le texte du gabarit. */
  function labels(link) {
    const id = link.entry && entry.get(link.entry);
    const rows = id ? values.all(id) : [];
    const fr = rows.find((r) => r.lang === def)?.value || link.text;
    const frData = JSON.stringify({ label: fr });
    const out = [{ lang: def, data: frData, status: 'ready', hash: sha(frData) }];
    for (const r of rows) {
      if (r.lang === def || !r.value) continue;
      const upToDate = !r.source_hash || r.source_hash === sha(String(fr));
      out.push({ lang: r.lang, data: JSON.stringify({ label: r.value }), status: r.status, hash: upToDate ? sha(frData) : 'avant-reprise' });
    }
    return out;
  }
  const add = (list, key, link, parent, position) => {
    const data = { list, parent, kind: link.kind, ...(link.kind === 'page' ? { page: link.page } : { url: link.url }) };
    const id = insItem.run(LINKS, key, JSON.stringify(data), position, now, now).lastInsertRowid;
    for (const l of labels(link)) insI18n.run(id, l.lang, l.data, l.status, l.hash, now);
    added += 1;
  };

  db.transaction(() => {
    for (const list of lists) {
      if (seeded.has(list.key)) continue;
      list.items.forEach((link, i) => {
        const key = `${list.key}-${i + 1}`;
        add(list.key, key, link, null, i * 10);
        link.children.forEach((child, j) => add(list.key, `${key}-${j + 1}`, child, key, i * 10 + j + 1));
      });
      seeded.add(list.key);
    }
    db.prepare(`INSERT INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(SEEDED, JSON.stringify([...seeded].sort()), now);
    // Textes repris dans les listes (ou retirés) : plus utilisés, ils encombreraient Textes communs et les traductions
    const unused = [...RETIRED_KEYS];
    for (const list of lists) {
      if (!seeded.has(list.key)) continue;
      for (const link of list.items) unused.push(link.entry, ...link.children.map((c) => c.entry));
    }
    const del = db.prepare('DELETE FROM cms_entries WHERE key = ?');
    for (const key of unused.filter(Boolean)) del.run(key);
  })();
  return added;
}

/** Adresse d'un lien : « #/route » pour une page (réécrite ensuite dans la langue), fichier ou adresse externe. */
export function hrefOf(source, data) {
  if (data.kind === 'page') {
    if (!data.page) return null;
    return data.page === 'accueil' ? '#/' : `#/${data.page}`;
  }
  if (data.kind === 'media') {
    const file = source.variants.get(Number(data.media))?.find((v) => v.purpose === 'original');
    const media = source.media.get(Number(data.media));
    if (!file || !media || media.status !== 'ready') return null;
    return `/media/${file.path}`;
  }
  return data.url || null;
}

/** Copie d'un <li> modèle, sans ses sous-listes, avec le libellé et l'adresse d'un lien. */
function fillItem($, model, item, href) {
  const li = $(model).clone();
  li.children('ul').remove();
  const a = li.children('a').first();
  for (const attr of ['data-cms-key', 'data-cms-html', 'data-cms-text', 'aria-current', 'target', 'rel']) a.removeAttr(attr);
  a.attr('href', href);
  // Le libellé remplace le texte ; les pictogrammes (svg) restent
  a.contents().filter((i, n) => n.type === 'text').remove();
  a.prepend(esc(item.data.label || ''));
  if (a.is('[data-nav]')) {
    if (item.data.kind === 'page') a.attr('data-nav', item.data.page);
    else a.removeAttr('data-nav');
  }
  if (item.data.kind === 'media') a.attr({ target: '_blank', rel: 'noopener' });
  else if (item.data.kind === 'url' && /^https?:/i.test(href)) a.attr('rel', 'noopener');
  return li;
}

/**
 * Reconstruit les listes reprises dans la base (les autres gardent le contenu de leur gabarit).
 * À appeler avant l'injection des textes : les copies n'ont plus de clé data-cms-*.
 * @returns liens ignorés (cible introuvable), pour les avertissements du build
 */
export function renderLinkLists($, { source, lang, now }) {
  const seeded = new Set(source.settings[SEEDED] || []);
  const skipped = [];
  const lists = $('[data-cms-links]').filter((i, el) => seeded.has(el.attribs['data-cms-links']));
  if (!lists.length) return skipped;
  const items = source.collectionItems(LINKS, lang, now);
  lists.each((i, ul) => {
    const key = ul.attribs['data-cms-links'];
    const model = $(ul).children('li').first();
    if (!model.length) return;
    const subModel = $(ul).find('li ul > li').first();
    const own = items.filter((it) => it.data.list === key);
    const build = (it, tpl) => {
      const href = hrefOf(source, it.data);
      if (!href || !it.data.label) {
        skipped.push(`${key} : « ${it.data.label || it.key} »`);
        return null;
      }
      return fillItem($, tpl, it, href);
    };
    const nodes = [];
    for (const it of own.filter((x) => !x.data.parent)) {
      const li = build(it, model);
      if (!li) continue;
      const kids = own.filter((x) => x.data.parent === it.key).map((x) => build(x, subModel.length ? subModel : model)).filter(Boolean);
      if (kids.length) {
        const sub = $('<ul>');
        for (const k of kids) sub.append('\n  ', k);
        li.append('\n', sub, '\n');
      }
      nodes.push(li);
    }
    $(ul).empty();
    for (const n of nodes) $(ul).append('\n  ', n);
    $(ul).append('\n');
  });
  return skipped;
}
