/**
 * Orchestration d'un build (ARCHITECTURE.md § 5) :
 * prévisualisation (base de travail → preview/), publication (snapshot → releases/<id>/ → en ligne),
 * régénération planifiée (snapshot en cours → nouvelle version seulement si le résultat change).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { config, fromVarPath, toVarPath } from '../config.js';
import { getDb, openDb } from '../db/connection.js';
import { sha, nowIso } from '../lib/util.js';
import { Source } from './source.js';
import { renderPage } from './render.js';
import { fillRoom, fillService } from './items.js';
import { prepareAssets, webManifest, serviceWorker } from './assets.js';
import { sitemapXml, robotsTxt, redirectsCaddy } from './sitemap.js';
import { llmsTxt } from './llms.js';
import { globalGraph } from './jsonld.js';
import { createSnapshot, createScopedSnapshot } from './snapshot.js';
import { activateRelease, pruneReleases, writeTree, currentBuild, moveDir } from './release.js';
import { withBuildLock } from './lock.js';
import { notifyIndexNow } from './indexnow.js';

const ITEM_FILL = { rooms: { view: 'chambre', fill: fillRoom }, services: { view: 'service', fill: fillService } };

/** Clés data-cms-* utilisées par un morceau de HTML. */
function keysOf(html, lists = new Set()) {
  // Liens des listes reprises dans la collection « links » : leurs anciens textes n'existent plus
  if (lists.size && html.includes('data-cms-links')) {
    const $ = cheerio.load(html, null, false);
    $('[data-cms-links]').each((i, el) => { if (lists.has(el.attribs['data-cms-links'])) $(el).children().remove(); });
    html = $.html();
  }
  const keys = new Set();
  for (const m of html.matchAll(/data-cms-(?:key|html)="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-cms-text="([^"]+)"/g)) m[1].split(',').forEach((k) => keys.add(k));
  for (const m of html.matchAll(/data-cms-attr="([^"]+)"/g)) m[1].split(';').forEach((p) => keys.add(p.slice(p.indexOf(':') + 1)));
  return keys;
}

function loadTemplates(dir) {
  const templates = new Map();
  for (const sub of ['pages', 'items']) {
    for (const f of fs.readdirSync(path.join(dir, sub))) {
      if (f.endsWith('.html')) templates.set(`${sub}/${f}`, fs.readFileSync(path.join(dir, sub, f), 'utf8'));
    }
  }
  return templates;
}

/** Infos pratiques de l'accueil, recopiées dans les emplacements data-house-rules (identifiants retirés). */
function houseRules(templates) {
  const $ = cheerio.load(templates.get('pages/accueil.html') || '', null, false);
  const src = $('[data-house-rules-source]').first();
  if (!src.length) return '';
  src.removeAttr('data-house-rules-source');
  src.find('[id]').removeAttr('id');
  return $.html(src);
}

const hashFiles = (files) => sha([...files.keys()].sort().map((k) => `${k}\0${sha(files.get(k))}`).join('\n'));
const fileOf = (urlPath) => `${urlPath.replace(/^\//, '')}index.html`;

/**
 * Génère tout le site en mémoire.
 * @returns { files: Map, errors, warnings, pageState, langs, pages, changedUrls }
 */
export function generateSite({ source, mode, now, previousState = new Map(), only = null }) {
  const basePath = mode === 'preview' ? '/preview' : '';
  const errors = [];
  const warnings = new Set();
  const layoutHtml = fs.readFileSync(path.join(config.templatesDir, 'layout.html'), 'utf8');
  const templates = loadTemplates(config.templatesDir);
  const houseRulesHtml = houseRules(templates);
  const assets = prepareAssets({ templatesDir: config.templatesDir, mediaDir: config.mediaDir, basePath });
  const { settings, defaultLang } = source;
  const langs = source.activeLangs.map((l) => l.code);
  const bookingBase = (lang) => (settings.booking_engine?.base || '')
    .replace('{lang}', source.lang(lang).booking_lang)
    .replace('{locale}', source.lang(lang).locale);

  /* Cibles : pages + fiches des collections qui ont un gabarit */
  // Textes d'interface du JavaScript : requis sur toutes les pages, comme ceux du layout
  const linkLists = new Set(settings.link_lists || []);
  const layoutKeys = new Set([...keysOf(layoutHtml, linkLists), ...[...source.entries.keys()].filter((k) => k.startsWith('ui.'))]);
  const houseKeys = keysOf(houseRulesHtml);
  const targets = [];
  for (const page of source.pages) {
    const html = templates.get(page.template);
    if (!html) { errors.push(`Gabarit manquant : ${page.template}`); continue; }
    const keys = new Set([...layoutKeys, ...keysOf(html, linkLists), ...(html.includes('data-house-rules') ? houseKeys : [])]);
    targets.push({ type: 'page', page, keys, route: page.key === 'accueil' ? '' : page.key });
  }
  for (const [collection, def] of source.collections) {
    if (!def.item_template || !ITEM_FILL[collection]) continue;
    const parent = source.pagesById.get(def.parent_page);
    const html = templates.get(def.item_template);
    const keys = new Set([...layoutKeys, ...keysOf(html, linkLists), ...(html.includes('data-house-rules') ? houseKeys : [])]);
    keys.add(collection === 'rooms' ? 'item-chambre.galerie' : 'item-service.faq-titre');
    for (const item of source.collectionItems(collection, defaultLang, now)) {
      targets.push({ type: 'item', collection, itemKey: item.key, parent, keys, route: `${parent.key}/${item.key}`, view: ITEM_FILL[collection].view, template: def.item_template });
    }
  }

  /* Adresse de chaque cible dans chaque langue, et publication possible ou non */
  const published = new Map(); // lang → Map(route → path)
  const info = new Map(); // `${lang}|${route}` → { path, missing }
  for (const lang of langs) {
    const routes = new Map();
    for (const t of targets) {
      let urlPath;
      let missing = false;
      if (t.type === 'page') {
        const meta = source.pageMeta(t.page, lang);
        if (!meta) continue;
        urlPath = meta.path;
        missing = meta.missing;
      } else {
        const item = source.collectionItems(t.collection, lang, now).find((i) => i.key === t.itemKey);
        const parentMeta = source.pageMeta(t.parent, lang);
        if (!item || !parentMeta) continue;
        urlPath = `${parentMeta.path}${item.slug}/`;
        missing = item.missing || parentMeta.missing;
      }
      if (!missing) missing = [...t.keys].some((k) => source.text(k, lang).missing);
      info.set(`${lang}|${t.route}`, { path: urlPath, missing });
      if (mode === 'preview' || !missing || lang === defaultLang) routes.set(t.route, basePath + urlPath);
    }
    published.set(lang, routes);
  }
  // Lien vers une page non traduite : on renvoie vers sa version dans la langue par défaut
  const routes = new Map();
  for (const lang of langs) {
    const own = published.get(lang);
    const merged = new Map(published.get(defaultLang));
    for (const [k, v] of own) merged.set(k, v);
    routes.set(lang, merged);
  }

  const site = {
    source, mode, now, basePath, layoutHtml, templates, houseRulesHtml, assets, routes, bookingBase,
    siteUrl: config.siteUrl,
    warn: (msg) => warnings.add(msg),
    clientConfig: (lang) => ({
      lang,
      locale: source.lang(lang).locale,
      site: config.siteUrl,
      base: basePath,
      bookingBase: bookingBase(lang),
      booking: { params: settings.booking_engine?.params || null, rooms: settings.booking_engine?.rooms || null, offers: settings.booking_engine?.offers || null },
      roomNames: Object.fromEntries(source.collectionItems('rooms', lang, now).map((r) => [r.key, r.data.name || r.key])), // fenêtre de réservation, chambres ajoutées
      offerNames: Object.fromEntries(source.collectionItems('offers', lang, now).map((o) => [o.key, o.data.title || o.key])),
      paths: Object.fromEntries(routes.get(lang)),
      sw: mode === 'production' ? `${basePath}/sw.js` : null,
      track: mode === 'production' ? '/api/track' : null, // la prévisualisation n'est jamais comptée
      i18n: source.uiStrings(lang),
    }),
  };

  /* Rendu */
  const files = new Map(assets.files);
  const pages = [];
  const titles = new Map();
  const xDefaultLang = settings.x_default_lang;
  for (const t of targets) {
    if (only && only.route !== t.route) continue;
    const langsAll = langs.filter((l) => published.get(l).has(t.route) && (mode === 'preview' || !info.get(`${l}|${t.route}`)?.missing || l === defaultLang));
    const langsOk = langsAll.filter((l) => !only || only.lang === l);
    const translated = (l) => mode === 'preview' || !info.get(`${l}|${t.route}`).missing;
    const alternates = langsOk
      .filter(translated)
      .map((l) => ({ lang: l, href: config.siteUrl + info.get(`${l}|${t.route}`).path }));
    const xDefault = (alternates.find((a) => a.lang === xDefaultLang) || alternates.find((a) => a.lang === defaultLang))?.href;
    // Sélecteur de langue, adresses du site servi (préfixe /preview compris) : la page dans chaque langue où elle est
    // publiée ; ailleurs, la page parente la plus proche publiée dans cette langue (à défaut l'accueil)
    const nearest = (l) => {
      for (let p = t.type === 'page' ? source.pagesById.get(t.page.parent_id) : t.parent; p; p = source.pagesById.get(p.parent_id)) {
        const href = published.get(l).get(p.key === 'accueil' ? '' : p.key);
        if (href) return href;
      }
      return published.get(l).get('');
    };
    const switcher = langs
      .map((l) => ({ lang: l, name: source.lang(l).native_name, href: langsAll.includes(l) && translated(l) ? basePath + info.get(`${l}|${t.route}`).path : nearest(l) }))
      .filter((s) => s.href);
    for (const lang of langsOk) {
      const { path: urlPath, missing } = info.get(`${lang}|${t.route}`);
      if (mode === 'production' && missing && lang !== defaultLang) continue;
      const meta = t.type === 'page' ? source.pageMeta(t.page, lang) : null;
      const target = t.type === 'page' ? { type: 'page', page: t.page } : {
        type: 'item', route: t.route, view: t.view, template: t.template, parentId: t.parent.id,
        fill: ($, view, text) => {
          const all = source.collectionItems(t.collection, lang, now);
          const item = all.find((i) => i.key === t.itemKey);
          const cdn = settings.cdn_base;
          const media = (id) => source.mediaFor(id, lang);
          if (t.collection === 'rooms') {
            const amenities = new Map(source.collectionItems('amenities', lang, now).map((a) => [a.key, a.data]));
            return fillRoom($, view, { room: item, rooms: all, amenities, cdn, media, siteUrl: config.siteUrl, t: text, routeKey: t.parent.key });
          }
          return fillService($, view, { service: item, cdn, media, t: text });
        },
      };
      const head = {
        path: urlPath,
        title: meta?.title,
        description: meta?.meta_description,
        canonical: config.siteUrl + urlPath,
        alternates,
        xDefault,
        switcher,
        noindex: Boolean(meta?.noindex),
        ogImage: settings.og_image_default,
      };
      const out = renderPage(site, lang, target, head);
      if (out.unknown.size) errors.push(`${urlPath} : clé(s) sans contenu ${[...out.unknown].slice(0, 3).join(', ')}`);
      if (out.brokenLinks.size) {
        const msg = `${urlPath} : lien(s) vers des pages inconnues ${[...out.brokenLinks].join(', ')}`;
        if (mode === 'production') errors.push(msg);
        else warnings.add(msg);
      }
      if (out.parentLinks.size) warnings.add(`${urlPath} : lien(s) vers une fiche masquée ou supprimée, menant à sa page parente : ${[...out.parentLinks].join(', ')}`);
      if (lang === defaultLang && out.missing.size) errors.push(`${urlPath} : ${out.missing.size} texte(s) vide(s) dans la langue par défaut`);
      if (!missing) {
        // Contrôles SEO sur les seules pages réellement rédigées dans cette langue
        if (out.title?.length > 60) warnings.add(`${urlPath} : title de ${out.title.length} caractères (60 conseillés)`);
        if (out.description?.length > 160) warnings.add(`${urlPath} : description de ${out.description.length} caractères (160 conseillés)`);
        if (titles.has(`${lang}|${out.title}`)) warnings.add(`${urlPath} : même title que ${titles.get(`${lang}|${out.title}`)}`);
        titles.set(`${lang}|${out.title}`, urlPath);
      }

      const isNotFound = t.type === 'page' && t.page.key === '404';
      if (isNotFound) {
        files.set(`${lang}/404.html`, out.html);
        if (lang === defaultLang) files.set('404.html', out.html);
      } else {
        files.set(fileOf(urlPath), out.html);
      }
      const prev = previousState.get(`${lang}|${urlPath}`);
      const lastmod = prev && prev.content_hash === out.contentHash ? prev.lastmod : now.toISOString();
      pages.push({
        lang, path: urlPath, contentHash: out.contentHash, lastmod, changed: !prev || prev.content_hash !== out.contentHash,
        inSitemap: !isNotFound && !head.noindex && (t.type === 'item' || Boolean(t.page.in_sitemap)),
        alternates, xDefault, images: out.images, missingCount: out.missing.size,
        title: out.title, description: out.description, kind: t.type === 'page' ? 'page' : t.collection,
      });
    }
  }
  if (mode === 'preview') {
    const incomplete = pages.filter((p) => p.missingCount);
    for (const lang of langs.filter((l) => l !== defaultLang)) {
      const n = incomplete.filter((p) => p.lang === lang).length;
      if (n) warnings.add(`${lang.toUpperCase()} : ${n} page(s) incomplète(s), affichées avec le texte ${defaultLang.toUpperCase()} en repli`);
    }
  } else {
    for (const lang of langs.filter((l) => l !== defaultLang)) {
      if (!pages.some((p) => p.lang === lang)) warnings.add(`${lang.toUpperCase()} : aucune page entièrement traduite, langue non publiée`);
    }
  }

  /* Fichiers annexes */
  const sitemapEntries = pages.filter((p) => p.inSitemap).map((p) => ({
    loc: config.siteUrl + p.path, lastmod: p.lastmod, alternates: p.alternates, xDefault: p.xDefault, images: p.images,
  }));
  files.set('sitemap.xml', sitemapXml(sitemapEntries));
  files.set('robots.txt', robotsTxt(config.siteUrl));
  // Résumé pour les assistants IA : /llms.txt dans la langue par défaut, /<langue>/llms.txt pour chaque langue publiée
  const homes = pages.filter((p) => p.kind === 'page' && p.path === `/${p.lang}/`)
    .map((p) => ({ lang: p.lang, name: source.lang(p.lang).native_name || p.lang, url: config.siteUrl + p.path }));
  for (const lang of new Set(pages.map((p) => p.lang))) {
    const txt = llmsTxt({ siteUrl: config.siteUrl, lang, graph: globalGraph(source, lang), pages, homes });
    files.set(`${lang}/llms.txt`, txt);
    if (lang === defaultLang) files.set('llms.txt', txt);
  }
  files.set('site.webmanifest', webManifest({ templatesDir: config.templatesDir, assets, basePath, defaultLang }));
  // Une adresse redevenue une page (fiche recréée sous le même nom) n'est plus redirigée
  const live = new Set(pages.map((p) => p.path));
  const redirects = source.redirects.map((r) => {
    const page = r.to_page ? source.pagesById.get(r.to_page) : null;
    const to = page ? source.pageMeta(page, r.to_lang || defaultLang)?.path : r.to_url;
    return to && !live.has(r.from_path) ? { from: r.from_path, to, code: r.code } : null;
  }).filter(Boolean);
  files.set('_meta/redirects.caddy', redirectsCaddy({ redirects, defaultLang }));
  files.set('_meta/pages.json', JSON.stringify(pages.map(({ lang, path: p, contentHash, lastmod }) => ({ lang, path: p, contentHash, lastmod })), null, 2));
  if (config.indexNowKey && mode === 'production') files.set(`${config.indexNowKey}.txt`, config.indexNowKey);
  if (mode === 'production') {
    files.set('sw.js', serviceWorker({ templatesDir: config.templatesDir, assets, basePath, defaultLang, version: `v-${hashFiles(files).slice(0, 10)}` }));
  }

  return {
    files,
    errors,
    warnings: [...warnings],
    pages,
    langs: [...new Set(pages.map((p) => p.lang))],
    changedUrls: pages.filter((p) => p.changed && p.inSitemap).map((p) => config.siteUrl + p.path),
  };
}

/** Une seule page, en mémoire, depuis la base de travail (contrôles SEO de l'admin). */
export function renderOne(db, { route, lang, now = new Date() }) {
  const source = new Source(db, { mode: 'preview' });
  if (!source.lang(lang)?.is_active) source.activeLangs = [...source.activeLangs, source.lang(lang)].filter(Boolean);
  const result = generateSite({ source, mode: 'preview', now, only: { route, lang } });
  const page = result.pages.find((p) => p.lang === lang);
  if (!page) return null;
  const file = route === '404' ? `${lang}/404.html` : fileOf(page.path);
  return { html: String(result.files.get(file)), path: page.path, warnings: result.warnings };
}

function loadPageState(db) {
  return new Map(db.prepare('SELECT * FROM sys_page_state').all().map((r) => [`${r.lang}|${r.path}`, r]));
}

function savePageState(db, pages) {
  const upsert = db.prepare(`INSERT INTO sys_page_state (lang, path, content_hash, lastmod, first_seen_at) VALUES (@lang, @path, @contentHash, @lastmod, @lastmod)
    ON CONFLICT (lang, path) DO UPDATE SET content_hash = excluded.content_hash, lastmod = excluded.lastmod`);
  db.transaction(() => pages.forEach((p) => upsert.run(p)))();
}

/**
 * Lance un build et l'enregistre dans sys_builds.
 * @param kind     'preview' | 'production'
 * @param trigger  'manual' | 'cron'
 */
export function runBuild({ kind = 'preview', trigger = 'manual', now = new Date(), userId = null, scope = null, log = console.log } = {}) {
  return withBuildLock(async () => {
    const db = getDb();
    const started = Date.now();
    const id = Number(db.prepare(`INSERT INTO sys_builds (kind, triggered_by, status, user_id, started_at) VALUES (?, ?, 'running', ?, ?)`)
      .run(kind, trigger, userId, nowIso()).lastInsertRowid);
    const finish = (fields) => {
      const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE sys_builds SET ${sets}, finished_at = @finished_at WHERE id = @id`).run({ ...fields, finished_at: nowIso(), id });
    };
    let srcDb = null;
    let snapshotPath = null;
    let ownSnapshot = false;
    let tmpDir = null;
    // Le snapshot doit être fermé avant d'être supprimé (Windows refuse d'effacer un fichier ouvert)
    const dropOwnSnapshot = () => {
      srcDb?.close();
      srcDb = null;
      if (ownSnapshot && snapshotPath) fs.rmSync(snapshotPath, { force: true });
    };
    try {
      const current = currentBuild(db);
      if (kind === 'production') {
        if (trigger === 'cron') {
          if (!current?.snapshot_path) throw new Error("Rien n'est encore publié : la régénération attend une première publication.");
          snapshotPath = fromVarPath(current.snapshot_path);
        } else if (scope?.length) {
          // Compte limité : seule sa partie change, le reste repart du contenu en ligne
          snapshotPath = createScopedSnapshot(db, id, scope, fromVarPath(current?.snapshot_path));
          ownSnapshot = true;
        } else {
          snapshotPath = createSnapshot(db, id);
          ownSnapshot = true;
        }
        srcDb = openDb(snapshotPath, { readonly: true });
      }
      const source = new Source(srcDb || db, { mode: kind });
      const result = generateSite({ source, mode: kind, now, previousState: kind === 'production' ? loadPageState(db) : new Map() });
      if (result.errors.length && kind === 'production') throw new Error(result.errors.slice(0, 8).join(' · '));
      const outputHash = hashFiles(result.files);
      const summary = {
        output_hash: outputHash,
        pages_count: result.pages.length,
        langs: JSON.stringify(result.langs),
        warnings: JSON.stringify([...(scope?.length ? [`Publication limitée au périmètre : ${scope.join(', ')}`] : []), ...result.errors, ...result.warnings]),
      };

      if (kind === 'production' && current?.output_hash === outputHash) {
        dropOwnSnapshot();
        finish({ ...summary, status: 'skipped', snapshot_path: current.snapshot_path });
        log(trigger === 'cron' ? 'Régénération : rien de changé, la version en ligne est conservée.' : 'Le site en ligne est déjà à jour.');
      } else {
        tmpDir = path.join(config.varDir, `.build-${id}`); // même disque que preview/ et releases/ : renommage atomique
        fs.rmSync(tmpDir, { recursive: true, force: true });
        writeTree(tmpDir, result.files);
        if (kind === 'preview') {
          moveDir(tmpDir, config.previewDir);
          finish({ ...summary, status: 'success' });
        } else {
          fs.mkdirSync(config.releasesDir, { recursive: true });
          const releasePath = path.join(config.releasesDir, String(id));
          moveDir(tmpDir, releasePath); // un ancien dossier du même numéro (base recréée) est remplacé
          finish({ ...summary, status: 'success', snapshot_path: toVarPath(snapshotPath), release_path: toVarPath(releasePath) });
          activateRelease(db, id, releasePath);
          savePageState(db, result.pages);
          pruneReleases(db);
          await notifyIndexNow({ siteUrl: config.siteUrl, key: config.indexNowKey, urls: result.changedUrls, log });
        }
        tmpDir = null;
      }
    } catch (err) {
      finish({ status: 'failed', error: err.message });
      try {
        dropOwnSnapshot();
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        log(`Nettoyage incomplet après l'échec : ${cleanupErr.message}`);
      }
    } finally {
      srcDb?.close();
    }
    return { ...db.prepare('SELECT * FROM sys_builds WHERE id = ?').get(id), duration: Date.now() - started };
  });
}
