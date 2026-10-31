/**
 * Blog : articles de la collection « posts », une page par article sous la page Blog.
 *
 * Page Blog : <… data-cms-posts> dont le premier enfant sert de modèle de carte, avec des
 * emplacements data-f (link, mediaLink, media, category, date, summary).
 * Page d'un article (items/article.html) : emplacements data-f (article, crumb, category, title,
 * date, media, body).
 *
 * Champs de la fiche : date (AAAA-MM-JJ, facultative), media (image ou vidéo de la médiathèque) ;
 * traduits : category, title, summary, body (texte riche), alt, seoTitle, metaDescription.
 *
 * Langues : un article non traduit s'affiche quand même, en anglais s'il y est prêt, sinon en
 * français (Source.itemData). Sa page porte alors lang="en" (ou fr) sur l'article, renvoie par
 * son adresse canonique vers la version d'origine et reste hors du sitemap (voir build.js).
 */
import * as cheerio from 'cheerio';
import { pictureHtml, esc } from './media-render.js';
import { nowIso, sha } from '../lib/util.js';
import { LINKS, SEEDED as LINK_LISTS } from './link-lists.js';

export const POSTS = 'posts';
const SEEDED = 'blog_posts';
const MENU_SEEDED = 'blog_menu';

/** Articles écrits dans le gabarit de la page Blog (maquette), repris une fois dans les fiches. */
const SEED = [
  { key: 'vieille-ville-a-pied', category: 'blog.005-p', title: 'blog.006-h2', body: 'blog.007-p' },
  { key: 'coup-de-canon-de-midi', category: 'blog.008-p', title: 'blog.009-h2', body: 'blog.010-p' },
  { key: 'carnaval-de-nice', category: 'blog.011-p', title: 'blog.012-h2', body: 'blog.013-p' },
];

/** Entrées « Blog » ajoutées aux menus (après Accès) : liste, page qui la précède. */
const MENU_LISTS = [['menu-principal', 'acces-contact'], ['menu-mobile', 'acces-contact']];
const MENU_LABELS = { fr: 'Blog', en: 'Blog' };

/** Texte d'un fragment HTML (balises retirées, entités décodées, espaces resserrés). */
export const plain = (html) => cheerio.load(`<div>${String(html ?? '')}</div>`, null, false)('div').text().replace(/\s+/g, ' ').trim();

