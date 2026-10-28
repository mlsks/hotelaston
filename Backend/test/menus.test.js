/**
 * Cartes du restaurant et des bars : reprise des cartes du Moon Bar et des tapas,
 * page commune, création d'une carte, traduction partielle, masquage.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-menus-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';
process.env.SITE_URL = 'https://www.hotel-aston.com';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');
const { config } = await import('../server/config.js');
const { ensureMenus } = await import('../server/ssg/menus.js');
const { nowIso } = await import('../server/lib/util.js');

let app;
let db;
let session;
const PASSWORD = 'mot-de-passe-de-test-123';

function call(method, url, payload) {
  return app.inject({ method, url, payload, headers: { cookie: session.cookie, 'x-csrf-token': session.csrf } });
}
const page = (rel) => cheerio.load(fs.readFileSync(path.join(config.previewDir, rel, 'index.html'), 'utf8'));
const preview = async () => assert.equal((await call('POST', '/api/builds/preview', {})).statusCode, 200);

before(async () => {
  db = getDb();
  importLegacy(db, { writeTemplates: false, log: () => {} });
  await seedSitePhotos(db);
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

test('les cartes du Moon Bar et des tapas passent dans la base, rendu inchangé', async () => {
  assert.equal(db.prepare("SELECT template FROM cms_pages WHERE key = 'carte-moon-bar'").pluck().get(), 'pages/carte.html');
  assert.equal(db.prepare("SELECT COUNT(*) FROM cms_entries e JOIN cms_pages p ON p.id = e.page_id WHERE p.key IN ('carte-moon-bar', 'carte-tapas')").pluck().get(), 0);
  assert.equal(ensureMenus(db), 0);
  await preview();
  const $ = page('fr/carte-tapas');
  assert.equal($('h1').text(), 'Carte des tapas');
  assert.equal($('.view').attr('data-route'), 'carte-tapas');
  assert.equal($('.view').attr('data-table-target'), 'reserver-moonbar');
  assert.equal($('.menu-section').length, 2);
  const first = $('.menu-list li').first();
  assert.deepEqual([first.find('.menu-list__name').text(), first.find('.menu-list__price').text(), first.find('.menu-list__desc').text()], ['Pommes grenailles', '9 €', 'Sauce bravas']);
  assert.equal($('.back-link').text(), 'Retour au Moon Bar');
  assert.equal($('.menu-page__cta .link-arrow').text(), 'Carte du Moon Bar');
  assert.equal($('[data-f], [data-cms-menu]').length, 0);
});

test('nouvelle carte : page, lien dans « Les cartes », plats, traduction partielle, masquage', async () => {
  assert.equal((await call('POST', '/api/menus', { title: 'Carte des vins', venue: 'restaurant-horloge', slug: 'carte-moon-bar' })).statusCode, 400);
  const created = await call('POST', '/api/menus', { title: 'Carte des vins', venue: 'restaurant-horloge', slug: 'carte-des-vins-horloge' });
  assert.equal(created.statusCode, 201, created.body);
  const { id } = created.json();
  const data = {
    title: 'Carte des vins', venue: 'restaurant-horloge', backLabel: 'Retour au restaurant', subtitle: '', note: 'Prix nets',
    sections: [{ title: 'Vins rouges', dishes: [{ name: 'Bellet', price: '38 €', desc: '' }, { name: 'Bandol', price: '42 €', desc: 'Domaine' }] }],
  };
  assert.equal((await call('PATCH', `/api/items/${id}`, { data: { ...data, venue: 'nulle-part' } })).statusCode, 400);
  const saved = await call('PATCH', `/api/items/${id}`, { data });
  assert.equal(saved.statusCode, 200, saved.body);
  // Anglais : rubrique traduite, un plat seulement ; le reste reste en français
  const en = await call('PUT', `/api/items/${id}/i18n/en`, { data: { title: 'Wine list', sections: [{ title: 'Red wines', dishes: [{ name: '', desc: '' }, { name: 'Bandol', desc: 'Estate' }] }] }, status: 'ready' });
  assert.equal(en.statusCode, 200, en.body);

  await preview();
  const $ = page('fr/carte-des-vins-horloge');
  assert.equal($('h1').text(), 'Carte des vins');
  assert.equal($('.menu-list li').length, 2);
  assert.equal($('.menu-list li').eq(1).find('.menu-list__desc').text(), 'Domaine');
  assert.equal($('.menu-page__note').text(), 'Prix nets');
  assert.equal($('.gold-sub').length, 0);
  assert.match($('.menu-page__cta .btn').attr('href'), /restaurant-horloge\/\?a=reserver-horloge$/);
  const horloge = page('fr/restaurant-horloge');
  assert.ok(horloge('.link-list a').filter((i, a) => a.attribs.href === '/preview/fr/carte-des-vins-horloge/').length);
  const $en = page('en/carte-des-vins-horloge');
  assert.equal($en('h1').text(), 'Wine list');
  assert.deepEqual($en('.menu-list__name').map((i, el) => $en(el).text()).get(), ['Bellet', 'Bandol']);
  assert.equal($en('.menu-section h2').text(), 'Red wines');

  // Une carte ne se supprime pas, elle se masque (page et liens compris)
  assert.equal((await call('DELETE', `/api/items/${id}`)).statusCode, 400);
  assert.equal((await call('PATCH', '/api/menus/carte-des-vins-horloge', { is_active: false })).statusCode, 200);
  await preview();
  assert.equal(fs.existsSync(path.join(config.previewDir, 'fr/carte-des-vins-horloge/index.html')), false);
  assert.equal(page('fr/restaurant-horloge')('.link-list a[href$="carte-des-vins-horloge/"]').length, 0);
});

test('cartes de L’Horloge : créées aux adresses de l’ancien site, liens « Les cartes » redirigés', async () => {
  const keys = ['menu-restaurant-horloge', 'carte-vin-restaurant-horloge', 'carte-dessert'];
  for (const key of keys) assert.equal(db.prepare('SELECT template FROM cms_pages WHERE key = ?').pluck().get(key), 'pages/carte.html');
  assert.equal(db.prepare("SELECT COUNT(*) FROM cms_items WHERE collection = 'links' AND json_extract(data, '$.url') LIKE '%hotel-aston.com%'").pluck().get(), 0);
  assert.equal(ensureMenus(db), 0);
  await preview();
  const $ = page('fr/menu-restaurant-horloge');
  assert.equal($('h1').text(), "La carte de L'Horloge");
  assert.ok($('.menu-section').length >= 5);
  assert.equal($('.back-link').text(), "Retour au restaurant L'Horloge");
  assert.equal($('.menu-page__cta .link-arrow').length, 2);
  const horloge = page('fr/restaurant-horloge');
  const hrefs = horloge('.link-list a').map((i, a) => a.attribs.href).get();
  for (const key of keys) assert.ok(hrefs.includes(`/preview/fr/${key}/`), key);
  // Masquée, une carte n'est pas recréée au démarrage suivant
  assert.equal((await call('PATCH', '/api/menus/carte-dessert', { is_active: false })).statusCode, 200);
  assert.equal(ensureMenus(db), 0);
  assert.equal(db.prepare("SELECT is_active FROM cms_pages WHERE key = 'carte-dessert'").pluck().get(), 0);
  assert.equal((await call('PATCH', '/api/menus/carte-dessert', { is_active: true })).statusCode, 200);
});

test('anglais prêt : publié malgré les listes de liens ; sélecteur vers la page parente si la page n’est pas traduite', async () => {
  // Anglais « prêt » partout (copie du français), sauf la carte des desserts
  const now = nowIso();
  db.prepare(`INSERT INTO cms_entry_values (entry_id, lang, value, media_id, status, updated_at)
    SELECT entry_id, 'en', value, media_id, 'ready', ? FROM cms_entry_values WHERE lang = 'fr'
    ON CONFLICT (entry_id, lang) DO UPDATE SET value = excluded.value, media_id = excluded.media_id, status = 'ready'`).run(now);
  db.prepare(`INSERT INTO cms_page_i18n (page_id, lang, slug, path, title, meta_description, status, updated_at)
    SELECT page_id, 'en', slug, '/en' || substr(path, 4), title, meta_description, 'ready', ? FROM cms_page_i18n WHERE lang = 'fr'
    ON CONFLICT (page_id, lang) DO UPDATE SET status = 'ready'`).run(now);
  db.prepare(`DELETE FROM cms_page_i18n WHERE lang = 'en' AND page_id = (SELECT id FROM cms_pages WHERE key = 'carte-dessert')`).run();
  const res = (await call('POST', '/api/builds/publish', {})).json();
  assert.equal(res.status, 'success', res.error);
  assert.deepEqual(res.langs, ['fr', 'en']);
  const links = (rel) => cheerio.load(fs.readFileSync(path.join(config.publicDist, rel, 'index.html'), 'utf8'))('.site-header .lang-menu a[hreflang]')
    .map((i, a) => [[a.attribs.hreflang, a.attribs.href]]).get();
  assert.deepEqual(links('fr'), [['fr', '/fr/'], ['en', '/en/']]);
  assert.deepEqual(links('fr/carte-dessert'), [['fr', '/fr/carte-dessert/'], ['en', '/en/restaurant-horloge/']]);
  assert.deepEqual(links('fr/carte-vin-restaurant-horloge'), [['fr', '/fr/carte-vin-restaurant-horloge/'], ['en', '/en/carte-vin-restaurant-horloge/']]);
  assert.equal(fs.existsSync(path.join(config.publicDist, 'en/carte-dessert/index.html')), false);
});
