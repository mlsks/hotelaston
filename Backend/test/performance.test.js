/**
 * Performances sur mobile (14/11/2026) : AVIF et recadrages portrait en plusieurs tailles, rattrapage des
 * photos déjà dans la médiathèque, logos de l'en-tête non chargés sur téléphone, bandeau photo du Moon Bar
 * (plus de vidéo), CSS et JS minifiés, polices et images fixes à empreinte (cache d'un an).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-perf-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';
process.env.SITE_URL = 'https://www.hotel-aston.com';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');
const { config } = await import('../server/config.js');
const { nowIso } = await import('../server/lib/util.js');
const { completeVariants, missingVariants } = await import('../server/media/pipeline.js');
const { ensureBlockEntries } = await import('../server/ssg/page-blocks.js');

let app;
let db;
let session;
const PASSWORD = 'mot-de-passe-de-test-123';

const call = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie: session.cookie, 'x-csrf-token': session.csrf } });
const page = (rel) => cheerio.load(fs.readFileSync(path.join(config.previewDir, rel, 'index.html'), 'utf8'));
const preview = async () => {
  const res = await call('POST', '/api/builds/preview', {});
  assert.equal(res.statusCode, 200, res.body);
};

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

test('photos déjà dans la médiathèque : AVIF et recadrages portrait créés une fois, en rattrapage', async () => {
  const m = db.prepare("SELECT * FROM cms_media WHERE kind = 'image' AND status = 'ready' ORDER BY id LIMIT 1").get();
  assert.deepEqual(missingVariants(db, m), []); // une photo envoyée aujourd'hui a déjà tout
  // Une photo d'avant : WebP et un seul recadrage portrait
  db.prepare("DELETE FROM cms_media_variants WHERE media_id = ? AND (format = 'avif' OR purpose GLOB 'portrait-w*')").run(m.id);
  // Photo de 1200 × 800 : zone portrait de 450 px de large, donc un seul recadrage (ramené à 450 px)
  assert.deepEqual(missingVariants(db, m).sort(), ['portrait/avif', 'w1024/avif', 'w1200/avif', 'w640/avif']);
  const logs = [];
  const done = await completeVariants(db, { log: (msg) => logs.push(msg) });
  assert.deepEqual(done, { images: 1, variants: 4, skipped: 0 });
  assert.match(logs.at(-1), /Publiez/);
  assert.deepEqual(missingVariants(db, m), []);
  for (const p of db.prepare('SELECT path FROM cms_media_variants WHERE media_id = ?').pluck().all(m.id)) assert.ok(fs.existsSync(path.join(config.mediaDir, p)), p);
  assert.deepEqual(await completeVariants(db), { images: 0, variants: 0, skipped: 0 }); // rien aux démarrages suivants
});

test('pages : AVIF et portrait en plusieurs tailles, logos non chargés sur téléphone, Moon Bar en photo', async () => {
  await preview();
  const home = page('fr');
  // Bandeau de l'accueil (photo d'origine) : portrait AVIF puis WebP, AVIF pour les autres écrans, WebP dans <img>
  const hero = home('.hero__media picture');
  assert.deepEqual(hero.find('source').map((i, el) => `${el.attribs.media || ''}|${el.attribs.type}`).get(),
    ['(max-aspect-ratio: 4/5)|image/avif', '(max-aspect-ratio: 4/5)|image/webp', '|image/avif']);
  assert.match(hero.find('source').eq(0).attr('srcset'), /piscine-portrait-540\.[0-9a-f]{10}\.avif 540w, .+780w, .+900w/);
  assert.equal(hero.find('img').attr('fetchpriority'), 'high');
  // Logos de l'en-tête : masqués sous 1180 px, en loading="lazy" pour ne pas être téléchargés sur téléphone ; WebP
  const logos = home('.header-logo img');
  assert.equal(logos.length, 2);
  logos.each((i, el) => {
    assert.equal(el.attribs.loading, 'lazy');
    assert.match(el.attribs.src, /\/assets\/img\/logo-aston-(blanc|or)\.[0-9a-f]{10}\.webp$/);
  });
  // Moon Bar : plus de vidéo, une photo prioritaire avec zoom lent
  const moon = page('fr/moon-bar');
  assert.equal(moon('video').length, 0);
  assert.equal(moon('section.venue-video .venue-video__image').attr('fetchpriority'), 'high');
  assert.equal(moon('section.venue-video source[type="image/avif"]').length, 2);
  assert.match(fs.readFileSync(path.join(config.previewDir, moon('link[rel="stylesheet"]').attr('href').replace('/preview/', '')), 'utf8'), /\.venue-video__image[^{]*\{[^}]*animation:breathe/);
});

test('bandeau du Moon Bar : photo choisie dans l’admin, ancien texte « vidéo » retiré', async () => {
  assert.equal(db.prepare("SELECT 1 FROM cms_entries WHERE key = 'moon-bar.video-bandeau'").get(), undefined);
  const entry = db.prepare("SELECT id, label FROM cms_entries WHERE key = 'moon-bar.photo-bandeau'").get();
  assert.match(entry.label, /^Photo : bandeau en haut de la page Moon Bar/);
  // Une ancienne base avait le texte « vidéo » : il disparaît au démarrage suivant, une seule fois
  db.prepare(`INSERT INTO cms_entries (key, page_id, section, type, label, translatable, required, position, created_at, updated_at)
    SELECT 'moon-bar.video-bandeau', page_id, section, 'media', 'Vidéo', 0, 0, position, '', '' FROM cms_entries WHERE key = 'moon-bar.photo-bandeau'`).run();
  assert.equal(ensureBlockEntries(db), 1);
  assert.equal(ensureBlockEntries(db), 0);
  const media = db.prepare("SELECT id FROM cms_media WHERE kind = 'image' AND status = 'ready' ORDER BY id LIMIT 1").pluck().get();
  assert.equal((await call('PUT', `/api/entries/${entry.id}/fr`, { media_id: media })).statusCode, 200);
  await preview();
  const head = page('fr/moon-bar')('section.venue-video');
  assert.match(head.find('img.venue-video__image').attr('srcset'), /\/media\/v\/.+-w640\.webp 640w/);
  assert.equal(head.find('img.venue-video__image').attr('fetchpriority'), 'high');
  assert.equal(head.find('img.venue-video__image').attr('alt'), '');
  assert.equal(head.find('source[media]').length, 2); // portrait AVIF et WebP
  assert.equal(head.find('source:not([media])').attr('type'), 'image/avif');
});

test('CSS et JS minifiés, polices à empreinte citées par la feuille de style', () => {
  const home = page('fr');
  const cssFile = path.join(config.previewDir, home('link[rel="stylesheet"]').attr('href').replace('/preview/', ''));
  const css = fs.readFileSync(cssFile, 'utf8');
  assert.ok(!css.includes('/* '), 'commentaires retirés');
  assert.ok(css.split('\n').length < 20, 'feuille sur quelques lignes');
  const fonts = [...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map((m) => m[1]);
  assert.ok(fonts.length > 10);
  for (const f of fonts) {
    assert.match(f, /^fonts\/[a-z-]+\.[0-9a-f]{10}\.woff2$/);
    assert.ok(fs.existsSync(path.join(path.dirname(cssFile), f)), f);
  }
  const js = fs.readFileSync(path.join(config.previewDir, home('script[src*="remotion-vanilla"]').attr('src').replace('/preview/', '')), 'utf8');
  assert.ok(js.length < 60_000, `remotion-vanilla.js minifié (${js.length} octets)`);
  assert.match(js, /RemotionVanilla/);
});

test('serveur Node (démo Render) : fichiers à empreinte gardés un an, les autres revalidés', async () => {
  const res = await call('POST', '/api/builds/publish', {});
  assert.equal(res.statusCode, 200, res.body);
  const html = (await app.inject({ method: 'GET', url: '/fr/' })).body;
  const css = /href="(\/assets\/styles\.[0-9a-f]{10}\.css)"/.exec(html)[1];
  const font = /href="(\/assets\/fonts\/jost-var-latin\.[0-9a-f]{10}\.woff2)"/.exec(html)[1];
  for (const url of [css, font]) {
    const r = await app.inject({ method: 'GET', url });
    assert.equal(r.statusCode, 200, url);
    assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable', url);
  }
  assert.doesNotMatch((await app.inject({ method: 'GET', url: '/fr/' })).headers['cache-control'] || '', /immutable/);
  assert.doesNotMatch((await app.inject({ method: 'GET', url: '/favicon.ico' })).headers['cache-control'] || '', /immutable/);
});

test('verrou de publication laissé par une instance arrêtée : ignoré, même si son numéro est repris', async () => {
  const { withBuildLock } = await import('../server/ssg/lock.js');
  fs.mkdirSync(path.dirname(config.lockFile), { recursive: true });
  // Ancien verrou (sans heure de démarrage) dont le numéro désigne un fil d'exécution du serveur actuel
  const thread = fs.readdirSync('/proc/self/task').map(Number).find((t) => t !== process.pid);
  if (thread) {
    fs.writeFileSync(config.lockFile, JSON.stringify({ pid: thread, at: Date.now() }));
    assert.equal(await withBuildLock(async () => 'ok'), 'ok');
  }
  // Même numéro que le serveur actuel, posé avant son démarrage
  fs.writeFileSync(config.lockFile, JSON.stringify({ pid: process.pid, started: 1, at: Date.now() }));
  assert.equal(await withBuildLock(async () => 'ok'), 'ok');
  assert.equal(fs.existsSync(config.lockFile), false);
});
