/**
 * Tests de l'API du back-office, sur une base et des dossiers temporaires
 * (import du site actuel, gabarits de templates-src/ en lecture seule).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as cheerio from 'cheerio';
import sharp from 'sharp';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-test-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';
process.env.SITE_URL = 'https://www.hotel-aston.com';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');
const { Source } = await import('../server/ssg/source.js');
const { injectMedia } = await import('../server/ssg/media-render.js');
const { config } = await import('../server/config.js');
const { UI_STRINGS } = await import('../server/ssg/ui-strings.js');

let app;
let db;
const sessions = {};
const PASSWORD = 'mot-de-passe-de-test-123';

async function login(email) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
  assert.equal(res.statusCode, 200, res.body);
  const cookie = res.headers['set-cookie'].split(';')[0];
  return { cookie, csrf: res.json().csrf };
}

/** Requête authentifiée : who = 'admin' | 'editor' | 'translator' | null */
function call(who, method, url, payload, extra = {}) {
  const s = who ? sessions[who] : null;
  return app.inject({
    method, url, payload,
    headers: { ...(s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {}), ...extra.headers },
  });
}

const read = (rel) => fs.readFileSync(path.join(config.previewDir, rel), 'utf8');
const entryId = (key) => db.prepare('SELECT id FROM cms_entries WHERE key = ?').pluck().get(key);
const pageId = (key) => db.prepare('SELECT id FROM cms_pages WHERE key = ?').pluck().get(key);

function multipart(filename, buffer, folder = '/tests') {
  const boundary = '----aston-test-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\n${folder}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function upload(who, filename, buffer) {
  const { payload, headers } = multipart(filename, buffer);
  return call(who, 'POST', '/api/media?wait=1', payload, { headers });
}

before(async () => {
  db = getDb();
  importLegacy(db, { writeTemplates: false, log: () => {} });
  await seedSitePhotos(db);
  const add = db.prepare(`INSERT INTO sys_users (email, name, password_hash, role, langs, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`);
  const hash = await hashPassword(PASSWORD);
  add.run('admin@test.fr', 'Admin', hash, 'admin', null, new Date().toISOString());
  add.run('editor@test.fr', 'Éditrice', hash, 'editor', null, new Date().toISOString());
  add.run('translator@test.fr', 'Traducteur', hash, 'translator', '["en"]', new Date().toISOString());
  app = await buildApp({ logger: false });
  for (const who of ['admin', 'editor', 'translator']) sessions[who] = await login(`${who}@test.fr`);
});

after(async () => {
  await app?.close();
  closeDb();
  fs.rmSync(VAR, { recursive: true, force: true });
});

test('connexion : mauvais mot de passe refusé, session et jeton CSRF exigés', async () => {
  const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@test.fr', password: 'faux' } });
  assert.equal(bad.statusCode, 401);
  assert.equal((await call(null, 'GET', '/api/pages')).statusCode, 401);
  const me = await call('editor', 'GET', '/api/auth/me');
  assert.equal(me.json().user.role, 'editor');
  const noCsrf = await app.inject({ method: 'PUT', url: `/api/entries/${entryId('accueil.003-h1')}/fr`, payload: { value: 'x' }, headers: { cookie: sessions.editor.cookie } });
  assert.equal(noCsrf.statusCode, 403);
});

