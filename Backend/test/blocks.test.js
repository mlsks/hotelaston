/**
 * Blocs des pages : sections et lignes réordonnées, masquées et dupliquées depuis l'admin
 * (copies avec leurs propres textes et traductions), sans changer le rendu tant qu'on n'y touche pas.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-blocks-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';
process.env.SITE_URL = 'https://www.hotel-aston.com';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');
const { config } = await import('../server/config.js');
const { ensureBlockEntries } = await import('../server/ssg/page-blocks.js');
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

test('arbre des blocs, textes ajoutés, rendu inchangé', async () => {
  assert.equal(ensureBlockEntries(db), 0); // déjà créés à l'import
  const tree = (await call('GET', `/api/pages/${pageId('restaurant-horloge')}/blocks`)).json();
  assert.deepEqual(tree.map((z) => z.zone), ['sections']);
  assert.deepEqual(tree[0].blocks.map((b) => b.label), ['Grande photo', 'Bandeau de photos', 'Présentation et infos pratiques', 'Stéphane Furlan, Chef de cuisine', 'Questions fréquentes sur L\'Horloge']);
  assert.deepEqual(zone(tree, 'infos-liste').blocks.slice(0, 2).map((b) => b.label), ['Capacité', 'Petit-déjeuner continental']);
  assert.equal(zone(tree, 'faq-liste').blocks.length, 4);
  assert.equal(zone(tree, 'photos-liste').blocks[0].label, 'Photo : Assiette de crustacés dressée par le Chef');

  const { warnings } = await preview();
  assert.deepEqual((warnings || []).filter((w) => /lien|clé|inconnu/i.test(w)), []);
  const $ = page('fr/restaurant-bar');
  assert.deepEqual($('.venue-index__item').map((i, a) => a.attribs.href).get(), ['/preview/fr/restaurant-horloge/', '/preview/fr/moon-bar/', '/preview/fr/aston-club/']);
  const $s = page('fr/seminaires');
  assert.deepEqual($s('.facts-row strong').map((i, s) => [[$s(s).text(), s.attribs['data-count-to'] || null]]).get(), [['7', '7'], ['200 m²', '200'], ['250', '250'], ['1er étage', null]]);
  assert.equal($('[data-cms-block], [data-cms-blocks], cms-anchor').length + $s('[data-cms-block], [data-cms-blocks]').length, 0);
});

test('ordre et masquage des sections et des lignes', async () => {
  const id = pageId('restaurant-horloge');
  const tree = (await call('GET', `/api/pages/${id}/blocks`)).json();
  const sections = tree[0].blocks.map((b) => ({ block: b.block, hidden: b.block === 'grande-photo' }));
  sections.splice(0, 0, sections.splice(4, 1)[0]); // la FAQ en premier
  assert.equal((await save('restaurant-horloge', 'sections', sections)).statusCode, 200);
  const infos = zone(tree, 'infos-liste').blocks.map((b) => ({ block: b.block, hidden: b.block === 'info-6' }));
  infos.reverse();
  const res = await save('restaurant-horloge', 'infos-liste', infos);
  assert.equal(res.statusCode, 200);
  assert.equal(zone(res.json(), 'infos-liste').blocks[0].block, 'info-7');
  assert.equal((await save('restaurant-horloge', 'sections', sections.slice(1))).statusCode, 400); // liste incomplète

  await preview();
  const $ = page('fr/restaurant-horloge');
  const kids = $('.view > div.container').first().children().map((i, el) => (el.attribs.class || el.name).split(' ')[0]).get();
  assert.deepEqual(kids, ['faq', 'photo-strip', 'venue-layout', 'team']);
  assert.deepEqual($('.info-card dt').map((i, el) => $(el).text()).get(), ['Vue', 'Dîner', 'Thé, café, chocolat', 'Déjeuner', 'Petit-déjeuner continental', 'Capacité']);
  assert.doesNotMatch($('.info-card').text(), /Formule express/);
  // JSON-LD de la FAQ : toujours là ; ligne masquée absente du rendu
  assert.match($('script[type="application/ld+json"]').text(), /FAQPage|Question/);
});

test('copie d\'une ligne et d\'une section : textes, traductions, suppression', async () => {
  const id = pageId('moon-bar');
  // Ligne : une question de la FAQ dupliquée puis modifiée
  let res = await call('POST', `/api/pages/${id}/blocks/copy`, { zone: 'faq-liste', block: 'question-2' });
  assert.equal(res.statusCode, 200, res.body);
  const q = res.json().copy;
  assert.match(q, /^question-2~\d+$/);
  const n = q.split('~')[1];
  assert.deepEqual(zone(res.json().tree, 'faq-liste').blocks.map((b) => [b.block, b.copy]), [['question-1', false], ['question-2', false], [q, true], ['question-3', false]]);
  const copied = db.prepare('SELECT key, label FROM cms_entries WHERE key LIKE ? ORDER BY key').all(`%~${n}`);
  assert.deepEqual(copied.map((e) => e.key), [`moon-bar.039-summary~${n}`, `moon-bar.040-p~${n}`]);
  assert.match(copied[0].label, /\(copie\)$/);
  assert.equal((await setText(`moon-bar.039-summary~${n}`, 'fr', 'Peut-on privatiser le rooftop ?')).statusCode, 200);

  // Section : la FAQ entière dupliquée, avec ses lignes (copie comprise) et ses traductions
  db.prepare("UPDATE cms_languages SET is_active = 1 WHERE code = 'en'").run();
  assert.equal((await setText('moon-bar.037-summary', 'en', 'Is the Moon Bar open to non-residents?')).statusCode, 200);
  res = await call('POST', `/api/pages/${id}/blocks/copy`, { zone: 'sections', block: 'faq' });
  assert.equal(res.statusCode, 200, res.body);
  const f = res.json().copy;
  const m = f.split('~')[1];
  const inner = zone(res.json().tree, `faq-liste~${m}`);
  assert.equal(inner.blocks.length, 4);
  assert.ok(inner.blocks[2].copy);
  const deep = inner.blocks[2].block.split('~')[1];
  assert.equal(db.prepare('SELECT v.value FROM cms_entries e JOIN cms_entry_values v ON v.entry_id = e.id AND v.lang = ? WHERE e.key = ?').pluck()
    .get('fr', `moon-bar.039-summary~${m}~${deep}`), 'Peut-on privatiser le rooftop ?');
  assert.equal(db.prepare('SELECT v.value FROM cms_entries e JOIN cms_entry_values v ON v.entry_id = e.id AND v.lang = ? WHERE e.key = ?').pluck()
    .get('en', `moon-bar.037-summary~${m}`), 'Is the Moon Bar open to non-residents?');

  await preview();
  let $ = page('fr/moon-bar');
  assert.equal($('section.faq').length, 2);
  assert.deepEqual($('section.faq').first().find('summary').map((i, s) => $(s).text()).get().slice(1, 3), ['Faut-il réserver ?', 'Peut-on privatiser le rooftop ?']);
  assert.equal($('section.faq').eq(1).attr('aria-labelledby'), `moonbar-faq-title-${m}`);
  assert.equal($(`#moonbar-faq-title-${m}`).length, 1);
  const $en = page('en/moon-bar');
  assert.equal($en('section.faq').eq(1).find('summary').first().text(), 'Is the Moon Bar open to non-residents?');

  // Suppression : une copie seulement, avec ses textes et ses lignes
  assert.equal((await call('POST', `/api/pages/${id}/blocks/delete`, { zone: 'faq-liste', block: 'question-1' })).statusCode, 400);
  res = await call('POST', `/api/pages/${id}/blocks/delete`, { zone: 'sections', block: f });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(db.prepare('SELECT COUNT(*) FROM cms_entries WHERE key LIKE ?').pluck().get(`%~${m}%`), 0);
  assert.equal(db.prepare('SELECT COUNT(*) FROM cms_page_blocks WHERE zone LIKE ?').pluck().get(`%~${m}`), 0);
  await preview();
  $ = page('fr/moon-bar');
  assert.equal($('section.faq').length, 1);
  assert.equal($('section.faq summary').length, 4);
});

test('copie d\'un lieu avec son lien, chiffres modifiables', async () => {
  const res = await call('POST', `/api/pages/${pageId('restaurant-bar')}/blocks/copy`, { zone: 'lieux', block: 'aston-club' });
  assert.equal(res.statusCode, 200, res.body);
  const n = res.json().copy.split('~')[1];
  assert.equal((await setText(`restaurant-bar.lien-aston-club~${n}`, 'fr', '#/live-music')).statusCode, 200);
  assert.equal((await setText(`restaurant-bar.015-strong~${n}`, 'fr', 'Live Music')).statusCode, 200);
  assert.equal((await setText('seminaires.chiffre-1', 'fr', '8')).statusCode, 200);
  await preview();
  const $ = page('fr/restaurant-bar');
  assert.deepEqual($('.venue-index__item').map((i, a) => [[$(a).find('strong').text(), a.attribs.href]]).get().slice(2),
    [['L\'Aston Club', '/preview/fr/aston-club/'], ['Live Music', '/preview/fr/live-music/']]);
  assert.equal(page('fr/seminaires')('.facts-row strong').first().attr('data-count-to'), '8');
  assert.equal(page('en/restaurant-bar')('.venue-index__item').last().attr('href'), '/preview/en/live-music/');
});