/** Début d'un texte, coupé à un mot, pour le résumé des cartes et la description Google. */
export function excerpt(text, max = 180) {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[\s,;:.–-]+$/, '')}…`;
}

/**
 * Reprise, une fois, des trois articles du gabarit de la page Blog dans des fiches, traductions
 * comprises (prête si tous les textes de la langue l'étaient, sinon brouillon) ; les textes repris
 * sont retirés. Sans effet tant que le site n'est pas importé.
 */
export function ensurePosts(db) {
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  if (!def || !db.prepare('SELECT 1 FROM cms_collections WHERE key = ?').get(POSTS)) return 0;
  // Collection créée par la migration avant l'import : page parente rattachée ensuite
  db.prepare("UPDATE cms_collections SET parent_page = (SELECT id FROM cms_pages WHERE key = 'blog') WHERE key = ? AND parent_page IS NULL").run(POSTS);
  if (db.prepare('SELECT 1 FROM cms_settings WHERE key = ?').get(SEEDED)) return 0;
  const entry = db.prepare('SELECT id, type FROM cms_entries WHERE key = ?');
  if (!entry.get(SEED[0].title)) return 0; // site pas encore importé
  const values = db.prepare('SELECT lang, value, status, source_hash FROM cms_entry_values WHERE entry_id = ?');
  const now = nowIso();
  let done = 0;

  /** Valeurs d'un texte par langue, en HTML pour le texte de l'article. */
  const read = (key, asHtml) => {
    const e = entry.get(key);
    const rows = e ? values.all(e.id) : [];
    const src = rows.find((r) => r.lang === def);
    const out = {};
    for (const r of rows) {
      if (!r.value) continue;
      const value = asHtml ? `<p>${e.type === 'richtext' ? r.value : esc(r.value)}</p>` : plain(r.value);
      out[r.lang] = { value, ready: r.lang === def || r.status === 'ready', upToDate: r.lang === def || !r.source_hash || r.source_hash === sha(String(src?.value ?? '')) };
    }
    return out;
  };

  db.transaction(() => {
    const exists = db.prepare('SELECT 1 FROM cms_items WHERE collection = ? AND key = ?');
    const insItem = db.prepare('INSERT INTO cms_items (collection, key, data, is_active, position, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)');
    const insI18n = db.prepare('INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let position = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) FROM cms_items WHERE collection = ?').pluck().get(POSTS);
    for (const seed of SEED) {
      if (exists.get(POSTS, seed.key)) continue;
      const texts = { category: read(seed.category), title: read(seed.title), body: read(seed.body, true) };
      if (!texts.title[def]) continue;
      const build = (lang) => Object.fromEntries(Object.entries(texts).filter(([, v]) => v[lang]).map(([f, v]) => [f, v[lang].value]));
      const frData = JSON.stringify(build(def));
      const id = insItem.run(POSTS, seed.key, JSON.stringify({ date: '', media: null }), position++, now, now).lastInsertRowid;
      insI18n.run(id, def, seed.key, frData, 'ready', sha(frData), now);
      const langs = new Set(Object.values(texts).flatMap((v) => Object.keys(v)).filter((l) => l !== def));
      for (const lang of langs) {
        const used = Object.values(texts).map((v) => v[lang]).filter(Boolean);
        const ready = used.length === Object.keys(texts).length && used.every((v) => v.ready);
        insI18n.run(id, lang, seed.key, JSON.stringify(build(lang)), ready ? 'ready' : 'draft', used.every((v) => v.upToDate) ? sha(frData) : '', now);
      }
      done += 1;
    }
    const del = db.prepare('DELETE FROM cms_entries WHERE key = ?');
    for (const seed of SEED) for (const key of [seed.category, seed.title, seed.body]) del.run(key);
    db.prepare('INSERT INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)').run(SEEDED, 'true', now);
  })();
  return done;
}

/**
 * Ajoute, une fois, l'entrée « Blog » aux menus repris dans la base (en-tête et menu mobile),
 * juste après Accès. Une entrée retirée ensuite dans l'admin ne revient pas.
 */
export function ensureBlogMenu(db) {
  if (db.prepare('SELECT 1 FROM cms_settings WHERE key = ?').get(MENU_SEEDED)) return 0;
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  const row = db.prepare('SELECT value FROM cms_settings WHERE key = ?').pluck().get(LINK_LISTS);
  if (!def || !row || !db.prepare("SELECT 1 FROM cms_pages WHERE key = 'blog'").get()) return 0;
  const seeded = new Set(JSON.parse(row));
  const langs = new Set(db.prepare('SELECT code FROM cms_languages').pluck().all());
  const now = nowIso();
  let added = 0;
  db.transaction(() => {
    const links = db.prepare(`SELECT id, key, position, json_extract(data, '$.page') AS page, json_extract(data, '$.parent') AS parent
      FROM cms_items WHERE collection = '${LINKS}' AND json_extract(data, '$.list') = ? ORDER BY position, id`);
    const shift = db.prepare(`UPDATE cms_items SET position = position + 1 WHERE collection = '${LINKS}' AND json_extract(data, '$.list') = ? AND position > ?`);
    const insItem = db.prepare('INSERT INTO cms_items (collection, key, data, is_active, position, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)');
    const insI18n = db.prepare('INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)');
    const taken = db.prepare(`SELECT 1 FROM cms_items WHERE collection = '${LINKS}' AND key = ?`);
    for (const [list, after] of MENU_LISTS) {
      if (!seeded.has(list)) continue; // liste encore tirée du gabarit, qui a déjà son lien Blog
      const all = links.all(list);
      if (all.some((l) => l.page === 'blog' && !l.parent)) continue;
      // Après le lien vers Accès et ses sous-liens, sinon en fin de liste
      const anchor = all.find((l) => l.page === after && !l.parent);
      const block = anchor ? all.filter((l) => l.id === anchor.id || l.parent === anchor.key) : all;
      const last = block.length ? Math.max(...block.map((l) => l.position)) : -1;
      shift.run(list, last);
      let key = `${list}-blog`;
      for (let i = 2; taken.get(key); i += 1) key = `${list}-blog-${i}`;
      const id = insItem.run(LINKS, key, JSON.stringify({ list, parent: null, kind: 'page', page: 'blog' }), last + 1, now, now).lastInsertRowid;
      const frData = JSON.stringify({ label: MENU_LABELS.fr });
      for (const [lang, label] of Object.entries(MENU_LABELS)) {
        const code = lang === 'fr' ? def : lang;
        if (!langs.has(code) || (lang !== 'fr' && code === def)) continue;
        insI18n.run(id, code, JSON.stringify({ label }), 'ready', sha(frData), now);
      }
      added += 1;
    }
    db.prepare('INSERT INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)').run(MENU_SEEDED, 'true', now);
  })();
  return added;
}

/** Date affichée dans la langue de la page (« 31 octobre 2026 »). */
function formatDate(date, locale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '';
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  } catch {
    return date;
  }
}

/** Image d'attente d'une vidéo (ou miniature à défaut) : { url, width, height }. */
function posterOf(info) {
  const v = info.variants.find((x) => x.purpose === 'poster') || info.variants.find((x) => x.purpose === 'thumb');
  return v ? { url: `/media/${v.path}`, width: v.width, height: v.height } : null;
}

/** Vidéo d'un article : lancée par le visiteur, avec les commandes du navigateur (pas de boucle muette). */
function articleVideoHtml(info, alt) {
  const file = info.variants.find((v) => v.purpose === 'original');
  if (!file) return '';
  const poster = posterOf(info);
  const size = info.media.width && info.media.height ? ` width="${info.media.width}" height="${info.media.height}"` : '';
  return `<video class="post-video" controls playsinline preload="none"${size}${poster ? ` poster="${poster.url}"` : ''} src="/media/${file.path}" aria-label="${esc(alt)}"></video>`;
}

/** Image d'un article ou d'une carte : photo en <picture>, image d'attente pour une vidéo. */
function mediaInfo(source, post, lang) {
  const info = post.data.media ? source.mediaFor(Number(post.data.media), lang) : null;
  if (!info) return null;
  return { ...info, alt: post.data.alt || info.alt || '' };
}

/** Remplit les listes d'articles de la page Blog (avant l'injection des textes). */
export function renderPostList($, { source, lang, now }) {
  const lists = $('[data-cms-posts]');
  if (!lists.length) return;
  const posts = source.collectionItems(POSTS, lang, now);
  const locale = source.lang(lang)?.locale || lang;
  lists.each((i, el) => {
    const list = $(el).removeAttr('data-cms-posts');
    const model = list.children().first().clone();
    list.children().remove();
    for (const post of posts) {
      const r = post.data;
      const card = model.clone();
      const slot = (name) => card.find(`[data-f="${name}"]`).addBack(`[data-f="${name}"]`).removeAttr('data-f');
      const href = `#/blog/${post.key}`;
      if (post.lang !== lang) card.attr('lang', post.lang);
      slot('link').attr('href', href).text(r.title || post.key);
      const info = mediaInfo(source, post, lang);
      const mediaLink = slot('mediaLink').attr({ href, tabindex: '-1', 'aria-hidden': 'true' });
      const img = slot('media');
      if (info?.media.kind === 'image') {
        img.replaceWith(pictureHtml(info, { sizes: img.attr('data-cms-sizes') || '(min-width: 900px) 33vw, 100vw', loading: 'lazy', portrait: false }));
      } else if (info?.media.kind === 'video' && posterOf(info)) {
        const p = posterOf(info);
        img.replaceWith(`<img src="${p.url}"${p.width ? ` width="${p.width}" height="${p.height}"` : ''} alt="${esc(info.alt)}" loading="lazy" decoding="async"><span class="post-card__play" aria-hidden="true"></span>`);
      } else {
        mediaLink.remove();
      }
      const category = slot('category');
      if (r.category) category.text(r.category);
      else category.remove();
      const date = slot('date');
      const shown = formatDate(r.date, locale);
      if (shown) date.attr('datetime', r.date).text(shown);
      else (date.closest('.post-card__meta').length ? date.closest('.post-card__meta') : date).remove();
      const summary = slot('summary');
      const text = r.summary || excerpt(plain(r.body));
      if (text) summary.text(text);
      else summary.remove();
      list.append('\n', card);
    }
    list.append('\n');
  });
}