test('prévisualisation réservée aux personnes connectées', async () => {
  await call('editor', 'POST', '/api/builds/preview', {});
  const anon = await app.inject({ method: 'GET', url: '/preview/fr/', headers: { accept: 'text/html' } });
  assert.equal(anon.statusCode, 302);
  assert.match(anon.headers.location, /^\/admin\//);
  const ok = await call('translator', 'GET', '/preview/fr/');
  assert.equal(ok.statusCode, 200);
});

test('rôles : le traducteur ne touche qu’à ses langues et ne publie pas', async () => {
  const id = entryId('accueil.003-h1');
  assert.equal((await call('translator', 'PUT', `/api/entries/${id}/en`, { value: 'Hotel Aston La Scala, 4-star hotel in the heart of Nice' })).statusCode, 200);
  assert.equal((await call('translator', 'PUT', `/api/entries/${id}/fr`, { value: 'Modifié' })).statusCode, 403);
  assert.equal((await call('translator', 'PUT', `/api/entries/${id}/it`, { value: 'Hotel' })).statusCode, 403);
  assert.equal((await call('translator', 'POST', '/api/builds/publish', {})).statusCode, 403);
  assert.equal((await call('translator', 'GET', '/api/users')).statusCode, 403);
  assert.equal((await call('editor', 'GET', '/api/users')).statusCode, 403);
});

test('textes : HTML nettoyé, traduction « à revoir » quand le français change', async () => {
  const id = entryId('aston-club.006-p');
  const original = db.prepare("SELECT value FROM cms_entry_values WHERE entry_id = ? AND lang = 'fr'").pluck().get(id);
  const rich = db.prepare("SELECT e.id FROM cms_entries e WHERE e.type = 'richtext' AND e.key LIKE 'accueil.%' LIMIT 1").pluck().get();
  const cleaned = await call('editor', 'PUT', `/api/entries/${rich}/fr`, { value: 'Texte <strong>gras</strong><script>alert(1)</script><a href="javascript:alert(1)">lien</a>' });
  assert.equal(cleaned.statusCode, 200);
  assert.doesNotMatch(cleaned.json().values.fr.value, /script|javascript/);

  await call('translator', 'PUT', `/api/entries/${id}/en`, { value: 'When the Moon Bar is closed · 5pm to midnight' });
  let states = (await call('editor', 'GET', `/api/entries?page=${pageId('aston-club')}`)).json();
  assert.equal(states.find((e) => e.id === id).values.en.state, 'ready');
  await call('editor', 'PUT', `/api/entries/${id}/fr`, { value: `${original} (modifié)` });
  states = (await call('editor', 'GET', `/api/entries?page=${pageId('aston-club')}`)).json();
  assert.equal(states.find((e) => e.id === id).values.en.state, 'outdated');
  await call('editor', 'PUT', `/api/entries/${id}/fr`, { value: original });

  const status = (await call('translator', 'GET', '/api/translations/status')).json();
  const en = status.langs.find((l) => l.code === 'en');
  assert.ok(en.total > 1000 && en.ready >= 1 && en.missing > 0);
  const todo = (await call('translator', 'GET', '/api/translations/todo?lang=en&module=pages')).json();
  assert.ok(todo.length > 0 && todo.every((u) => u.module === 'pages'));
});

test('pages : adresse traduite, adresse invalide ou déjà prise refusée', async () => {
  const id = pageId('chambres');
  const ok = await call('translator', 'PUT', `/api/pages/${id}/i18n/en`, { slug: 'rooms', title: 'Rooms and suites in Nice | Hotel Aston La Scala', meta_description: 'Six room categories in central Nice.' });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().path, '/en/rooms/');
  assert.equal((await call('translator', 'PUT', `/api/pages/${id}/i18n/en`, { slug: 'Chambres !', title: 'x' })).statusCode, 400);
  assert.equal((await call('translator', 'PUT', `/api/pages/${pageId('services')}/i18n/en`, { slug: 'rooms', title: 'Services' })).statusCode, 400);
});

