/**
 * Blog : reprise des articles du gabarit dans les fiches, entrée « Blog » des menus après Accès,
 * page Blog et pages d'articles, vidéo lancée au clic, repli des langues (anglais prêt, sinon français).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-blog-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';
process.env.SITE_URL = 'https://www.hotel-aston.com';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');
const { config } = await import('../server/config.js');
const { ensurePosts, ensureBlogMenu, excerpt } = await import('../server/ssg/posts.js');
const { generateSite } = await import('../server/ssg/build.js');
const { Source } = await import('../server/ssg/source.js');
const { nowIso, sha } = await import('../server/lib/util.js');

let app;
let db;
let session;
const PASSWORD = 'mot-de-passe-de-test-123';

function call(method, url, payload) {
  return app.inject({ method, url, payload, headers: { cookie: session.cookie, 'x-csrf-token': session.csrf } });
}
const page = (rel) => cheerio.load(fs.readFileSync(path.join(config.previewDir, rel, 'index.html'), 'utf8'));
const preview = async () => assert.equal((await call('POST', '/api/builds/preview', {})).statusCode, 200);
const post = (key) => db.prepare("SELECT * FROM cms_items WHERE collection = 'posts' AND key = ?").get(key);
const menu = (list, lang = 'fr') => db.prepare(`SELECT i.key, json_extract(i.data, '$.page') AS page, json_extract(t.data, '$.label') AS label FROM cms_items i
  LEFT JOIN cms_item_i18n t ON t.item_id = i.id AND t.lang = ? WHERE i.collection = 'links' AND json_extract(i.data, '$.list') = ? AND json_extract(i.data, '$.parent') IS NULL ORDER BY i.position, i.id`).all(lang, list);

before(async () => {
  db = getDb();
  importLegacy(db, { writeTemplates: false, log: () => {} });
  db.prepare(`INSERT INTO sys_users (email, name, password_hash, role, langs, is_active, created_at) VALUES (?, ?, ?, 'admin', NULL, 1, ?)`)
    .run('admin@test.fr', 'Admin', await hashPassword(PASSWORD), nowIso());
  app = await buildApp({ logger: false });
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@test.fr', password: PASSWORD } });
  session = { cookie: res.headers['set-cookie'].split(';')[0], csrf: res.json().csrf };
});

after(async () => {
  await app?.close();
  closeDb();
  fs.rmSync(VAR, { recursive: true, force: true });
});

test('articles du gabarit repris dans les fiches, textes retirés', () => {
  const keys = db.prepare("SELECT key FROM cms_items WHERE collection = 'posts' ORDER BY position").pluck().all();
  assert.deepEqual(keys, ['vieille-ville-a-pied', 'coup-de-canon-de-midi', 'carnaval-de-nice']);
  const fr = JSON.parse(db.prepare("SELECT data FROM cms_item_i18n WHERE item_id = ? AND lang = 'fr'").pluck().get(post('coup-de-canon-de-midi').id));
  assert.equal(fr.category, 'Histoire');
  assert.equal(fr.title, 'Le coup de canon de midi est né sur notre terrasse');
  assert.match(fr.body, /^<p>En 1861, Sir Thomas Coventry.*<a href="#\/notre-histoire">Lire notre histoire<\/a>\.<\/p>$/);
  const plainBody = JSON.parse(db.prepare("SELECT data FROM cms_item_i18n WHERE item_id = ? AND lang = 'fr'").pluck().get(post('vieille-ville-a-pied').id)).body;
  assert.match(plainBody, /^<p>Traversez la Promenade du Paillon/);
  assert.deepEqual(db.prepare("SELECT key FROM cms_entries WHERE key LIKE 'blog.%' ORDER BY key").pluck().all(), ['blog.001-nav@aria-label', 'blog.002-a', 'blog.003-span', 'blog.004-h1']);
  const c = db.prepare("SELECT * FROM cms_collections WHERE key = 'posts'").get();
  assert.equal(c.item_template, 'items/article.html');
  assert.equal(c.parent_page, db.prepare("SELECT id FROM cms_pages WHERE key = 'blog'").pluck().get());
  assert.equal(ensurePosts(db), 0, 'reprise faite une seule fois');
});

test('entrée « Blog » après Accès dans le menu de l’en-tête et le menu mobile, une seule fois', () => {
  const main = menu('menu-principal').map((l) => l.page);
  assert.deepEqual(main, ['chambres', 'restaurant-bar', 'seminaires', 'offres', 'acces-contact', 'blog']);
  const mobile = menu('menu-mobile').map((l) => l.page);
  assert.equal(mobile[mobile.indexOf('acces-contact') + 1], 'blog');
  assert.equal(menu('menu-principal').at(-1).label, 'Blog');

  // Base existante (menus déjà repris, sans Blog) : ajouté après Accès, libellés FR et EN ; retiré, il ne revient pas
  const blogLinks = db.prepare("SELECT id FROM cms_items WHERE collection = 'links' AND json_extract(data, '$.page') = 'blog' AND json_extract(data, '$.list') IN ('menu-principal', 'menu-mobile')").pluck().all();
  for (const id of blogLinks) db.prepare('DELETE FROM cms_items WHERE id = ?').run(id);
  db.prepare("DELETE FROM cms_settings WHERE key = 'blog_menu'").run();
  assert.equal(ensureBlogMenu(db), 2);
  assert.deepEqual(menu('menu-principal').map((l) => l.page), main);
  assert.deepEqual(menu('menu-mobile').map((l) => l.page), mobile);
  assert.equal(menu('menu-principal', 'en').at(-1).label, 'Blog');
  const added = menu('menu-principal').at(-1).key;
  db.prepare("DELETE FROM cms_items WHERE collection = 'links' AND key = ?").run(added);
  assert.equal(ensureBlogMenu(db), 0);
  assert.ok(!menu('menu-principal').some((l) => l.page === 'blog'));
  ensureBlogMenu(db);
});

test('page Blog et pages d’articles (prévisualisation)', async () => {
  // L'entrée retirée au test précédent est remise pour vérifier l'en-tête
  db.prepare("DELETE FROM cms_settings WHERE key = 'blog_menu'").run();
  ensureBlogMenu(db);
  await preview();
  const $ = page('fr/blog');
  assert.equal($('h1').text(), "Le journal de l'Aston : vivre Nice");
  const cards = $('.post-card');
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.find('.post-card__title a').map((i, a) => $(a).attr('href')).get(),
    ['/preview/fr/blog/vieille-ville-a-pied/', '/preview/fr/blog/coup-de-canon-de-midi/', '/preview/fr/blog/carnaval-de-nice/']);
  assert.equal(cards.first().find('.eyebrow').text(), 'Quartier');
  assert.equal(cards.first().find('.post-card__media').length, 0, 'pas de photo : pas de cadre vide');
  assert.equal(cards.first().find('time').length, 0, 'pas de date : pas de ligne vide');
  assert.ok(cards.first().find('.post-card__summary').text().endsWith('…'), 'résumé : début du texte');
  assert.ok($('[data-f], [data-cms-posts]').length === 0);
  assert.deepEqual($('.main-nav a').map((i, a) => $(a).text()).get().slice(-2), ['Accès', 'Blog']);
  assert.equal($('.main-nav a').last().attr('href'), '/preview/fr/blog/');
  assert.equal($('.main-nav a').last().attr('data-nav'), 'blog');
  assert.ok($('.mobile-menu__list a').map((i, a) => $(a).text()).get().includes('Blog'));

  const a = page('fr/blog/coup-de-canon-de-midi');
  assert.equal(a('h1').text(), 'Le coup de canon de midi est né sur notre terrasse');
  assert.equal(a('title').text(), 'Le coup de canon de midi est né sur notre terrasse');
  assert.equal(a('.post-page .eyebrow').text(), 'Histoire');
  assert.equal(a('.post-page__body a').attr('href'), '/preview/fr/notre-histoire/');
  assert.deepEqual(a('.breadcrumb a').map((i, x) => a(x).attr('href')).get(), ['/preview/fr/', '/preview/fr/blog/']);
  assert.equal(a('.breadcrumb [aria-current]').text(), 'Le coup de canon de midi est né sur notre terrasse');
  assert.equal(a('.post-page__media').length, 0);
  assert.equal(a('.post-page[lang]').length, 0);
  const ld = JSON.parse(a('script[type="application/ld+json"]').text())['@graph'];
  const posting = ld.find((n) => n['@type'] === 'BlogPosting');
  assert.equal(posting.headline, 'Le coup de canon de midi est né sur notre terrasse');
  assert.equal(posting.publisher['@id'], 'https://www.hotel-aston.com/#hotel');
  assert.ok(ld.find((n) => n['@type'] === 'BreadcrumbList').itemListElement.length === 3);
});

test('article ajouté dans l’admin : en tête, date, photo ou vidéo lancée au clic', async () => {
  const now = nowIso();
  const mediaId = Number(db.prepare(`INSERT INTO cms_media (kind, original_name, mime, width, height, status, created_at) VALUES ('video', 'promenade.mp4', 'video/mp4', 1280, 720, 'ready', ?)`).run(now).lastInsertRowid);
  db.prepare(`INSERT INTO cms_media_variants (media_id, purpose, format, width, height, bytes, path) VALUES (?, 'original', 'mp4', 1280, 720, 1000, 'promenade-abc.mp4'), (?, 'poster', 'webp', 1280, 720, 100, 'promenade-abc-poster.webp')`).run(mediaId, mediaId);
  db.prepare("INSERT INTO cms_media_i18n (media_id, lang, alt, title) VALUES (?, 'fr', 'La Promenade des Anglais au coucher du soleil', '')").run(mediaId);

  assert.equal((await call('POST', '/api/collections/posts/items', { key: 'sans-titre', data: { title: ' ' } })).statusCode, 400);
  assert.equal((await call('POST', '/api/collections/posts/items', { key: 'mauvaise-date', data: { title: 'X', date: '31/10/2026' } })).statusCode, 400);
  const res = await call('POST', '/api/collections/posts/items', { key: 'promenade', data: {
    title: 'La Promenade des Anglais à vélo', category: 'Balade', date: '2026-10-31', media: mediaId, alt: '', summary: 'Sept kilomètres face à la mer.',
    body: '<p>Départ à 300 m de l’hôtel.</p><script>alert(1)</script><p><a href="#/acces-contact">Venir à l’hôtel</a></p>',
  } });
  assert.equal(res.statusCode, 201);
  assert.ok(!res.json().merged.body.includes('<script'), 'texte riche nettoyé');
  const keys = db.prepare("SELECT key FROM cms_items WHERE collection = 'posts' ORDER BY position, id").pluck().all();
  assert.equal(keys[0], 'promenade', 'nouvel article en tête');

  await preview();
  const $ = page('fr/blog');
  const first = $('.post-card').first();
  assert.equal(first.find('.post-card__title a').text(), 'La Promenade des Anglais à vélo');
  assert.equal(first.find('time').attr('datetime'), '2026-10-31');
  assert.equal(first.find('time').text(), '31 octobre 2026');
  assert.equal(first.find('.post-card__summary').text(), 'Sept kilomètres face à la mer.');
  assert.equal(first.find('.post-card__media img').attr('src'), '/media/promenade-abc-poster.webp');
  assert.equal(first.find('.post-card__play').length, 1);

  const a = page('fr/blog/promenade');
  const video = a('.post-page__media video');
  assert.equal(video.attr('src'), '/media/promenade-abc.mp4');
  assert.equal(video.attr('poster'), '/media/promenade-abc-poster.webp');
  assert.ok(video.is('[controls][playsinline]'));
  assert.equal(video.attr('preload'), 'none');
  assert.equal(video.attr('autoplay'), undefined);
  assert.equal(video.attr('loop'), undefined);
  assert.equal(video.attr('muted'), undefined);
  assert.equal(video.attr('aria-label'), 'La Promenade des Anglais au coucher du soleil');
  assert.equal(a('.post-page__body a').attr('href'), '/preview/fr/acces-contact/');
  assert.equal(a('meta[name="description"]').attr('content'), 'Sept kilomètres face à la mer.');
  const posting = JSON.parse(a('script[type="application/ld+json"]').text())['@graph'].find((n) => n['@type'] === 'BlogPosting');
  assert.equal(posting.datePublished, '2026-10-31');
  assert.equal(posting.image, 'https://www.hotel-aston.com/media/promenade-abc-poster.webp');
  assert.equal(excerpt('mot '.repeat(80), 40).endsWith('…'), true);
});

test('langues : article non traduit en anglais s’il y est prêt, sinon en français', () => {
  const now = nowIso();
  // Site entièrement traduit en anglais et en allemand (copie des textes français, prêts)
  db.prepare("UPDATE cms_languages SET is_active = 1 WHERE code IN ('en', 'de')").run();
  for (const lang of ['en', 'de']) {
    db.prepare(`INSERT OR REPLACE INTO cms_entry_values (entry_id, lang, value, status, source_hash, updated_at)
      SELECT entry_id, ?, value, 'ready', source_hash, ? FROM cms_entry_values WHERE lang = 'fr'`).run(lang, now);
    db.prepare(`INSERT OR REPLACE INTO cms_page_i18n (page_id, lang, slug, path, title, meta_description, noindex, status, source_hash, updated_at)
      SELECT page_id, ?, slug, CASE WHEN slug = '' THEN '/' || ? || '/' ELSE '/' || ? || '/' || slug || '/' END, title, meta_description, noindex, 'ready', source_hash, ? FROM cms_page_i18n WHERE lang = 'fr'`).run(lang, lang, lang, now);
  }
  // Vieille Ville : traduite en anglais seulement ; le coup de canon : pas traduit ; Carnaval : brouillon allemand
  const tr = (key, lang, data, status = 'ready') => db.prepare(`INSERT OR REPLACE INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(post(key).id, lang, key, JSON.stringify(data), status, sha('x'), now);
  db.prepare("DELETE FROM cms_item_i18n WHERE item_id IN (SELECT id FROM cms_items WHERE collection = 'posts') AND lang <> 'fr'").run();
  tr('vieille-ville-a-pied', 'en', { category: 'Neighbourhood', title: 'The Old Town on foot, in two hours', body: '<p>Cross the Promenade du Paillon.</p>' });
  tr('carnaval-de-nice', 'de', { title: 'Karneval in Nizza' }, 'draft');

  const result = generateSite({ source: new Source(db, { mode: 'production' }), mode: 'production', now: new Date() });
  const html = (p) => cheerio.load(String(result.files.get(`${p.replace(/^\//, '')}index.html`)));
  const site = 'https://www.hotel-aston.com';

  // Anglais : sa propre traduction, indexée, avec ses versions de langue
  const en = html('/en/blog/vieille-ville-a-pied/');
  assert.equal(en('h1').text(), 'The Old Town on foot, in two hours');
  assert.equal(en('link[rel="canonical"]').attr('href'), `${site}/en/blog/vieille-ville-a-pied/`);
  assert.deepEqual(en('link[rel="alternate"][hreflang]').map((i, l) => en(l).attr('hreflang')).get().sort(), ['en', 'fr', 'x-default']);

  // Allemand : l'anglais prêt prend le relais ; la page renvoie vers la version anglaise
  const de = html('/de/blog/vieille-ville-a-pied/');
  assert.equal(de('html').attr('lang'), 'de');
  assert.equal(de('.post-page').attr('lang'), 'en');
  assert.equal(de('h1').text(), 'The Old Town on foot, in two hours');
  assert.equal(de('link[rel="canonical"]').attr('href'), `${site}/en/blog/vieille-ville-a-pied/`);
  assert.equal(de('.breadcrumb a').last().attr('href'), '/de/blog/');

  // Pas d'anglais : le français ; un brouillon allemand ne compte pas en production
  const canon = html('/de/blog/coup-de-canon-de-midi/');
  assert.equal(canon('.post-page').attr('lang'), 'fr');
  assert.equal(canon('h1').text(), 'Le coup de canon de midi est né sur notre terrasse');
  assert.equal(canon('link[rel="canonical"]').attr('href'), `${site}/fr/blog/coup-de-canon-de-midi/`);
  assert.equal(html('/en/blog/coup-de-canon-de-midi/')('.post-page').attr('lang'), 'fr');
  assert.equal(html('/de/blog/carnaval-de-nice/')('h1').text(), 'Le Carnaval de Nice depuis la place Masséna');

  // Liste de la page Blog en allemand : chaque carte dans sa langue de repli, liens vers les pages allemandes
  const list = html('/de/blog/');
  const cards = list('.post-card');
  assert.equal(cards.length, 4);
  const card = cards.filter((i, c) => list(c).find('a').attr('href') === '/de/blog/vieille-ville-a-pied/');
  assert.equal(card.attr('lang'), 'en');
  assert.equal(card.find('.post-card__title a').text(), 'The Old Town on foot, in two hours');

  // Sitemap : seulement les versions rédigées dans leur langue
  const sitemap = String(result.files.get('sitemap.xml'));
  assert.ok(sitemap.includes(`${site}/en/blog/vieille-ville-a-pied/`));
  assert.ok(sitemap.includes(`${site}/fr/blog/coup-de-canon-de-midi/`));
  assert.ok(!sitemap.includes('/de/blog/vieille-ville-a-pied/'));
  assert.ok(!sitemap.includes('/en/blog/coup-de-canon-de-midi/'));
  // Même nombre de textes vides que les autres pages (photos de la maquette non importées dans ce test)
  const faq = result.errors.find((e) => e.startsWith('/fr/faq/ :'));
  const blogErrors = result.errors.filter((e) => e.includes('/blog/'));
  assert.ok(blogErrors.every((e) => e.replace(/^\/fr\/blog\/(?:[\w-]+\/)? :/, '/fr/faq/ :') === faq), blogErrors.join('\n'));
});