/** Page d'un article : textes, photo ou vidéo, données structurées (BlogPosting). */
export function fillPost($, view, { post, source, lang, siteUrl }) {
  const r = post.data;
  const slot = (name) => {
    const node = view.find(`[data-f="${name}"]`).first();
    node.removeAttr('data-f');
    return node;
  };
  const article = slot('article');
  // Article affiché dans sa langue de repli (anglais, sinon français) : annoncé aux lecteurs d'écran
  if (post.lang !== lang) article.attr('lang', post.lang);
  slot('crumb').text(r.title || post.key);
  const category = slot('category');
  if (r.category) category.text(r.category);
  else category.remove();
  slot('title').text(r.title || post.key);
  const date = slot('date');
  const shown = formatDate(r.date, source.lang(lang)?.locale || lang);
  if (shown) date.attr('datetime', r.date).text(shown);
  else (date.closest('.post-page__meta').length ? date.closest('.post-page__meta') : date).remove();
  const figure = slot('media');
  const info = mediaInfo(source, post, lang);
  let image = null;
  if (info?.media.kind === 'image') {
    figure.html(pictureHtml(info, { sizes: '(min-width: 900px) 820px, 100vw', loading: '', fetchpriority: 'high', portrait: false }));
    const ws = info.variants.filter((v) => /^w\d+$/.test(v.purpose) && v.format === 'webp').sort((a, b) => b.width - a.width);
    if (ws.length) image = `${siteUrl}/media/${ws[0].path}`;
  } else if (info?.media.kind === 'video') {
    figure.html(articleVideoHtml(info, info.alt));
    const p = posterOf(info);
    if (p) image = siteUrl + p.url;
  }
  if (!figure.children().length) figure.remove();
  slot('body').html(r.body || ''); // texte riche nettoyé à l'enregistrement

  const description = r.metaDescription || r.summary || excerpt(plain(r.body), 155);
  const ld = {
    '@type': 'BlogPosting',
    headline: r.title || post.key,
    ...(description ? { description } : {}),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? { datePublished: r.date } : {}),
    ...(image ? { image } : {}),
    inLanguage: source.lang(post.lang)?.locale || post.lang,
    author: { '@id': `${siteUrl}/#hotel` },
    publisher: { '@id': `${siteUrl}/#hotel` },
  };
  return { title: r.seoTitle || r.title || post.key, description, ld };
}
