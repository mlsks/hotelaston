/**
 * Menus et listes de liens : reprise des gabarits (traductions comprises), rendu, API,
 * documents PDF de la médiathèque.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-links-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';
process.env.SITE_URL = 'https://www.hotel-aston.com';

const { getDb, closeDb, allowDocumentMedia } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');
const { config } = await import('../server/config.js');
const { ensureLinkLists, scanLinkLists } = await import('../server/ssg/link-lists.js');
const { sha, nowIso } = await import('../server/lib/util.js');

let app;
let db;
let session;
const PASSWORD = 'mot-de-passe-de-test-123';

function call(method, url, payload, headers = {}) {
  return app.inject({ method, url, payload, headers: { cookie: session.cookie, 'x-csrf-token': session.csrf, ...headers } });
}
const pagePath = (key) => db.prepare("SELECT pi.path FROM cms_page_i18n pi JOIN cms_pages p ON p.id = pi.page_id WHERE p.key = ? AND pi.lang = 'fr'").pluck().get(key);
const page = (key) => cheerio.load(fs.readFileSync(path.join(config.previewDir, pagePath(key).replace(/^\//, ''), 'index.html'), 'utf8'));
const links = (list) => db.prepare("SELECT * FROM cms_items WHERE collection = 'links' AND json_extract(data, '$.list') = ? ORDER BY position, id").all(list);
const preview = async () => assert.equal((await call('POST', '/api/builds/preview', {})).statusCode, 200);

before(async () => {
  db = getDb();
  importLegacy(db, { writeTemplates: false, log: () => {} });
  await seedSitePhotos(db);
  db.prepare(`INSERT INTO sys_users (email, name, password_hash, role, langs, is_active, created_at) VALUES (?, ?, ?, 'editor', NULL, 1, ?)`)
    .run('editor@test.fr', 'Éditrice', await hashPassword(PASSWORD), nowIso());
  app = await buildApp({ logger: false });
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'editor@test.fr', password: PASSWORD } });
  session = { cookie: res.headers['set-cookie'].split(';')[0], csrf: res.json().csrf };
});

after(async () => {
  await app?.close();
  closeDb();
  fs.rmSync(VAR, { recursive: true, force: true });
});

test('les listes des gabarits sont reprises dans la base, sans laisser de textes inutiles', () => {
  const lists = scanLinkLists();
  assert.deepEqual(lists.map((l) => l.key).sort(),
    ['cartes-horloge', 'cartes-moon-bar', 'liens-seminaires', 'menu-mobile', 'menu-principal', 'pied-hotel', 'pied-nice', 'pied-seminaires']);
  assert.equal(lists.find((l) => l.key === 'menu-mobile').nested, true);
  assert.equal(lists.find((l) => l.key === 'menu-principal').nested, false);

  const main = links('menu-principal');
  assert.equal(main.length, 6); // Chambres … Accès, Blog
  assert.deepEqual(JSON.parse(main[0].data), { list: 'menu-principal', parent: null, kind: 'page', page: 'chambres' });
  assert.equal(db.prepare("SELECT 1 FROM cms_entries WHERE key = 'global.006-a'").get(), undefined);
  assert.equal(db.prepare("SELECT 1 FROM cms_entries WHERE key = 'restaurant-horloge.021-a'").get(), undefined);
  // Sous-menu du menu mobile : les trois lieux sous « Restaurant & bar »
  const mobile = links('menu-mobile').map((it) => JSON.parse(it.data));
  assert.equal(mobile.filter((d) => d.parent === 'menu-mobile-3').length, 3);
  // Sans effet au deuxième passage
  assert.equal(ensureLinkLists(db), 0);
});

test('la reprise garde les traductions et leur état', () => {
  const now = nowIso();
  const id = db.prepare(`INSERT INTO cms_entries (key, page_id, section, type, label, translatable, required, position, created_at, updated_at)
    VALUES ('test.lien', NULL, NULL, 'text', 'Lien', 1, 1, 0, ?, ?)`).run(now, now).lastInsertRowid;
  const add = db.prepare('INSERT INTO cms_entry_values (entry_id, lang, value, status, source_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  add.run(id, 'fr', 'Chambres', 'ready', sha('Chambres'), now);
  add.run(id, 'en', 'Rooms', 'ready', sha('Chambres'), now);
  add.run(id, 'it', 'Camere', 'ready', sha('Ancien texte'), now);
  const list = { key: 'test-liste', label: 'Test', page: null, nested: false, items: [{ text: 'x', entry: 'test.lien', kind: 'page', page: 'chambres', children: [] }] };
  assert.equal(ensureLinkLists(db, [list]), 1);
  const item = links('test-liste')[0];
  const rows = Object.fromEntries(db.prepare('SELECT * FROM cms_item_i18n WHERE item_id = ?').all(item.id).map((r) => [r.lang, r]));
  assert.deepEqual(JSON.parse(rows.en.data), { label: 'Rooms' });
  assert.equal(rows.en.source_hash, sha(rows.fr.data)); // à jour
  assert.notEqual(rows.it.source_hash, sha(rows.fr.data)); // restait « à revoir »
  assert.equal(db.prepare("SELECT 1 FROM cms_entries WHERE key = 'test.lien'").get(), undefined);
  db.prepare("DELETE FROM cms_items WHERE collection = 'links' AND json_extract(data, '$.list') = 'test-liste'").run();
});

test('le site est construit depuis la base : menus, sous-menu, cartes de L’Horloge', async () => {
  await preview();
  const $ = page('accueil');
  const nav = $('.main-nav a').map((i, a) => [[$(a).text(), a.attribs.href, a.attribs['data-nav']]]).get();
  assert.deepEqual(nav[0], ['Chambres', `/preview${pagePath('chambres')}`, 'chambres']);
  assert.equal(nav.length, 6);
  assert.deepEqual(nav[5], ['Blog', `/preview${pagePath('blog')}`, 'blog']);
  assert.equal($('.mobile-menu__list > li > ul > li').length, 3);
  assert.equal($('[data-cms-links], [data-cms-key]').length, 0);

  const horloge = page('restaurant-horloge')('.link-list a').map((i, a) => [[cheerio.load(a).text(), a.attribs.href]]).get();
  assert.deepEqual(horloge, [
    ['Découvrir le menu', '/preview/fr/menu-restaurant-horloge/'],
    ['Carte des vins', '/preview/fr/carte-vin-restaurant-horloge/'],
    ['Carte des desserts', '/preview/fr/carte-dessert/'],
  ]);
});

test('API : ajout, ordre, document PDF, suppression avec les sous-liens', async () => {
  const lists = (await call('GET', '/api/link-lists')).json();
  assert.equal(lists.find((l) => l.key === 'cartes-horloge').page, 'restaurant-horloge');

  // Contrôles
  const bad = (data) => call('POST', '/api/collections/links/items', { key: `essai-${Math.random().toString(36).slice(2, 8)}`, data });
  assert.equal((await bad({ list: 'inconnue', kind: 'url', url: 'https://a.fr', label: 'x' })).statusCode, 400);
  assert.equal((await bad({ list: 'menu-principal', kind: 'url', url: 'javascript:alert(1)', label: 'x' })).statusCode, 400);
  assert.equal((await bad({ list: 'menu-principal', kind: 'page', page: 'nulle-part', label: 'x' })).statusCode, 400);
  assert.equal((await bad({ list: 'menu-principal', kind: 'page', page: 'faq', label: ' ' })).statusCode, 400);
  assert.equal((await bad({ list: 'menu-principal', parent: 'menu-principal-1', kind: 'page', page: 'faq', label: 'FAQ' })).statusCode, 400);

  // Un PDF dans la médiathèque, servi sous un nom lisible
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
  const boundary = '----aston-links';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Carte des vins (2026).pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    pdf, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const up = await call('POST', '/api/media?wait=1', body, { 'content-type': `multipart/form-data; boundary=${boundary}` });
  assert.equal(up.statusCode, 201, up.body);
  const media = up.json().media;
  assert.equal(media.kind, 'document');
  assert.equal(media.status, 'ready');
  const file = media.variants.find((v) => v.purpose === 'original');
  assert.match(file.path, /^v\/[0-9a-f]{16}-carte-des-vins-2026\.pdf$/);
  assert.ok(fs.existsSync(path.join(config.mediaDir, file.path)));
  assert.equal(media.i18n.en.state, 'ready'); // pas de texte alternatif à traduire

  const created = await call('POST', '/api/collections/links/items', { key: 'cartes-horloge-vins-pdf', data: { list: 'cartes-horloge', parent: null, kind: 'media', media: media.id, label: 'Carte des vins (PDF)' } });
  assert.equal(created.statusCode, 201, created.body);
  // Utilisé par un lien : la suppression du PDF prévient
  assert.equal((await call('DELETE', `/api/media/${media.id}`)).statusCode, 409);

  // Le nouveau lien passe en tête
  const ids = links('cartes-horloge').map((it) => it.id);
  const order = [created.json().id, ...ids.filter((id) => id !== created.json().id)];
  assert.equal((await call('PUT', '/api/link-lists/cartes-horloge/order', order)).statusCode, 200);
  assert.equal((await call('PUT', '/api/link-lists/cartes-horloge/order', order.slice(1))).statusCode, 400);
  // Un lien masqué disparaît du site
  await call('PATCH', `/api/items/${ids[2]}`, { is_active: false });
  await preview();
  const a = page('restaurant-horloge')('.link-list a');
  assert.equal(a.length, 3);
  assert.equal(a.first().text(), 'Carte des vins (PDF)');
  assert.equal(a.first().attr('href'), `/media/${file.path}`);
  assert.equal(a.first().attr('target'), '_blank');

  // Supprimer « Restaurant & bar » du menu mobile emporte ses trois sous-liens
  const parent = links('menu-mobile').find((it) => it.key === 'menu-mobile-3');
  assert.equal((await call('DELETE', `/api/items/${parent.id}`)).statusCode, 200);
  assert.equal(links('menu-mobile').filter((it) => JSON.parse(it.data).parent === 'menu-mobile-3').length, 0);
});

test('type « document » : contrainte de la médiathèque mise à jour une seule fois', () => {
  assert.equal(allowDocumentMedia(db), false);
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'cms_media'").pluck().get(), /'embed', 'document'\)/);
});