test('médias : variantes WebP, recadrage portrait, doublon, type refusé', async () => {
  const png = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: '#2a4a72' } }).png().toBuffer();
  const res = await upload('editor', 'piscine.png', png);
  assert.equal(res.statusCode, 201, res.body);
  const media = res.json().media;
  assert.equal(media.status, 'ready');
  const purposes = media.variants.map((v) => v.purpose).sort();
  assert.deepEqual(purposes, ['portrait', 'share', 'thumb', 'w1024', 'w1600', 'w2000', 'w640']); // 2000 px : largeur d'origine gardée
  for (const v of media.variants) assert.ok(fs.existsSync(path.join(config.mediaDir, v.path)), v.path);
  assert.equal(media.variants.find((v) => v.purpose === 'portrait').height, 1200);
  assert.deepEqual(['width', 'height', 'format'].map((k) => media.variants.find((v) => v.purpose === 'share')[k]), [1200, 630, 'jpeg']);

  const again = await upload('editor', 'copie.png', png);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().duplicate, true);
  assert.equal((await upload('editor', 'page.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).statusCode, 415);
  assert.equal((await upload('translator', 'x.png', png)).statusCode, 403);

  const alt = await call('editor', 'PUT', `/api/media/${media.id}/i18n/fr`, { alt: 'Piscine du rooftop au coucher du soleil' });
  assert.equal(alt.json().i18n.fr.state, 'ready');
  const focal = await call('editor', 'PATCH', `/api/media/${media.id}?wait=1`, { focal_x: 0.2, focal_y: 0.5 });
  assert.match(focal.json().variants.find((v) => v.purpose === 'portrait').path, /portrait-20-50/);
});

test('médias : vidéo mesurée, poster extrait', { skip: (() => { try { execFileSync(config.ffmpeg, ['-version']); return false; } catch { return 'ffmpeg absent'; } })() }, async () => {
  const file = path.join(VAR, 'clip.mp4');
  execFileSync(config.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-pix_fmt', 'yuv420p', '-y', file]);
  const res = await upload('editor', 'clip.mp4', fs.readFileSync(file));
  const media = res.json().media;
  assert.equal(media.kind, 'video');
  assert.equal(media.status, 'ready');
  assert.ok(Math.abs(media.duration_s - 2) < 0.2);
  assert.ok(media.variants.some((v) => v.purpose === 'poster'));
  assert.ok(media.variants.some((v) => v.purpose === 'original'));
});

test('image de la médiathèque injectée dans un gabarit (data-cms-media)', async () => {
  const media = db.prepare("SELECT id FROM cms_media WHERE original_name = 'piscine.png'").pluck().get();
  db.prepare(`INSERT INTO cms_entries (key, section, type, label, translatable, required, position, created_at, updated_at) VALUES ('test.hero', 'Test', 'media', 'Image', 1, 1, 0, '', '')`).run();
  const res = await call('editor', 'PUT', `/api/entries/${entryId('test.hero')}/fr`, { media_id: media });
  assert.equal(res.statusCode, 200, res.body);
  const $ = cheerio.load('<picture><source media="(max-aspect-ratio: 4/5)" srcset="ancien.webp"><img class="hero__image" data-cms-media="test.hero" fetchpriority="high" alt=""></picture>', null, false);
  injectMedia($, new Source(db, { mode: 'production' }), 'fr', () => assert.fail('média manquant'));
  const img = $('img');
  assert.equal(img.attr('class'), 'hero__image');
  assert.equal(img.attr('fetchpriority'), 'high');
  assert.equal(img.attr('alt'), 'Piscine du rooftop au coucher du soleil');
  assert.match(img.attr('srcset'), /\/media\/v\/.+-w640\.webp 640w/);
  assert.match($('source').attr('srcset'), /portrait/);
  assert.equal($('[data-cms-media]').length, 0);
});

test('bandeaux : programmés, placés, traduits, avec double sécurité des dates', async () => {
  const hour = 3600e3;
  const iso = (ms) => new Date(Date.now() + ms).toISOString();
  const mk = async (name, start, end) => {
    const b = (await call('editor', 'POST', '/api/banners', { name, variant: 'promo', cta_kind: 'page', cta_target: 'offres', start_at: start, end_at: end })).json();
    await call('editor', 'PUT', `/api/banners/${b.id}/i18n/fr`, { text: `${name} <strong>-20 %</strong><img src=x onerror=alert(1)>`, cta_label: 'Voir les offres' });
    await call('editor', 'PUT', `/api/banners/${b.id}/placements`, [{ zone: 'hero-sub', page_key: 'accueil' }]);
    return b.id;
  };
  const current = await mk('Offre en cours', iso(-hour), iso(2 * hour));
  const soon = await mk('Offre à venir', iso(3 * hour), iso(30 * hour));
  const expired = await mk('Offre passée', iso(-5 * hour), iso(-hour));
  const zone = (await call('editor', 'GET', '/api/zones')).json();
  assert.ok(zone.some((z) => z.key === 'hero-sub'));
  db.prepare("UPDATE cms_zones SET max_banners = 3 WHERE key = 'hero-sub'").run();

  const build = (await call('editor', 'POST', '/api/builds/preview', {})).json();
  assert.equal(build.status, 'success', build.error);
  const $ = cheerio.load(read('fr/index.html'));
  const zoneEl = $('[data-zone="hero-sub"]');
  assert.equal(zoneEl.length, 1);
  const ids = zoneEl.find('[data-banner]').map((i, el) => Number(el.attribs['data-banner'])).get();
  assert.ok(ids.includes(current) && ids.includes(soon) && !ids.includes(expired));
  const now = $(`[data-banner="${current}"]`);
  assert.equal(now.attr('hidden'), undefined);
  assert.ok(now.attr('data-end'));
  assert.notEqual($(`[data-banner="${soon}"]`).attr('hidden'), undefined, 'à venir : caché jusqu’à sa date, révélé par le script');
  assert.equal(now.find('img').length, 0, 'HTML du bandeau nettoyé');
  assert.match(now.find('a').attr('href'), /^\/preview\/fr\/offres\/$/);
  assert.match(zoneEl.find('script').text(), /__cmsZone/);
  assert.equal(cheerio.load(read('fr/chambres/index.html'))('[data-zone="hero-sub"]').length, 0);
  // Anglais : pas de traduction → repli signalé en prévisualisation
  assert.equal(cheerio.load(read('en/index.html'))(`[data-banner="${current}"]`).attr('data-preview-missing'), '');
  // Bandeau Live Music importé : sur les pages restaurant uniquement
  assert.equal(cheerio.load(read('fr/moon-bar/index.html'))('[data-zone="top-bar"] .live-strip').length, 1);
  for (const id of [current, soon, expired]) await call('editor', 'DELETE', `/api/banners/${id}`);
});

test('popup : fenêtre, configuration et script sur les pages ciblées seulement', async () => {
  const media = db.prepare("SELECT id FROM cms_media WHERE original_name = 'piscine.png'").pluck().get();
  const p = (await call('editor', 'POST', '/api/popups', { name: 'Été', is_active: true, media_id: media, trigger_type: 'scroll', trigger_value: 40, frequency: 'days', frequency_days: 3 })).json();
  await call('editor', 'PUT', `/api/popups/${p.id}/i18n/fr`, { title: 'L’été sur le toit', body: '<p>Piscine et Moon Bar.</p>', cta_label: 'Réserver', cta_kind: 'booking', cta_target: 'offer:escapade-gourmande' });
  await call('editor', 'PUT', `/api/popups/${p.id}/pages`, [{ page_key: 'accueil' }]);
  await call('editor', 'POST', '/api/builds/preview', {});
  const $ = cheerio.load(read('fr/index.html'));
  assert.equal($('dialog.cms-popup').length, 1);
  const cfg = JSON.parse($('#cms-popup-config').text());
  assert.deepEqual([cfg.trigger, cfg.value, cfg.frequency, cfg.days], ['scroll', 40, 'days', 3]);
  assert.match($('script[src*="/assets/popup."]').attr('src'), /popup\.[0-9a-f]{10}\.js$/);
  assert.ok($('dialog.cms-popup img[srcset]').length, 'image de la médiathèque');
  assert.equal($('dialog.cms-popup a[data-book]').attr('data-offer-id'), 'escapade-gourmande');
  assert.equal(cheerio.load(read('fr/faq/index.html'))('dialog.cms-popup').length, 0);
  await call('editor', 'DELETE', `/api/popups/${p.id}`);
});

test('textes du JavaScript : passés au navigateur dans la langue de la page', async () => {
  await call('translator', 'PUT', `/api/entries/${entryId('ui.cta.room')}/en`, { value: 'Book a room' });
  await call('editor', 'POST', '/api/builds/preview', {});
  const cfg = (rel) => JSON.parse(cheerio.load(read(rel))('#site-config').text());
  assert.equal(cfg('en/index.html').i18n['ui.cta.room'], 'Book a room');
  assert.equal(cfg('fr/index.html').i18n['ui.cta.room'], 'Réserver une chambre');
  assert.equal(Object.keys(cfg('fr/index.html').i18n).length, Object.keys(UI_STRINGS).length);
});

test('publication, restauration et contrôles SEO par l’API', async () => {
  const first = (await call('editor', 'POST', '/api/builds/publish', {})).json();
  assert.equal(first.status, 'success', first.error);
  const id = entryId('aston-club.006-p');
  const original = db.prepare("SELECT value FROM cms_entry_values WHERE entry_id = ? AND lang = 'fr'").pluck().get(id);
  await call('editor', 'PUT', `/api/entries/${id}/fr`, { value: `${original} · nouvelle version` });
  const second = (await call('editor', 'POST', '/api/builds/publish', {})).json();
  assert.equal(second.status, 'success');
  const restored = (await call('editor', 'POST', '/api/builds/restore-previous', {})).json();
  assert.equal(restored.restored, first.id);
  assert.equal(restored.current.id, first.id);

  const seo = (await call('translator', 'GET', `/api/seo/pages/${pageId('aston-club')}/fr`)).json();
  assert.equal(seo.path, '/fr/aston-club/');
  assert.ok(seo.checks.some((c) => c.id === 'h1' && c.status === 'ok'));
  assert.ok(typeof seo.score === 'number');
});

test('utilisateurs : mot de passe généré, dernier administrateur protégé', async () => {
  const created = await call('admin', 'POST', '/api/users', { email: 'nouveau@test.fr', name: 'Nouveau', role: 'translator', langs: ['it'] });
  assert.equal(created.statusCode, 201, created.body);
  assert.ok(created.json().password.length >= 16);
  const adminId = db.prepare("SELECT id FROM sys_users WHERE email = 'admin@test.fr'").pluck().get();
  assert.equal((await call('admin', 'PATCH', `/api/users/${adminId}`, { role: 'editor' })).statusCode, 400);
  assert.equal((await call('admin', 'DELETE', `/api/users/${adminId}`)).statusCode, 400);
});
