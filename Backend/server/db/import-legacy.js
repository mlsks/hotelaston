/**
 * Import du site actuel (hotelaston/index.html) — à lancer une seule fois.
 *
 *  1. Découpe la page unique en un layout commun + une page par vue + deux gabarits de fiche.
 *  2. Pose une clé data-cms-* sur chaque texte et range les valeurs françaises dans la base.
 *  3. Transforme les blocs JSON (chambres, services, avis, chat…) en collections.
 *  4. Copie les fichiers du site (CSS, JS, images, vidéos) dans le projet.
 *
 * Critère de réussite : le premier build de /preview/fr/ est identique au site actuel.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { sha, nowIso, collapse, hasLetter } from '../lib/util.js';
import { SKIP_TAGS, TEXT_ATTRS, SVG_TEXT_TAGS, textNodes, isRichCandidate } from '../ssg/annotations.js';
import { COLLECTIONS, splitTranslatable } from '../ssg/collections.js';
import { ensureUiStrings } from '../ssg/ui-strings.js';
import { ensureLinkLists } from '../ssg/link-lists.js';
import { ensureMenus } from '../ssg/menus.js';
import { ensureRoomCards } from '../ssg/room-cards.js';
import { ensureOffers } from '../ssg/offer-cards.js';
import { ensureBlockEntries } from '../ssg/page-blocks.js';
import { ensureMeetingRooms } from '../ssg/meeting-rooms.js';
import { ensurePosts, ensureBlogMenu } from '../ssg/posts.js';
import { ensureJsonLd } from '../ssg/jsonld-texts.js';
import { ensureLegalTexts } from '../ssg/legal-texts.js';
import { ensureChatChips } from '../ssg/chat-chips.js';
import { ensureLegalPage, ensurePrivacyPage } from '../ssg/legal-page.js';
import { ensureGoogleReviews } from '../ssg/google-reviews.js';
import { ensureLanguagePacks } from '../ssg/language-packs.js';

const LANG = 'fr';
const CDN_BASE = 'https://d1i8cf9j7dueks.cloudfront.net/cache/img/';
const BOOKING_PREFIX = 'https://www.secure-hotel-booking.com/smart/redirect/2ARI-19552/';
// Lien profond D-Edge : la page des chambres s'ouvre sur les dates et les voyageurs du visiteur
const BOOKING_BASE = 'https://www.secure-hotel-booking.com/d-edge/redirect/2ARI/19552/{locale}/RoomSelection?currency=EUR';
const CONTENT_TABLES = ['cms_entry_values', 'cms_entries', 'cms_page_i18n', 'cms_redirects', 'cms_pages',
  'cms_item_media', 'cms_item_i18n', 'cms_items', 'cms_collections', 'cms_settings',
  'cms_banner_placements', 'cms_banner_i18n', 'cms_banners', 'cms_popup_pages', 'cms_popup_i18n', 'cms_popups',
  'cms_media_i18n', 'cms_media_variants', 'cms_media'];

/** Script du <head> : dates des bandeaux et fermeture par le visiteur, appliquées avant l'affichage. */
const BANNER_SCRIPT = `
    window.__cmsZone = function (zone) {
      var now = Date.now(), strip = false;
      zone.querySelectorAll('[data-banner]').forEach(function (b) {
        var s = b.getAttribute('data-start'), e = b.getAttribute('data-end'), closed = false;
        try { closed = localStorage.getItem('aston.banner.' + b.getAttribute('data-banner') + '.' + b.getAttribute('data-banner-version')) === '1'; } catch (x) {}
        var on = !(s && Date.parse(s) > now) && !(e && Date.parse(e) <= now) && !closed;
        b.hidden = !on;
        if (on && b.classList.contains('live-strip')) strip = true;
      });
      if (zone.getAttribute('data-zone') === 'top-bar') document.documentElement.style.setProperty('--strip-h', strip ? '36px' : '0px');
    };
    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('[data-banner-close]');
      if (!btn) return;
      var b = btn.closest('[data-banner]'), zone = b.closest('[data-zone]');
      try { localStorage.setItem('aston.banner.' + b.getAttribute('data-banner') + '.' + b.getAttribute('data-banner-version'), '1'); } catch (x) {}
      b.hidden = true;
      if (zone) window.__cmsZone(zone);
    });
  `;
