/**
 * Dégradé des bandeaux photo (module hero-veil) : réglage du gabarit par défaut, réglage de la page
 * dans l'onglet Réglages (oui / non, opacité, étendue), pages sans bandeau réglable.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-veil-'));
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

let app;
let db;
let session;
const PASSWORD = 'mot-de-passe-de-test-123';

function call(method, url, payload) {
  return app.inject({ method, url, payload, headers: { cookie: session.cookie, 'x-csrf-token': session.csrf } });
}
const page = (rel) => cheerio.load(fs.readFileSync(path.join(config.previewDir, rel, 'index.html'), 'utf8'));
const preview = async () => {
  const res = await call('POST', '/api/builds/preview', {});
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
};
const pageId = (key) => db.prepare('SELECT id FROM cms_pages WHERE key = ?').pluck().get(key);
const zone = (tree, name) => {
  for (const z of tree) {
    if (z.zone === name) return z;
    for (const b of z.blocks) {
      const found = zone(b.zones, name);
      if (found) return found;
    }
  }
  return null;
};
const save = (key, name, blocks) => call('PUT', `/api/pages/${pageId(key)}/blocks`, { zone: name, blocks });
const setText = (key, lang, value) => {
  const id = db.prepare('SELECT id FROM cms_entries WHERE key = ?').pluck().get(key);
  return call('PUT', `/api/entries/${id}/${lang}`, { value });
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

const pageRow = (key) => db.prepare('SELECT * FROM cms_pages WHERE key = ?').get(key);

test('réglage par défaut du gabarit, puis réglage de la page', async () => {
  const sem = (await call('GET', `/api/pages/${pageRow('seminaires').id}`)).json();
  assert.deepEqual(sem.hero, { default: { on: true, opacity: 0.5, width: 70 } });
  assert.deepEqual((await call('GET', `/api/pages/${pageRow('accueil').id}`)).json().hero, { default: { on: false, opacity: 0.5, width: 70 } });
  assert.equal((await call('GET', `/api/pages/${pageRow('moon-bar').id}`)).json().hero, null);

  await preview();
  let head = page('fr/seminaires')('header.page-head--image');
  assert.ok(head.hasClass('hero-veil'));
  assert.equal(head.attr('style'), undefined);
  assert.ok(!page('fr')('section.hero').hasClass('hero-veil'));
  assert.equal(page('fr/moon-bar')('.hero-veil').length, 0);

  // Accueil : dégradé posé, plus marqué ; Séminaires : retiré
  assert.equal((await call('PATCH', `/api/pages/${pageRow('accueil').id}`, { hero_veil: { on: true, opacity: 0.65, width: 55 } })).statusCode, 200);
  assert.equal((await call('PATCH', `/api/pages/${pageRow('seminaires').id}`, { hero_veil: { on: false, opacity: 0.5, width: 70 } })).statusCode, 200);
  assert.equal((await call('PATCH', `/api/pages/${pageRow('accueil').id}`, { hero_veil: { on: true, opacity: 2, width: 55 } })).statusCode, 400);
  assert.equal((await call('PATCH', `/api/pages/${pageRow('moon-bar').id}`, { hero_veil: { on: true, opacity: 0.5, width: 70 } })).statusCode, 400);
  await preview();
  const hero = page('fr')('section.hero');
  assert.ok(hero.hasClass('hero-veil'));
  assert.equal(hero.attr('style'), '--veil-opacity: 0.65; --veil-width: 55%');
  head = page('fr/seminaires')('header.page-head--image');
  assert.ok(!head.hasClass('hero-veil'));
  assert.equal(page('fr/seminaires')('[data-cms-hero]').length, 0);
});
