/**
 * Rendu d'une page dans une langue :
 * layout + gabarit → contenus (data-cms-*) → fiche → données JSON → liens → en-tête SEO
 * → JSON-LD → adresses des fichiers → nettoyage.
 */
import * as cheerio from 'cheerio';
import { injectTexts } from './annotations.js';
import { injectMedia } from './media-render.js';
import { renderZones, renderPopup } from './banners.js';
import { renderGigList } from './gigs.js';
import { renderLinkLists } from './link-lists.js';
import { renderMenu } from './menus.js';
import { fillVars, sha } from '../lib/util.js';
import { globalGraph, breadcrumbFromDom, faqFromDom, webPageNode, jsonForScript } from './jsonld.js';

/** Attributs qui peuvent pointer vers un fichier du site. */
const ASSET_ATTRS = { link: ['href'], script: ['src'], img: ['src', 'srcset'], source: ['src', 'srcset', 'data-src'], video: ['poster', 'src'], a: ['href'] };
const isRelative = (url) => url && !/^(?:[a-z][a-z0-9+.-]*:|\/|#|data:)/i.test(url);

const PREVIEW_STYLE = `
.cms-preview-ribbon{position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:8px 12px;border-radius:6px;
  background:#1d1d1f;color:#fff;font:600 12px/1.3 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none}
.cms-preview-ribbon b{color:#ffb347}
[data-preview-missing]{outline:2px dashed #ff9500 !important;outline-offset:2px}`;

function removeComments($) {
  const walk = (node) => {
    for (const child of [...(node.children || [])]) {
      if (child.type === 'comment') $(child).remove();
      else walk(child);
    }
  };
  walk($.root()[0]);
}

/** Insère des éléments à la suite les uns des autres après un repère. */
function insertAfter(anchor, nodes) {
  let last = anchor;
  for (const n of nodes) {
    last.after(n);
    n.before('\n  ');
    last = n;
  }
}

/**
 * @param site   contexte du build (voir build.js) : source, mode, basePath, gabarits, routes, fichiers…
 * @param lang   code de langue
 * @param target { type: 'page', page } ou { type: 'item', collection, item, route, view, template }
 * @param head   { title, description, canonical, alternates, xDefault, switcher, noindex } calculé par le build
 */
export function renderPage(site, lang, target, head) {
  const { source } = site;
  const missing = new Set();
  const unknown = new Set();
  const brokenLinks = new Set();
  const $ = cheerio.load(site.layoutHtml);
  const main = $('main[data-cms-page]').first().removeAttr('data-cms-page');

  /* 1. Composition */
  if (target.type === 'page') main.append(site.templates.get(target.page.template));
  else main.append(`<section class="view" data-route="${target.route}" data-view="${target.view}">${site.templates.get(target.template)}</section>`);
  const view = main.children('section.view').first().addClass('is-active');
  removeComments($);
  $('[data-house-rules]').each((i, el) => {
    if (!$(el).children().length) $(el).append(site.houseRulesHtml);
  });

  /* 2. Contenus */
  const text = (key, vars) => {
    const r = source.text(key, lang);
    if (r.unknown) unknown.add(key);
    else if (r.missing) missing.add(key);
    return { value: fillVars(r.value, vars), missing: r.missing };
  };
  const mark = (el, isMissing) => {
    if (isMissing && site.mode === 'preview') el.attribs['data-preview-missing'] = '';
  };
  // Page de carte (restaurant, bars) : rubriques et plats depuis la collection « menus »
  if (target.type === 'page') renderMenu($, view, { source, lang, page: target.page, text: (key) => text(key).value, warn: site.warn });
  // Menus et listes de liens repris dans la base : reconstruits avant l'injection des textes
  for (const skipped of renderLinkLists($, { source, lang, now: site.now })) site.warn(`${lang.toUpperCase()} : lien ignoré, cible introuvable (${skipped})`);
  injectTexts($, (key) => text(key), mark);
  injectMedia($, source, lang, (key) => missing.add(key));

  /* 3. Fiche (chambre, service), bandeaux, popup */
  const itemMeta = target.type === 'item' ? target.fill($, view, (key, vars) => text(key, vars).value) : null;
  const uiText = (key) => text(key).value;
  const pageId = target.type === 'page' ? target.page.id : target.parentId;
  renderZones($, { source, lang, pageId, now: site.now, uiText, preview: site.mode === 'preview' });
  renderPopup($, { source, lang, pageId, now: site.now, uiText, preview: site.mode === 'preview', popupScript: site.assets.url('popup.js') });
  const gigEvents = renderGigList($, { source, lang, now: site.now, text: uiText, pageUrl: head.canonical, siteUrl: site.siteUrl });

  /* 4. Liens internes « #/route » → adresses de la langue */
  const routes = site.routes.get(lang);
  const resolve = (href) => {
    const m = /^#\/([^?#]*)(\?[^#]*)?$/.exec(href);
    if (!m) return null;
    const key = m[1].replace(/\/+$/, '');
    if (key === 'reserver') return site.bookingBase(lang);
    const path = routes.get(key);
    if (!path) {
      brokenLinks.add(href);
      return null;
    }
    return path + (m[2] || '');
  };
  const rewriteHtml = (html) => String(html).replace(/href=(["'])(#\/[^"']*)\1/g, (all, q, href) => {
    const to = resolve(href);
    return to ? `href=${q}${to}${q}` : all;
  });
  $('a[href^="#/"]').each((i, el) => {
    const to = resolve(el.attribs.href);
    if (to) el.attribs.href = to;
  });
  const bookingPrefix = source.settings.booking_engine?.prefix;
  if (bookingPrefix) {
    $('[action]').each((i, el) => {
      if (el.attribs.action.startsWith(bookingPrefix)) el.attribs.action = site.bookingBase(lang);
    });
  }

  /* Sélecteur de langue : une entrée par langue où la page est publiée, retiré s'il n'y en a qu'une.
     Les liens vont dans [data-lang-list] s'il existe (menu déroulant de l'en-tête), sinon dans l'élément même. */
  const switcher = head.switcher || [];
  $('[data-lang-switch]').each((i, el) => {
    if (!switcher.some((s) => s.lang !== lang)) return void $(el).remove();
    const list = $(el).find('[data-lang-list]').first();
    const box = list.length ? list.removeAttr('data-lang-list') : $(el);
    box.children('a').remove();
    for (const s of switcher) {
      const a = $('<a>').attr({ href: s.href, hreflang: s.lang, lang: s.lang }).text(s.name);
      if (s.lang === lang) a.attr('aria-current', 'true');
      box.append('\n        ', a);
    }
    box.append('\n      ');
    $(el).find('[data-lang-current]').removeAttr('data-lang-current').text(lang.toUpperCase());
  });

  /* 5. Données lues par le script du site */
  $('script[data-cms-json]').each((i, el) => {
    const kind = el.attribs['data-cms-json'];
    let data = null;
    if (kind === 'reviews') {
      data = { ...source.settings.reviews_meta, items: source.collectionItems('reviews', lang, site.now).map((it) => it.data) };
    } else if (kind === 'chat') {
      data = {
        greeting: text('global.chat-accueil').value,
        fallback: rewriteHtml(text('global.chat-sans-reponse').value),
        intents: source.collectionItems('chat', lang, site.now).map((it) => ({ ...it.data, answer: rewriteHtml(it.data.answer) })),
      };
    } else if (kind === 'site-config') {
      data = { ...site.clientConfig(lang), page: { route: target.type === 'page' ? (target.page.key === 'accueil' ? '' : target.page.key) : target.route, view: view.attr('data-view') } };
    }
    $(el).text(jsonForScript(data));
  });

  /* 6. En-tête SEO */
  const title = itemMeta?.title ?? head.title;
  const description = itemMeta?.description ?? head.description;
  const langRow = source.lang(lang);
  $('html').attr('lang', lang);
  const viewport = $('head meta[name="viewport"]').first();
  const tags = [$('<title>').text(title), $('<meta name="description">').attr('content', description)];
  if (head.noindex || site.mode === 'preview') tags.push($('<meta name="robots" content="noindex">'));
  // Extraits longs et grandes images autorisés : Google (AI Overviews compris) et Bing peuvent citer la page en entier
  else tags.push($('<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">'));
  tags.push($('<link rel="canonical">').attr('href', head.canonical));
  for (const alt of head.alternates) tags.push($('<link rel="alternate">').attr({ hreflang: alt.lang, href: alt.href }));
  if (head.xDefault) tags.push($('<link rel="alternate" hreflang="x-default">').attr('href', head.xDefault));
  insertAfter(viewport, tags);
  const og = [
    $('<meta property="og:title">').attr('content', title),
    $('<meta property="og:description">').attr('content', description),
    $('<meta property="og:url">').attr('content', head.canonical),
    $('<meta property="og:image">').attr('content', head.ogImage),
    $('<meta property="og:locale">').attr('content', langRow.locale.replace('-', '_')),
    ...head.alternates.filter((a) => a.lang !== lang).map((a) => $('<meta property="og:locale:alternate">').attr('content', source.lang(a.lang).locale.replace('-', '_'))),
    $('<meta name="twitter:card" content="summary_large_image">'),
  ];
  insertAfter($('head meta[property="og:site_name"]').first(), og);

  /* 7. JSON-LD : graphe commun + fil d'Ariane + FAQ + fiche */
  const absolute = (href) => {
    if (/^https?:/.test(href)) return href;
    const path = site.basePath && href.startsWith(`${site.basePath}/`) ? href.slice(site.basePath.length) : href;
    return site.siteUrl + path;
  };
  const images = [...new Set($('main img[src]').map((i, el) => el.attribs.src).get())]
    .filter((src) => !src.startsWith('data:'))
    .slice(0, 10)
    .map((src) => absolute(isRelative(src) ? site.assets.url(src) ?? src : src));
  const homeUrl = absolute(site.routes.get(lang).get('') || `/${lang}/`);
  const crumbs = breadcrumbFromDom($, absolute);
  if (crumbs) crumbs['@id'] = `${head.canonical}#breadcrumb`;
  const faq = faqFromDom($);
  const entity = itemMeta?.ld ? { '@id': `${head.canonical}#${itemMeta.ld['@type'].toLowerCase()}`, url: head.canonical, ...itemMeta.ld } : null;
  const webPage = webPageNode({
    url: head.canonical, name: title, description, locale: langRow.locale, siteUrl: site.siteUrl, image: images[0],
    breadcrumb: crumbs?.['@id'], mainEntity: entity?.['@id'], faq: faq?.mainEntity,
  });
  const graph = [...globalGraph(source, lang, homeUrl), webPage, crumbs, entity, ...gigEvents].filter(Boolean);
  $('head').append($('<script type="application/ld+json">').text(jsonForScript({ '@context': 'https://schema.org', '@graph': graph })));

  /* Mesure d'audience : site publié seulement */
  if (site.mode === 'production' && site.assets.url('track.js')) $('body').append(`<script src="${site.assets.url('track.js')}" defer></script>\n`);

  /* 8. Fichiers du site : adresses absolues et empreintes */
  for (const [tag, attrs] of Object.entries(ASSET_ATTRS)) {
    $(tag).each((i, el) => {
      for (const attr of attrs) {
        const value = el.attribs[attr];
        if (!value) continue;
        if (attr === 'srcset') {
          el.attribs[attr] = value.split(',').map((part) => {
            const [url, ...rest] = part.trim().split(/\s+/);
            return [isRelative(url) ? site.assets.url(url) ?? url : url, ...rest].join(' ');
          }).join(', ');
        } else if (isRelative(value)) {
          const url = site.assets.url(value);
          if (url) el.attribs[attr] = url;
          else site.warn(`${lang}${head.path} : fichier introuvable « ${value} »`);
        }
      }
    });
  }

  /* 9. Nettoyage */
  $('*').each((i, el) => {
    for (const attr of Object.keys(el.attribs || {})) if (attr.startsWith('data-cms-')) delete el.attribs[attr];
  });
  if (site.mode === 'preview') {
    $('head').append(`<style>${PREVIEW_STYLE}</style>`);
    const label = missing.size ? ` · <b>${missing.size} texte(s) non traduit(s)</b>` : '';
    $('body').append(`<div class="cms-preview-ribbon">Prévisualisation · ${lang.toUpperCase()}${label}</div>`);
  }

  return {
    html: $.html().replace(/\n(?:[ \t]*\n)+/g, '\n'), // lignes vides laissées par les balises retirées
    title,
    description,
    missing,
    unknown,
    brokenLinks,
    images,
    contentHash: sha(`${title}\n${description}\n${main.html()}`, 32),
  };
}
