/**
 * Offres de la page Offres et des aperçus de l'accueil : reprise des cartes des gabarits dans les
 * fiches (traductions comprises), rendu dans l'ordre des fiches, ajout, masquage, dates, accueil.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-offers-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';
process.env.SITE_URL = 'https://www.hotel-aston.com';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');
const { config } = await import('../server/config.js');
const { ensureOffers } = await import('../server/ssg/offer-cards.js');
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
const offer = (key) => db.prepare("SELECT * FROM cms_items WHERE collection = 'offers' AND key = ?").get(key);
const titles = ($) => $('.offer-card h2').map((i, h) => $(h).text()).get();

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

test('offres des gabarits reprises dans les fiches, rendu inchangé', async () => {
  const keys = db.prepare("SELECT key FROM cms_items WHERE collection = 'offers' ORDER BY position").pluck().all();
  assert.deepEqual(keys, ['escapade-gourmande', 'nouvel-an', 'carnaval', 'menu-horloge', 'formule-express', 'seminaire-residentiel', 'journee-etude']);
  const nouvelAn = JSON.parse(offer('nouvel-an').data);
  assert.deepEqual([nouvelAn.family, nouvelAn.action, nouvelAn.checkin, nouvelAn.checkout, nouvelAn.onHome, nouvelAn.toConfirm], ['sejour', 'booking', '2026-12-30', '2027-01-01', false, true]);
  assert.ok(nouvelAn.media && !nouvelAn.src, 'photo reliée à la médiathèque');
  const entries = (like) => db.prepare('SELECT key FROM cms_entries WHERE key LIKE ? ORDER BY key').pluck().all(like);
  assert.equal(entries('offres.0%').length, 10); // fil d'Ariane, titre, chapeau, filtres
  assert.deepEqual(entries('offres.photo%'), []);
  assert.deepEqual(entries('accueil.17_-%').filter((k) => k < 'accueil.179'), []); // aperçus de l'accueil
  assert.equal(ensureOffers(db), 0);

  await preview();
  const $ = page('fr/offres');
  assert.deepEqual(titles($), ['Escapade gourmande', 'Nouvel An à Nice', 'Magie du Carnaval', 'Menu 3 plats à L\'Horloge', 'Formule express & menu affaires', 'Séminaire résidentiel', 'Journée d\'étude']);
  const first = $('.offer-card').first();
  assert.equal(first.attr('data-family'), 'sejour');
  assert.equal(first.find('.offer-card__price').html(), '<span class="verify">À partir de 239 €</span> <small>la nuit pour 2</small>');
  assert.equal(first.find('.checklist li').length, 3);
  assert.ok(first.find('picture, img').length);
  const book = $('.offer-card').eq(1).find('a.btn');
  assert.deepEqual([book.attr('data-offer-id'), book.attr('data-checkin'), book.attr('data-checkout'), book.text()], ['nouvel-an', '2026-12-30', '2027-01-01', 'Réserver cette offre']);
  assert.equal($('.offer-card').eq(5).find('a.btn').attr('href'), '/preview/fr/devis/?offre=seminaire-residentiel');
  assert.equal($('.offer-card').eq(3).find('a.btn').attr('href'), '/preview/fr/restaurant-horloge/?a=reserver-horloge');
  assert.equal($('[data-filter]').length, 4);
  const $h = page('fr');
  assert.deepEqual($h('.offer-teaser').map((i, a) => [[$h(a).find('strong').text(), a.attribs.href]]).get(), [
    ['Escapade gourmande', '/preview/fr/offres/?famille=sejour'], ['Menu 3 plats à 34 €', '/preview/fr/offres/?famille=restaurant'], ['Séminaire résidentiel', '/preview/fr/offres/?famille=seminaires']]);
  assert.equal($('[data-f], [data-cms-offers]').length + $h('[data-f], [data-cms-offers]').length, 0);
});

test('ajout, contrôles, ordre, masquage, dates et accueil', async () => {
  const bad = await call('POST', '/api/collections/offers/items', { key: 'test', data: { title: 'Test', family: 'spa', action: 'booking' } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /famille/);
  const badLink = await call('POST', '/api/collections/offers/items', { key: 'test', data: { title: 'Test', family: 'sejour', action: 'link', link: 'javascript:alert(1)' } });
  assert.equal(badLink.statusCode, 400);
  const created = await call('POST', '/api/collections/offers/items', { key: 'saint-valentin', position: -1, data: {
    family: 'sejour', tag: 'Séjour', title: 'Saint-Valentin', price: '199 €', priceNote: 'pour 2', includes: ['Champagne en chambre'],
    action: 'booking', button: 'Réserver', checkin: '2027-02-14', checkout: '2027-02-15', onHome: true, teaserText: 'Une nuit à deux', toConfirm: false } });
  assert.equal(created.statusCode, 201, created.body);
  // Plus de séminaires : leur filtre disparaît ; Carnaval terminé ; Escapade retirée de l'accueil
  for (const key of ['seminaire-residentiel', 'journee-etude']) assert.equal((await call('PATCH', `/api/items/${offer(key).id}`, { is_active: false })).statusCode, 200);
  assert.equal((await call('PATCH', `/api/items/${offer('carnaval').id}`, { end_at: '2026-01-01T00:00' })).statusCode, 200);
  const esc = offer('escapade-gourmande');
  assert.equal((await call('PATCH', `/api/items/${esc.id}`, { data: { ...JSON.parse(esc.data), onHome: false } })).statusCode, 200);
  await preview();
  const $ = page('fr/offres');
  assert.deepEqual(titles($), ['Saint-Valentin', 'Escapade gourmande', 'Nouvel An à Nice', 'Menu 3 plats à L\'Horloge', 'Formule express & menu affaires']);
  const card = $('.offer-card').first();
  assert.equal(card.find('.offer-card__price').html(), '199 € <small>pour 2</small>');
  assert.equal(card.find('.offer-card__saving, .offer-card__conditions, picture, img').length, 0);
  assert.equal(card.find('a.btn').attr('data-offer-id'), 'saint-valentin');
  assert.deepEqual($('[data-filter]').map((i, b) => b.attribs['data-filter']).get(), ['all', 'sejour', 'restaurant']);
  const $h = page('fr');
  assert.deepEqual($h('.offer-teaser strong').map((i, s) => $h(s).text()).get(), ['Saint-Valentin', 'Menu 3 plats à 34 €']);
  assert.match($h('script').text(), /"offerNames":\{[^}]*"saint-valentin":"Saint-Valentin"/);
  // Offre « devis » ajoutée : proposée dans le formulaire de devis, parmi les offres (ici masquées)
  assert.equal((await call('POST', '/api/collections/offers/items', { key: 'seminaire-hiver', data: { family: 'seminaires', title: 'Séminaire d’hiver', action: 'quote', button: 'Demander un devis' } })).statusCode, 201);
  await preview();
  const options = page('fr/devis')('select[data-quote-offer] option').map((i, o) => o.attribs.value).get();
  assert.deepEqual(options.slice(0, 4), ['', 'seminaire-hiver', 'seminaire-residentiel', 'journee-etude']);
  assert.equal(page('fr/offres')('[data-filter="seminaires"]').length, 1);
  // Plus aucune offre sur l'accueil : la section disparaît
  for (const key of ['saint-valentin', 'menu-horloge']) {
    const it = offer(key);
    await call('PATCH', `/api/items/${it.id}`, { data: { ...JSON.parse(it.data), onHome: false } });
  }
  await preview();
  assert.equal(page('fr')('#home-offers-title').length, 0);
});

test('reprise des traductions : prête si complète et à jour, sinon brouillon ou à revoir', () => {
  // Base où les textes de l'Escapade existent encore, traduits
  db.prepare("DELETE FROM cms_items WHERE collection = 'offers'").run();
  db.prepare("DELETE FROM cms_settings WHERE key = 'offer_cards'").run();
  for (const code of ['en', 'it', 'de']) db.prepare("UPDATE cms_languages SET is_active = 1 WHERE code = ?").run(code);
  const now = nowIso();
  const fr = { 'offres.012-p': 'Séjour', 'offres.013-h2': 'Escapade gourmande' };
  const tr = {
    en: { 'offres.012-p': ['Stay', 'ready', true], 'offres.013-h2': ['Gourmet getaway', 'ready', true] },
    it: { 'offres.013-h2': ['Fuga gourmet', 'ready', true] },
    de: { 'offres.012-p': ['Aufenthalt', 'ready', false], 'offres.013-h2': ['Genussauszeit', 'ready', true] },
  };
  for (const [key, value] of Object.entries(fr)) {
    const id = db.prepare("INSERT INTO cms_entries (key, page_id, type, label, position, created_at, updated_at) VALUES (?, NULL, 'text', ?, 0, ?, ?)").run(key, key, now, now).lastInsertRowid;
    db.prepare("INSERT INTO cms_entry_values (entry_id, lang, value, status, source_hash, updated_at) VALUES (?, 'fr', ?, 'ready', ?, ?)").run(id, value, sha(value), now);
    for (const [lang, values] of Object.entries(tr)) {
      if (!values[key]) continue;
      const [v, status, upToDate] = values[key];
      db.prepare('INSERT INTO cms_entry_values (entry_id, lang, value, status, source_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, lang, v, status, upToDate ? sha(value) : sha('ancien'), now);
    }
  }
  assert.equal(ensureOffers(db), 7);
  const id = offer('escapade-gourmande').id;
  const rows = Object.fromEntries(db.prepare('SELECT * FROM cms_item_i18n WHERE item_id = ?').all(id).map((r) => [r.lang, r]));
  const frHash = sha(rows.fr.data);
  assert.deepEqual(JSON.parse(rows.fr.data), { tag: 'Séjour', title: 'Escapade gourmande' });
  assert.deepEqual([JSON.parse(rows.en.data).title, rows.en.status, rows.en.source_hash], ['Gourmet getaway', 'ready', frHash]);
  assert.deepEqual([JSON.parse(rows.it.data), rows.it.status], [{ title: 'Fuga gourmet' }, 'draft']);
  assert.equal(rows.de.status, 'ready');
  assert.notEqual(rows.de.source_hash, frHash); // « à revoir »
  assert.equal(db.prepare("SELECT COUNT(*) FROM cms_entries WHERE key IN ('offres.012-p', 'offres.013-h2')").pluck().get(), 0);
});
