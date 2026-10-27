/**
 * Éditeur limité au périmètre « live-music » : visibilité, droits, programme des concerts,
 * publication limitée (les brouillons des autres ne partent pas en ligne).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';
import sharp from 'sharp';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-scope-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');
const { config } = await import('../server/config.js');

let app;
let db;
const s = {};
const PASSWORD = 'mot-de-passe-de-test-123';

const call = (who, method, url, payload, headers = {}) => app.inject({
  method, url, payload, headers: { cookie: s[who].cookie, 'x-csrf-token': s[who].csrf, ...headers },
});
const entryId = (key) => db.prepare('SELECT id FROM cms_entries WHERE key = ?').pluck().get(key);
const pageId = (key) => db.prepare('SELECT id FROM cms_pages WHERE key = ?').pluck().get(key);
const online = (rel) => fs.readFileSync(path.join(config.publicDist, rel), 'utf8');
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

function multipart(filename, buffer, folder) {
  const b = '----aston-scope';
  return {
    payload: Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="folder"\r\n\r\n${folder}\r\n`),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      buffer, Buffer.from(`\r\n--${b}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}` },
  };
}

before(async () => {
  db = getDb();
  importLegacy(db, { writeTemplates: false, log: () => {} });
  await seedSitePhotos(db);
  const hash = await hashPassword(PASSWORD);
  const add = db.prepare(`INSERT INTO sys_users (email, name, password_hash, role, langs, scopes, is_active, created_at) VALUES (?, ?, ?, ?, NULL, ?, 1, ?)`);
  add.run('admin@test.fr', 'Admin', hash, 'admin', null, new Date().toISOString());
  add.run('editor@test.fr', 'Éditrice', hash, 'editor', null, new Date().toISOString());
  add.run('live@test.fr', 'Programmation', hash, 'editor', '["live-music"]', new Date().toISOString());
  app = await buildApp({ logger: false });
  for (const who of ['admin', 'editor', 'live']) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${who}@test.fr`, password: PASSWORD } });
    s[who] = { cookie: res.headers['set-cookie'].split(';')[0], csrf: res.json().csrf };
  }
});

after(async () => {
  await app?.close();
  closeDb();
  fs.rmSync(VAR, { recursive: true, force: true });
});

test('ne voit que la page, le programme, les bandeaux et les médias Live Music', async () => {
  const me = (await call('live', 'GET', '/api/auth/me')).json().user;
  assert.deepEqual(me.scopes, ['live-music']);
  assert.deepEqual((await call('live', 'GET', '/api/pages')).json().map((p) => p.key), ['live-music']);
  assert.deepEqual((await call('live', 'GET', '/api/collections')).json().map((c) => c.key), ['artists', 'gigs']);
  assert.deepEqual((await call('live', 'GET', '/api/banners')).json().map((b) => b.name), ['Soirées Live Music']);
  const entries = (await call('live', 'GET', '/api/entries')).json();
  assert.ok(entries.length > 5 && entries.every((e) => e.key.startsWith('live-music.')));
  for (const url of ['/api/popups', '/api/translations/status', '/api/settings', '/api/redirects', `/api/pages/${pageId('accueil')}`]) {
    assert.equal((await call('live', 'GET', url)).statusCode, 403, url);
  }
});

test('modifie les textes de sa page, pas ceux des autres ni la structure', async () => {
  assert.equal((await call('live', 'PUT', `/api/entries/${entryId('live-music.005-h1')}/fr`, { value: 'Soirées Live Music à Nice : le programme' })).statusCode, 200);
  assert.equal((await call('live', 'PUT', `/api/entries/${entryId('accueil.003-h1')}/fr`, { value: 'Piratage' })).statusCode, 403);
  assert.equal((await call('live', 'PUT', `/api/entries/${entryId('ui.cta.room')}/fr`, { value: 'x' })).statusCode, 403);
  assert.equal((await call('live', 'PUT', `/api/pages/${pageId('live-music')}/i18n/fr`, { title: 'Live Music à Nice, vendredi et samedi | Aston La Scala', meta_description: 'Le programme des concerts.' })).statusCode, 200);
  assert.equal((await call('live', 'PATCH', `/api/pages/${pageId('live-music')}`, { in_sitemap: false })).statusCode, 403);
  assert.equal((await call('live', 'POST', '/api/redirects', { from_path: '/x', to_page: pageId('live-music') })).statusCode, 403);
  assert.equal((await call('live', 'POST', '/api/collections/rooms/items', { key: 'pirate', data: { name: 'x' } })).statusCode, 403);
});

test('programme : concerts validés, écrits dans la page avec leurs données d’événement', async () => {
  const artist = (key, data) => call('live', 'POST', '/api/collections/artists/items', { key, data: { style: '', bio: '', website: '', media: null, ...data } });
  assert.equal((await artist('sans-nom', { name: ' ' })).statusCode, 400, 'nom obligatoire');
  assert.equal((await artist('mauvais-site', { name: 'X', website: 'pas un site' })).statusCode, 400, 'site en https://');
  assert.equal((await artist('groupe-passe', { name: 'Groupe passé', style: 'Blues' })).statusCode, 201);
  assert.equal((await artist('trio-paillon', { name: 'Trio Paillon', style: 'Blues', bio: 'Trio niçois' })).statusCode, 201);
  const duo = await artist('duo-massena', { name: 'Duo Masséna', style: 'Soul', bio: 'Duo voix et guitare', website: 'https://duo-massena.example' });
  assert.equal(duo.statusCode, 201, duo.body);

  const bad = await call('live', 'POST', '/api/collections/gigs/items', { key: 'mauvais', data: { date: '06/11/2026', artist: 'duo-massena' } });
  assert.equal(bad.statusCode, 400);
  const add = (key, date, artist, extra = {}) => call('live', 'POST', '/api/collections/gigs/items', { key, data: { date, time: '21:00', venue: 'selon-meteo', artist, ...extra } });
  assert.equal((await add('inconnu', inDays(4), 'personne')).statusCode, 400, 'artiste sans fiche refusé');
  assert.equal((await add('passe', inDays(-3), 'groupe-passe')).statusCode, 201);
  assert.equal((await add('trio', inDays(5), 'trio-paillon', { description: 'Standards blues et soul' })).statusCode, 201);
  assert.equal((await add('duo', inDays(2), 'duo-massena', { venue: 'moon-bar' })).statusCode, 201);

  const used = await call('live', 'DELETE', `/api/items/${duo.json().id}`);
  assert.equal(used.statusCode, 400, 'artiste programmé : suppression refusée');

  const build = (await call('live', 'POST', '/api/builds/preview')).json();
  assert.equal(build.status, 'success', build.error);
  const $ = cheerio.load(fs.readFileSync(path.join(config.previewDir, 'fr/live-music/index.html'), 'utf8'));
  const gigs = $('[data-gig-list] li').map((i, el) => $(el).find('strong').text()).get();
  assert.deepEqual(gigs, ['Duo Masséna', 'Trio Paillon'], 'à venir seulement, par date');
  const first = $('[data-gig-list] li').first();
  assert.match(first.text(), /21h00 · Soul · Moon Bar, sur le toit/);
  assert.match(first.text(), /Duo voix et guitare/, 'présentation de la fiche artiste');
  assert.equal(first.find('a.gig-list__site').attr('href'), 'https://duo-massena.example');
  assert.match($('[data-gig-list] li').eq(1).text(), /Standards blues et soul/, 'précisions du concert prioritaires');
  const events = JSON.parse($('script[type="application/ld+json"]').text())['@graph'].filter((n) => n['@type'] === 'MusicEvent');
  assert.equal(events.length, 2);
  assert.deepEqual(events[0].performer, { '@type': 'MusicGroup', name: 'Duo Masséna', genre: 'Soul', description: 'Duo voix et guitare', url: 'https://duo-massena.example', sameAs: ['https://duo-massena.example'] });
  assert.match(events[0].startDate, /T\d{2}:00:00\.000Z$/);
});

test('médias : rangés dans /live-music, ceux des autres hors d’atteinte', async () => {
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#203040' } }).png().toBuffer();
  const mine = multipart('artiste.png', png, '/hotel');
  const res = await call('live', 'POST', '/api/media?wait=1', mine.payload, mine.headers);
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().media.folder, '/live-music');
  const other = multipart('piscine.png', await sharp({ create: { width: 800, height: 600, channels: 3, background: '#2a4a72' } }).png().toBuffer(), '/hotel');
  const theirs = (await call('editor', 'POST', '/api/media?wait=1', other.payload, other.headers)).json().media;
  assert.equal((await call('live', 'PUT', `/api/media/${theirs.id}/i18n/fr`, { alt: 'x' })).statusCode, 403);
  assert.equal((await call('live', 'DELETE', `/api/media/${theirs.id}`)).statusCode, 403);
  assert.deepEqual((await call('live', 'GET', '/api/media')).json().items.map((m) => m.folder), ['/live-music']);
});

test('photo de l’artiste : vignette dans le programme, image du performer', async () => {
  const photo = (await call('live', 'GET', '/api/media')).json().items[0];
  const duo = (await call('live', 'GET', '/api/collections/artists/items')).json().find((a) => a.key === 'duo-massena');
  assert.equal((await call('live', 'PATCH', `/api/items/${duo.id}`, { data: { media: 999999 } })).statusCode, 400, 'photo inconnue refusée');
  const res = await call('live', 'PATCH', `/api/items/${duo.id}`, { data: { media: photo.id } });
  assert.equal(res.statusCode, 200, res.body);
  assert.match((await call('admin', 'DELETE', `/api/media/${photo.id}`)).body, /artists\/duo-massena/, 'photo signalée comme utilisée');
  const build = (await call('live', 'POST', '/api/builds/preview')).json();
  assert.equal(build.status, 'success', build.error);
  const $ = cheerio.load(fs.readFileSync(path.join(config.previewDir, 'fr/live-music/index.html'), 'utf8'));
  const li = $('[data-gig-list] li').first();
  assert.ok(li.hasClass('has-photo'));
  assert.match(li.find('img.gig-list__photo').attr('src'), /^\/media\/.+\.webp$/);
  const event = JSON.parse($('script[type="application/ld+json"]').text())['@graph'].find((n) => n['@type'] === 'MusicEvent');
  assert.match(event.performer.image, /^https?:\/\/.+\/media\/.+\.webp$/);
  assert.equal(event.image[0], event.performer.image);
});

test('bandeau Live Music : texte modifiable, emplacements limités à sa page', async () => {
  const banner = (await call('live', 'GET', '/api/banners')).json()[0];
  const before = banner.placements.length;
  assert.equal((await call('live', 'PUT', `/api/banners/${banner.id}/i18n/fr`, { text: 'Ce soir : <strong>Duo Masséna</strong>', cta_label: 'Le programme' })).statusCode, 200);
  assert.equal((await call('live', 'PUT', `/api/banners/${banner.id}/placements`, [{ zone: 'hero-sub', page_key: 'accueil' }])).statusCode, 403);
  const placed = await call('live', 'PUT', `/api/banners/${banner.id}/placements`, [{ zone: 'footer-cta', page_key: 'live-music' }]);
  assert.equal(placed.statusCode, 200, placed.body);
  assert.equal(placed.json().placements.length, before + 1, 'les emplacements des pages restaurant sont conservés');
  assert.equal((await call('live', 'PATCH', `/api/banners/${banner.id}`, { cta_kind: 'page', cta_target: 'offres' })).statusCode, 403);
});

test('publication limitée : la partie Live Music part, les brouillons des autres restent', async () => {
  // Sans première publication complète, un compte limité ne peut pas publier
  const early = (await call('live', 'POST', '/api/builds/publish')).json();
  assert.equal(early.status, 'failed');
  assert.match(early.error, /première publication complète/);

  // État en ligne de référence, puis un brouillon de l'éditeur sur l'accueil
  const full = (await call('editor', 'POST', '/api/builds/publish')).json();
  assert.equal(full.status, 'success', full.error);
  await call('editor', 'PUT', `/api/entries/${entryId('accueil.003-h1')}/fr`, { value: 'Brouillon de l’éditeur, pas encore validé' });
  await call('live', 'PUT', `/api/entries/${entryId('live-music.008-h2')}/fr`, { value: 'Les prochains concerts' });

  const scoped = (await call('live', 'POST', '/api/builds/publish')).json();
  assert.equal(scoped.status, 'success', scoped.error);
  assert.match(scoped.warnings[0], /périmètre : live-music/);
  const $live = cheerio.load(online('fr/live-music/index.html'));
  assert.equal($live('h2').filter((i, el) => $live(el).text() === 'Les prochains concerts').length, 1);
  assert.equal($live('[data-gig-list] li').length, 2);
  assert.doesNotMatch(online('fr/index.html'), /Brouillon de l’éditeur/, 'le brouillon de l’accueil ne part pas');
  assert.match(online('fr/moon-bar/index.html'), /Ce soir : <strong>Duo Masséna<\/strong>/, 'bandeau Live Music mis à jour');

  assert.equal((await call('live', 'POST', '/api/builds/restore-previous')).statusCode, 403);
  // La publication suivante d'un éditeur complet emporte tout
  const next = (await call('editor', 'POST', '/api/builds/publish')).json();
  assert.equal(next.status, 'success');
  assert.match(online('fr/index.html'), /Brouillon de l’éditeur/);
});

test('création de compte : un périmètre seulement pour un éditeur', async () => {
  const ok = await call('admin', 'POST', '/api/users', { email: 'dj@test.fr', name: 'DJ', role: 'editor', scopes: ['live-music'] });
  assert.equal(ok.statusCode, 201, ok.body);
  assert.deepEqual(ok.json().user.scopes, ['live-music']);
  assert.equal((await call('admin', 'POST', '/api/users', { email: 'x@test.fr', name: 'X', role: 'translator', scopes: ['live-music'] })).statusCode, 400);
  assert.equal((await call('admin', 'POST', '/api/users', { email: 'y@test.fr', name: 'Y', role: 'editor', scopes: ['inconnu'] })).statusCode, 400);
});
