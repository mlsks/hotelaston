/**
 * Chambres de la page Chambres et du carrousel de l'accueil : reprise des cartes des gabarits
 * dans les fiches, rendu dans l'ordre des fiches, masquage, accueil, suppression (redirection).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-rooms-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';
process.env.SITE_URL = 'https://www.hotel-aston.com';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');
const { config } = await import('../server/config.js');
const { ensureRoomCards } = await import('../server/ssg/room-cards.js');
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
const room = (key) => db.prepare("SELECT * FROM cms_items WHERE collection = 'rooms' AND key = ?").get(key);
const roomFr = (key) => JSON.parse(db.prepare("SELECT data FROM cms_item_i18n WHERE item_id = ? AND lang = 'fr'").pluck().get(room(key).id));

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

test('cartes des gabarits reprises dans les fiches, rendu inchangé', async () => {
  const deluxe = roomFr('deluxe');
  assert.equal(deluxe.indexName, 'Deluxe Terrasse');
  assert.equal(deluxe.summary, '23 m² + terrasse · 6e étage');
  assert.equal(deluxe.cardTitle, 'Deluxe Terrasse');
  assert.deepEqual(JSON.parse(room('suites').data).cardFacts.map((f) => f.icon), ['i-area', 'i-users', 'i-sun']);
  assert.equal(JSON.parse(db.prepare("SELECT ii.data FROM cms_item_i18n ii JOIN cms_items i ON i.id = ii.item_id WHERE i.collection = 'amenities' AND i.key = 'clim' AND ii.lang = 'fr'").pluck().get()).shortLabel, 'Clim');
  const keys = (like) => db.prepare('SELECT key FROM cms_entries WHERE key LIKE ? ORDER BY key').pluck().all(like);
  assert.deepEqual(keys('chambres.0%'), ['chambres.001-nav@aria-label', 'chambres.002-a', 'chambres.003-span', 'chambres.004-h1', 'chambres.005-p']);
  assert.ok(keys('accueil.056-a').length && !keys('accueil.070-a').length && !keys('accueil.045-a').length);
  assert.equal(ensureRoomCards(db), 0);

  await preview();
  const $ = page('fr/chambres');
  const items = $('.room-index li');
  assert.equal(items.length, 6);
  assert.equal(items.first().find('a').attr('href'), '/preview/fr/chambres/confort/');
  assert.equal(items.first().find('span').first().html(), '<strong>Confort</strong> 17 à 23 m² · côté cour ou colline');
  assert.equal(items.first().find('picture, img').length > 0, true);
  const $h = page('fr');
  const cards = $h('.room-card');
  assert.equal(cards.length, 6);
  const first = cards.first();
  assert.equal(first.find('.room-card__title a').text(), 'Chambre Confort');
  assert.deepEqual(first.find('.room-card__facts > span').map((i, s) => $h(s).text()).get(), ['19 m²', '1 grand lit ou 2 lits', 'Côté cour ou colline']);
  assert.deepEqual(first.find('.amenities li').map((i, s) => $h(s).text()).get(), ['Clim', 'Wi-Fi', 'Minibar', 'Coffre', 'Douche ou bain', 'TV']);
  assert.equal(first.find('[data-book]').attr('data-room-type'), 'confort');
  assert.equal(first.find('.btn--ghost').text(), 'Découvrir');
  assert.equal(cards.eq(1).find('.amenities li').length, 6); // Privilège : PMR (7e pictogramme) seulement dans les infos
  assert.equal($h('[data-f], [data-cms-rooms]').length + $('[data-f], [data-cms-rooms]').length, 0);
});

test('ordre, masquage, accueil et suppression (redirection vers la page Chambres)', async () => {
  const ids = db.prepare("SELECT id FROM cms_items WHERE collection = 'rooms' ORDER BY position, id").pluck().all();
  // Suites en premier
  await Promise.all([ids.at(-1), ...ids.slice(0, -1)].map((id, pos) => call('PATCH', `/api/items/${id}`, { position: pos })));
  assert.equal((await call('PATCH', `/api/items/${room('premium').id}`, { is_active: false })).statusCode, 200);
  const exclusive = room('exclusive');
  const data = { ...JSON.parse(exclusive.data), ...roomFr('exclusive'), onHome: false };
  assert.equal((await call('PATCH', `/api/items/${exclusive.id}`, { data })).statusCode, 200);
  await preview();
  const index = page('fr/chambres')('.room-index strong').map((i, s) => cheerio.load(s).text()).get();
  assert.deepEqual(index, ['Suites familiales', 'Confort', 'Privilège', 'Exclusive', 'Deluxe Terrasse']);
  const $h = page('fr');
  assert.deepEqual($h('.room-card__title a').map((i, a) => $h(a).text()).get(), ['Suites familiales', 'Chambre Confort', 'Chambre Privilège', 'Deluxe Terrasse']);

  // Chambre ajoutée dans le back-office avec le strict minimum : page, carte, nom dans la fenêtre de réservation
  assert.equal((await call('POST', '/api/collections/rooms/items', { key: 'junior', data: { name: 'Chambre Junior', indexName: 'Junior', summary: '20 m²' } })).statusCode, 201);
  await preview();
  assert.deepEqual(page('fr/chambres')('.room-index strong').map((i, s) => cheerio.load(s).text()).get().at(-1), 'Junior');
  assert.equal(page('fr/chambres/junior')('title').text(), 'Chambre Junior');
  assert.equal(page('fr')('.room-card [data-room-type="junior"]').length, 1);
  assert.match(page('fr')('script').text(), /"roomNames":\{[^}]*"junior":"Chambre Junior"/);
  // Pictogramme supprimé alors que des fiches le citent : simplement omis
  const clim = db.prepare("SELECT id FROM cms_items WHERE collection = 'amenities' AND key = 'clim'").pluck().get();
  assert.equal((await call('DELETE', `/api/items/${clim}`)).statusCode, 200);
  await preview();
  assert.equal(page('fr/chambres/confort')('.amenities li').filter((i, li) => /Climatisation/.test(cheerio.load(li).text())).length, 0);

  assert.equal((await call('DELETE', `/api/items/${room('deluxe').id}`)).statusCode, 200);
  const redirect = db.prepare("SELECT r.*, p.key AS page FROM cms_redirects r JOIN cms_pages p ON p.id = r.to_page WHERE from_path = '/fr/chambres/deluxe/'").get();
  assert.equal(redirect.page, 'chambres');
  const res = (await call('POST', '/api/builds/publish', {})).json();
  assert.equal(res.status, 'success', res.error);
  const caddy = fs.readFileSync(path.join(config.publicDist, '_meta', 'redirects.caddy'), 'utf8');
  assert.match(caddy, /redir \/fr\/chambres\/deluxe\/ \/fr\/chambres\/ 301/);
  assert.doesNotMatch(caddy, /redir \/fr\/chambres\/confort\//);
  // Les textes qui citaient la chambre supprimée (ou masquée) mènent à la page Chambres
  const vieilleVille = cheerio.load(fs.readFileSync(path.join(config.publicDist, 'fr/hotel-vieille-ville-nice/index.html'), 'utf8'));
  const cited = vieilleVille('a').filter((i, a) => /Deluxe|Premium/.test(vieilleVille(a).text())).map((i, a) => a.attribs.href).get();
  assert.ok(cited.length >= 2);
  assert.ok(cited.every((h) => h === '/fr/chambres/'), cited.join(' '));
});