const LANDMARKS = { header: 'En-tête', footer: 'Pied de page', dialog: 'Fenêtre de réservation', form: 'Formulaire', nav: 'Navigation', aside: 'Encadré' };

const excerpt = (s, n = 70) => {
  const t = collapse(String(s).replace(/<[^>]+>/g, '')).trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Parcourt un arbre HTML, pose les data-cms-* et collecte les entrées. */
export class Extractor {
  constructor() {
    this.entries = [];
    this.counters = new Map();
  }

  key(scope, tag) {
    const n = (this.counters.get(scope) || 0) + 1;
    this.counters.set(scope, n);
    return `${scope}.${String(n).padStart(3, '0')}-${tag}`;
  }

  sectionOf($, el) {
    const host = $(el).closest('section[aria-labelledby], section[aria-label], aside[aria-label], nav[aria-label], dialog, header, footer, form').first();
    if (!host.length) return '';
    const by = host.attr('aria-labelledby');
    const label = (by && $(`#${by}`).first().text()) || host.attr('aria-label') || LANDMARKS[host[0].name] || '';
    return excerpt(label, 80);
  }

  add($, el, entry) {
    this.entries.push({ section: this.sectionOf($, el), ...entry });
  }

  walk($, el, scope, inSvg = false) {
    if (el.type !== 'tag') return;
    const { name, attribs } = el;
    if (SKIP_TAGS.has(name) || 'data-cms-skip' in attribs) return;
    if (name === 'svg' && /\bsprite\b/.test(attribs.class || '')) return;
    const svg = inSvg || name === 'svg';

    const pairs = [];
    for (const attr of TEXT_ATTRS) {
      const value = attribs[attr];
      if (!value || !hasLetter(value) || (svg && attr === 'title')) continue;
      const key = this.key(scope, `${name}@${attr}`);
      pairs.push(`${attr}:${key}`);
      this.add($, el, { key, scope, type: 'text', value: collapse(value), label: `${attr} : ${excerpt(value)}` });
    }
    if (pairs.length) attribs['data-cms-attr'] = pairs.join(';');

    if (svg && !SVG_TEXT_TAGS.has(name)) {
      for (const c of el.children) this.walk($, c, scope, true);
      return;
    }

    const texts = textNodes(el);
    if (texts.length && !svg && isRichCandidate(el)) {
      const rich = el.children.some((c) => c.type === 'tag');
      const key = this.key(scope, name);
      const value = rich ? collapse($(el).html()) : collapse(el.children.map((c) => c.data || '').join(''));
      attribs[rich ? 'data-cms-html' : 'data-cms-key'] = key;
      this.add($, el, { key, scope, type: rich ? 'richtext' : 'text', value, label: excerpt(value) });
      return;
    }
    if (texts.length) {
      const keys = texts.map((t) => {
        const key = this.key(scope, name);
        this.add($, el, { key, scope, type: 'text', value: collapse(t.data), label: excerpt(t.data) });
        return key;
      });
      attribs['data-cms-text'] = keys.join(',');
    }
    for (const c of el.children) this.walk($, c, scope, svg);
  }
}

const routeOf = (href) => {
  const m = /^#\/([^?]*)/.exec(href || '');
  return m ? m[1].replace(/\/+$/, '') : null;
};

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

function copyIfNeeded(from, to, overwrite) {
  if (!fs.existsSync(from)) return false;
  if (fs.existsSync(to) && !overwrite) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

/**
 * @param writeTemplates false : remplit seulement la base (les gabarits existants restent tels quels,
 *                       les clés étant déterministes) : tests, et d’office quand templates-src/ existe déjà.
 */
export function importLegacy(db, { force = false, forceAssets = false, writeTemplates = true, log = console.log } = {}) {
  const src = path.join(config.legacyDir, 'index.html');
  const layoutFile = path.join(config.templatesDir, 'layout.html');
  const hasContent = db.prepare('SELECT COUNT(*) FROM cms_pages').pluck().get() > 0;
  if (!force && hasContent) {
    throw new Error("Import déjà fait (contenus présents). Relancer avec --force pour tout réimporter.");
  }
  // Dépôt cloné : les gabarits sont versionnés et restent tels quels ; la base et media/ sont remplis
  let copyFiles = writeTemplates;
  if (!force && writeTemplates && fs.existsSync(layoutFile)) {
    writeTemplates = false;
    log('Gabarits déjà présents dans templates-src/ : conservés, seules la base et media/ sont remplies.');
  }

  const raw = fs.readFileSync(src, 'utf8');
  const tplInner = (id) => {
    const m = new RegExp(`<template id="${id}">([\\s\\S]*?)</template>`).exec(raw);
    if (!m) throw new Error(`Gabarit #${id} introuvable dans index.html`);
    return m[1];
  };

  const $ = cheerio.load(raw);
  const ex = new Extractor();
  const readJSON = (id) => JSON.parse($(`script#${id}`).html());

  /* ---------- Données et réglages lus dans la page ---------- */
  const data = {
    rooms: readJSON('data-rooms'),
    amenities: readJSON('data-amenities'),
    services: readJSON('data-services'),
    reviews: readJSON('data-reviews'),
    chat: readJSON('data-chat'),
  };
  const graph = JSON.parse($('head script[type="application/ld+json"]').first().html());
  graph['@graph'] = graph['@graph'].filter((node) => node['@type'] !== 'FAQPage'); // FAQPage : générée par page depuis le contenu visible
  const settings = {
    cdn_base: CDN_BASE,
    booking_engine: { base: BOOKING_BASE, prefix: BOOKING_PREFIX },
    og_site_name: $('meta[property="og:site_name"]').attr('content'),
    og_image_default: $('meta[property="og:image"]').attr('content'),
    jsonld_graph: { [LANG]: graph },
    reviews_meta: { source: data.reviews.source, google: data.reviews.google, homeRatingThreshold: data.reviews.homeRatingThreshold },
    x_default_lang: 'en',
  };

  /* ---------- En-tête : ce que le build recalcule pour chaque page ---------- */
  $('head title, head meta[name="description"], head link[rel="canonical"], head link[rel="alternate"][hreflang], '
    + 'head meta[property="og:title"], head meta[property="og:description"], head meta[property="og:locale"], '
    + 'head meta[property="og:image"], head meta[property="og:url"], head script[type="application/ld+json"]').remove();

  /* ---------- Vues → pages ---------- */
  const pages = [];
  const liveStripPages = [];
  const main = $('main#main');
  main.children('section.view').each((i, el) => {
    const route = el.attribs['data-route'];
    if (route === undefined || route.includes(':') || route === 'reserver') return;
    const key = route === '' ? 'accueil' : route;
    if ('data-live-strip-show' in el.attribs) {
      liveStripPages.push(key);
      delete el.attribs['data-live-strip-show']; // le bandeau devient un bandeau du back-office (zone top-bar)
    }
    if (key === 'accueil') {
      // Emplacements de bandeaux : sous le module de réservation, entre deux sections
      $(el).find('form.booking--hero').first().after('<div data-cms-zone="hero-sub"></div>');
      $(el).find('.highlights').first().closest('section').after('\n      <div data-cms-zone="section-intercalaire"></div>');
    }
    const crumbs = $(el).find('nav.breadcrumb a').toArray();
    const parentRoute = crumbs.length ? routeOf(crumbs[crumbs.length - 1].attribs.href) : null;
    pages.push({
      key,
      parent: key === 'accueil' ? null : parentRoute === '' || parentRoute === null ? 'accueil' : parentRoute,
      title: el.attribs['data-title'],
      description: el.attribs['data-description'],
      el,
    });
    delete el.attribs['data-title'];
    delete el.attribs['data-description'];
    ex.walk($, el, key);
    pages[pages.length - 1].html = $.html(el);
  });

  /* Page 404 (absente du site actuel) */
  const notFound = cheerio.load(`<section class="view" data-route="404" data-view="404">
      <header class="page-head container container--narrow">
        <h1>Page introuvable</h1>
        <p class="lede">Cette page n'existe pas ou a changé d'adresse.</p>
        <p><a class="btn btn--primary" href="#/">Retour à l'accueil</a></p>
      </header>
    </section>`, null, false);
  ex.walk(notFound, notFound.root().children('section')[0], '404');
  pages.push({ key: '404', parent: null, title: "Page introuvable | Hôtel Aston La Scala, Nice", description: "Cette page n'existe pas ou a changé d'adresse.", html: notFound.html(), noindex: true });

  /* ---------- Gabarits de fiche ---------- */
  const items = {};
  for (const [file, id, scope] of [['chambre', 'tpl-room', 'item-chambre'], ['service', 'tpl-service', 'item-service']]) {
    const f$ = cheerio.load(tplInner(id), null, false);
    f$.root().children().each((i, el) => ex.walk(f$, el, scope));
    items[file] = f$.html();
  }
  ex.entries.push(
    { key: 'item-chambre.galerie', scope: 'item-chambre', type: 'text', value: 'Photos : {name}, faites glisser', label: 'Libellé de la galerie ({name} = nom de la chambre)', section: 'Galerie' },
    { key: 'item-service.faq-titre', scope: 'item-service', type: 'text', value: 'Questions fréquentes : {nameLower}', label: 'Titre de la FAQ ({nameLower} = nom du service en minuscules)', section: 'FAQ' },
    { key: 'global.chat-accueil', scope: 'global', type: 'richtext', value: data.chat.greeting, label: excerpt(data.chat.greeting), section: 'Chat' },
    { key: 'global.chat-sans-reponse', scope: 'global', type: 'richtext', value: data.chat.fallback, label: excerpt(data.chat.fallback), section: 'Chat' },
  );

  /* ---------- Layout ---------- */
  // Bandeau Live Music : son contenu devient un bandeau, sa place une zone « top-bar »
  const strip = $('aside.live-strip[data-live-strip]').first();
  const liveStrip = strip.length ? {
    text: collapse(strip.find('p').first().html()).trim(),
    route: routeOf(strip.find('a').first().attr('href')),
    ctaLabel: collapse(strip.find('a').first().text()).trim(),
  } : null;
  strip.replaceWith('<div data-cms-zone="top-bar"></div>');
  $('footer.site-footer').before('<div data-cms-zone="footer-cta"></div>\n\n  ');
  $('head > script:not([src]):not([type])').first().after(`\n  <script>${BANNER_SCRIPT}</script>`);
  main.empty().attr('data-cms-page', '');
  $('#data-rooms, #data-amenities, #data-services, #tpl-room, #tpl-service').remove();
  $('#data-reviews').empty().attr('data-cms-json', 'reviews');
  $('#data-chat').empty().attr('data-cms-json', 'chat');
  $('script[src="remotion-vanilla.js"]').before('<script type="application/json" id="site-config" data-cms-json="site-config"></script>\n  ');
  $('body').contents().filter((i, n) => n.type === 'comment' && /DONNÉES|Réciprocité/.test(n.data)).remove();
  ex.walk($, $('body')[0], 'global');

  /* ---------- Écriture des gabarits et copie des fichiers du site ---------- */
  const copied = [];
  if (writeTemplates) {
    if (force) {
      for (const dir of ['pages', 'items']) fs.rmSync(path.join(config.templatesDir, dir), { recursive: true, force: true });
    }
    write(layoutFile, $.html());
    for (const p of pages) write(path.join(config.templatesDir, 'pages', `${p.key}.html`), p.html.trim() + '\n');
    for (const [name, html] of Object.entries(items)) write(path.join(config.templatesDir, 'items', `${name}.html`), html.trim() + '\n');
  }
  if (copyFiles) {
    const legacy = (f) => path.join(config.legacyDir, f);
    for (const f of ['styles.css', 'remotion-vanilla.js', 'sw.js']) {
      if (copyIfNeeded(legacy(f), path.join(config.templatesDir, 'assets', f), forceAssets)) copied.push(`assets/${f}`);
    }
    for (const f of ['favicon.ico', 'apple-touch-icon.png', 'site.webmanifest']) {
      if (copyIfNeeded(legacy(f), path.join(config.templatesDir, 'static', f), forceAssets)) copied.push(f);
    }
    const scanned = [raw, fs.readFileSync(legacy('styles.css'), 'utf8'), fs.readFileSync(legacy('sw.js'), 'utf8'), fs.readFileSync(legacy('site.webmanifest'), 'utf8')].join('\n');
    const localRefs = new Set(scanned.match(/(?<![\w/.-])(?:media|img)\/[\w.-]+\.(?:webp|png|jpe?g|mp4|webm|svg|ico|avif)/g) || []);
    for (const ref of localRefs) {
      const to = ref.startsWith('media/') ? path.join(config.mediaDir, ref.slice(6)) : path.join(config.templatesDir, 'static', ref);
      if (copyIfNeeded(legacy(ref), to, forceAssets)) copied.push(ref);
    }
  }

  /* ---------- Base de données ---------- */
  const now = nowIso();
  db.transaction(() => {
    if (force) {
      db.pragma('defer_foreign_keys = ON');
      for (const t of CONTENT_TABLES) db.prepare(`DELETE FROM ${t}`).run();
    }
    const setSetting = db.prepare('INSERT INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)');
    for (const [k, v] of Object.entries(settings)) setSetting.run(k, JSON.stringify(v), now);

    const insPage = db.prepare(`INSERT INTO cms_pages (key, template, parent_id, in_sitemap, is_active, position, created_at, updated_at)
      VALUES (?, ?, NULL, ?, 1, ?, ?, ?)`);
    const insPageI18n = db.prepare(`INSERT INTO cms_page_i18n (page_id, lang, slug, path, title, meta_description, noindex, status, source_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`);
    const pageIds = new Map();
    pages.forEach((p, i) => {
      const id = insPage.run(p.key, `pages/${p.key}.html`, p.noindex ? 0 : 1, i, now, now).lastInsertRowid;
      pageIds.set(p.key, id);
      const slug = p.key === 'accueil' ? '' : p.key;
      insPageI18n.run(id, LANG, slug, slug ? `/${LANG}/${slug}/` : `/${LANG}/`, p.title, p.description, p.noindex ? 1 : 0, sha(`${p.title}\n${p.description}`), now);
    });
    const setParent = db.prepare('UPDATE cms_pages SET parent_id = ? WHERE id = ?');
    for (const p of pages) if (p.parent && pageIds.has(p.parent)) setParent.run(pageIds.get(p.parent), pageIds.get(p.key));

    const insEntry = db.prepare(`INSERT INTO cms_entries (key, page_id, section, type, label, translatable, required, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`);
    const insValue = db.prepare(`INSERT INTO cms_entry_values (entry_id, lang, value, status, source_hash, updated_at)
      VALUES (?, ?, ?, 'ready', ?, ?)`);
    ex.entries.forEach((e, i) => {
      const id = insEntry.run(e.key, pageIds.get(e.scope) ?? null, e.section || null, e.type, e.label, i, now, now).lastInsertRowid;
      insValue.run(id, LANG, e.value, sha(e.value), now);
    });

    if (liveStrip) {
      const bannerId = db.prepare(`INSERT INTO cms_banners (name, variant, icon, cta_kind, cta_target, dismissible, priority, is_active, scope, created_at, updated_at)
        VALUES ('Soirées Live Music', 'evenement', 'i-music', 'page', ?, 1, 0, 1, 'live-music', ?, ?)`).run(`page:${liveStrip.route || 'live-music'}`, now, now).lastInsertRowid;
      db.prepare(`INSERT INTO cms_banner_i18n (banner_id, lang, text, cta_label, status, source_hash) VALUES (?, ?, ?, ?, 'ready', ?)`)
        .run(bannerId, LANG, liveStrip.text, liveStrip.ctaLabel, sha(`${liveStrip.text}\n${liveStrip.ctaLabel}`));
      const place = db.prepare(`INSERT INTO cms_banner_placements (banner_id, zone, page_id) VALUES (?, 'top-bar', ?)`);
      for (const key of liveStripPages) place.run(bannerId, pageIds.get(key));
    }

    const insCollection = db.prepare('INSERT OR REPLACE INTO cms_collections (key, label, item_template, parent_page, schema) VALUES (?, ?, ?, ?, ?)');
    const insItem = db.prepare('INSERT INTO cms_items (collection, key, data, is_active, position, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)');
    const insItemI18n = db.prepare(`INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at)
      VALUES (?, ?, ?, ?, 'ready', ?, ?)`);
    const lists = {
      rooms: Object.entries(data.rooms),
      services: Object.entries(data.services),
      amenities: Object.entries(data.amenities),
      reviews: data.reviews.items.map((r, i) => [`avis-${String(i + 1).padStart(2, '0')}`, r]),
      chat: data.chat.intents.map((it) => [it.id, it]),
      gigs: [], // programme saisi dans le back-office
      artists: [],
      links: [], // repris des gabarits par ensureLinkLists
      menus: [], // repris par ensureMenus
      offers: [], // reprises par ensureOffers
      meeting_rooms: [], // reprises par ensureMeetingRooms
      posts: [], // repris par ensurePosts
    };
    for (const [key, def] of Object.entries(COLLECTIONS)) {
      insCollection.run(key, def.label, def.itemTemplate || null, def.parentPage ? pageIds.get(def.parentPage) : null, JSON.stringify({ translatable: def.translatable }));
      lists[key].forEach(([itemKey, value], i) => {
        const { base, translated } = splitTranslatable(value, def.translatable);
        const id = insItem.run(key, itemKey, JSON.stringify(base), i, now, now).lastInsertRowid;
        const tr = JSON.stringify(translated);
        insItemI18n.run(id, LANG, def.itemTemplate ? itemKey : null, tr, sha(tr), now);
      });
    }
  })();

  ensureUiStrings(db); // textes d'interface du JavaScript (ui.*)
  ensureLinkLists(db); // menus et listes de liens des gabarits
  ensureMenus(db); // cartes du restaurant et des bars
  ensureRoomCards(db); // chambres de la page Chambres et de l'accueil
  ensureOffers(db); // offres de la page Offres et de l'accueil
  ensureMeetingRooms(db); // salles de séminaire (tableau des capacités, formulaire de devis)
  ensurePosts(db); // articles du blog (repris du gabarit de la page Blog)
  ensureBlogMenu(db); // entrée « Blog » des menus, après Accès
  ensureBlockEntries(db); // textes ajoutés avec les blocs des pages (liens, chiffres)
  ensureJsonLd(db); // données structurées : modèle unique, textes traduisibles jsonld.*
  ensureLegalTexts(db); // mentions légales du bas du pied de page (global.mentions-*)
  ensureChatChips(db); // pastilles du chat ajoutées après la maquette (global.chat-pastille-*)
  ensureLegalPage(db); // page Mentions légales (textes dans toutes les langues, hébergeur à remplir)
  ensurePrivacyPage(db); // page Politique de confidentialité (textes dans toutes les langues, liens de l'ancien site redirigés)
  ensureGoogleReviews(db); // avis de démonstration → table des avis Google (exemples)
  ensureLanguagePacks(db, { log }); // langues livrées toutes traduites (seeds/langues : fi, pl, th, id)
  const counts = { pages: pages.length, entries: ex.entries.length, items: db.prepare('SELECT COUNT(*) FROM cms_items').pluck().get(), copied: copied.length };
  log(`Import : ${counts.pages} pages, ${counts.entries} textes, ${counts.items} éléments de collection, ${counts.copied} fichiers copiés.`);
  return counts;
}
