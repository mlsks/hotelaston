/**
 * Salles de séminaire : reprise du tableau des capacités dans des fiches (traductions comprises),
 * tableau de la page Séminaires et liste du formulaire de devis construits depuis les fiches.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-salles-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';
process.env.SITE_URL = 'https://www.hotel-aston.com';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');
const { config } = await import('../server/config.js');
const { ensureMeetingRooms } = await import('../server/ssg/meeting-rooms.js');
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

const room = (key) => db.prepare("SELECT * FROM cms_items WHERE collection = 'meeting_rooms' AND key = ?").get(key);
const rows = ($) => $('.capacity__table tbody tr').map((i, tr) => [[$(tr).find('strong').text(), ...$(tr).find('td').map((j, td) => $(td).text()).get()]]).get();

test('salles du gabarit reprises dans les fiches, rendu inchangé', async () => {
  const keys = db.prepare("SELECT key FROM cms_items WHERE collection = 'meeting_rooms' ORDER BY position").pluck().all();
  assert.deepEqual(keys, ['chagall', 'renoir-dufy', 'cesar-klein', 'vigny', 'mezzanine', 'matisse', 'aston-club']);
  const chagall = JSON.parse(room('chagall').data);
  assert.deepEqual([chagall.surface, chagall.theatre, chagall.classroom, chagall.ushape, chagall.cabaret, chagall.banquet], ['133', '200', '110', '50', '', '']);
  assert.ok(chagall.media && !chagall.src, 'photo reliée à la médiathèque');
  const left = db.prepare("SELECT key FROM cms_entries WHERE key BETWEEN 'seminaires.025' AND 'seminaires.109' ORDER BY key").pluck().all();
  assert.deepEqual(left, ['seminaires.027-a', 'seminaires.028-td@data-label', 'seminaires.030-td@data-label', 'seminaires.031-td@data-label',
    'seminaires.032-td@data-label', 'seminaires.033-td@data-label', 'seminaires.034-span', 'seminaires.035-td@data-label', 'seminaires.101-span']);
  assert.equal(db.prepare("SELECT COUNT(*) FROM cms_entries WHERE key BETWEEN 'devis.013' AND 'devis.019~'").pluck().get(), 0);
  assert.equal(ensureMeetingRooms(db), 0);

  await preview();
  const $ = page('fr/seminaires');
  assert.deepEqual(rows($).slice(0, 2), [['Salon Chagall', '133 m²', '200', '110', '50', 'Sur demande', 'Sur demande'], ['Salons Renoir + Dufy', '91 m²', '95', '55', '35', 'Sur demande', 'Sur demande']]);
  assert.deepEqual(rows($)[6], ['L\'Aston Club', 'À préciser', '—', '—', '—', 'Sur demande', 'Sur demande']);
  const first = $('.capacity__table tbody tr').first();
  assert.equal(first.find('td').eq(4).html(), '<span class="verify">Sur demande</span>');
  assert.equal(first.find('td').first().attr('data-label'), 'Surface');
  assert.equal(first.find('a').attr('href'), '/preview/fr/devis/?salle=chagall');
  assert.equal(first.find('small').text(), '1er étage · lumière du jour · sonorisation');
  assert.ok(first.find('picture, img').length);
  const options = page('fr/devis')('select[data-quote-offer] option').map((i, o) => [[o.attribs.value, page('fr/devis')(o).text()]]).get();
  assert.deepEqual(options.slice(4, 6), [['chagall', 'Salon Chagall'], ['renoir-dufy', 'Salons Renoir + Dufy']]);
  assert.equal(options.at(-1)[0], 'comite-entreprise');
  assert.equal($('[data-f], [data-cms-meeting-rooms]').length, 0);
});

test('ajout, contrôles, ordre et masquage', async () => {
  const bad = await call('POST', '/api/collections/meeting_rooms/items', { key: 'test', data: { name: 'Test', theatre: 'beaucoup' } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /capacités/);
  const created = await call('POST', '/api/collections/meeting_rooms/items', { key: 'salon-picasso', position: -1, data: {
    name: 'Salon Picasso', detail: 'Rez-de-chaussée', surface: '45', theatre: '40', classroom: '24', ushape: '-', cabaret: '', banquet: '30' } });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal((await call('PATCH', `/api/items/${room('vigny').id}`, { is_active: false })).statusCode, 200);
  await preview();
  const $ = page('fr/seminaires');
  assert.deepEqual(rows($)[0], ['Salon Picasso', '45 m²', '40', '24', '—', 'Sur demande', '30']);
  assert.ok(!rows($).some((r) => r[0] === 'Salon Vigny'));
  assert.equal($('.capacity__table tbody tr').first().find('picture, img').length, 0);
  const values = page('fr/devis')('select[data-quote-offer] option').map((i, o) => o.attribs.value).get();
  assert.ok(values.includes('salon-picasso') && !values.includes('vigny'));
  const en = page('en/seminaires');
  assert.equal(en('.capacity__table tbody tr').first().find('strong').text(), 'Salon Picasso'); // repli sur le français
});
