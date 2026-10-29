/**
 * Popup d'une offre (« Promouvoir en popup ») : contenu repris de la fiche et remplaçable, dates
 * et visibilité de l'offre ; conflits entre popups et choix de celui qui s'affiche.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-offer-popups-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';
process.env.SITE_URL = 'https://www.hotel-aston.com';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');
const { config } = await import('../server/config.js');
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
const popupOf = (rel) => page(rel)('dialog.cms-popup');

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

test('promouvoir une offre : contenu de la fiche, bouton de réservation, photo', async () => {
  const unknown = await call('POST', '/api/popups', { name: 'X', offer_key: 'inconnue' });
  assert.equal(unknown.statusCode, 400);
  const created = await call('POST', '/api/popups', { name: 'Offre · Nouvel An', offer_key: 'nouvel-an', is_active: true });
  assert.equal(created.statusCode, 201, created.body);
  const p = created.json();
  assert.deepEqual([p.offer.key, p.offer.title, p.conflicts], ['nouvel-an', 'Nouvel An à Nice', []]);
  await preview();
  const dialog = popupOf('fr');
  assert.equal(dialog.find('h2').text(), 'Nouvel An à Nice');
  assert.ok(dialog.find('.cms-popup__text li').length >= 1, 'ce qui est compris');
  assert.ok(dialog.find('.cms-popup__media img[srcset], .cms-popup__media picture').length, 'photo de l’offre');
  const btn = dialog.find('a[data-book]');
  assert.deepEqual([btn.attr('data-offer-id'), btn.attr('data-checkin'), btn.attr('data-checkout'), btn.text()], ['nouvel-an', '2026-12-30', '2027-01-01', 'Réserver cette offre']);
  // Le titre du popup remplace celui de l'offre ; le reste vient toujours de la fiche
  assert.equal((await call('PUT', `/api/popups/${p.id}/i18n/fr`, { title: 'Réveillon sur la Promenade', body: null, cta_kind: 'none' })).statusCode, 200);
  await preview();
  assert.equal(popupOf('fr').find('h2').text(), 'Réveillon sur la Promenade');
  assert.equal(popupOf('fr').find('a[data-book]').attr('data-offer-id'), 'nouvel-an');
  // Textes vidés : retour à ceux de l'offre ; un popup ordinaire garde son titre obligatoire
  assert.equal((await call('PUT', `/api/popups/${p.id}/i18n/fr`, { title: '', body: null, cta_kind: 'none' })).json().i18n.fr.state, 'missing');
  const plain = (await call('POST', '/api/popups', { name: 'Simple' })).json();
  assert.equal((await call('PUT', `/api/popups/${plain.id}/i18n/fr`, { title: '' })).statusCode, 400);
  await call('DELETE', `/api/popups/${plain.id}`);
  // Offre masquée, puis hors de ses dates : plus de popup
  const it = offer('nouvel-an');
  await call('PATCH', `/api/items/${it.id}`, { is_active: false });
  await preview();
  assert.equal(popupOf('fr').length, 0);
  await call('PATCH', `/api/items/${it.id}`, { is_active: true, end_at: '2026-01-01T00:00' });
  await preview();
  assert.equal(popupOf('fr').length, 0);
  await call('PATCH', `/api/items/${it.id}`, { end_at: null });
  await preview();
  assert.equal(popupOf('fr').length, 1);
});

test('conflits : signalés à priorité égale, tranchés par le choix, l’autre reprend après', async () => {
  const offerPopup = db.prepare("SELECT id FROM cms_popups WHERE offer_key = 'nouvel-an'").pluck().get();
  const other = (await call('POST', '/api/popups', { name: 'Newsletter', is_active: true })).json();
  await call('PUT', `/api/popups/${other.id}/i18n/fr`, { title: 'Nos nouvelles' });
  // Pages sans recoupement : pas de conflit
  await call('PUT', `/api/popups/${other.id}/pages`, [{ page_key: 'faq' }]);
  await call('PUT', `/api/popups/${offerPopup}/pages`, [{ page_key: 'faq', mode: 'exclude' }]);
  assert.deepEqual((await call('GET', `/api/popups/${other.id}`)).json().conflicts, []);
  // Toutes les pages : conflit, non tranché
  await call('PUT', `/api/popups/${other.id}/pages`, []);
  const c = (await call('GET', `/api/popups/${offerPopup}`)).json().conflicts;
  assert.equal(c.length, 1);
  assert.equal(c[0].id, other.id);
  assert.equal(c[0].resolved, false);
  assert.ok(!c[0].pages.includes('faq') && c[0].pages.includes('accueil'));
  // Bornes de l'offre : la période commune s'arrête avec l'offre
  const it = offer('nouvel-an');
  await call('PATCH', `/api/items/${it.id}`, { end_at: '2030-01-02T00:00' });
  assert.equal((await call('GET', `/api/popups/${other.id}`)).json().conflicts[0].end, '2030-01-01T23:00:00.000Z');
  // Choix : la Newsletter passe devant pendant la période commune
  const chosen = (await call('POST', `/api/popups/${other.id}/prefer`, { over: offerPopup })).json();
  assert.deepEqual([chosen.priority, chosen.conflicts[0].resolved, chosen.conflicts[0].winner], [1, true, other.id]);
  await preview();
  assert.equal(popupOf('fr').find('h2').text(), 'Nos nouvelles');
  // Puis l'offre
  await call('POST', `/api/popups/${offerPopup}/prefer`, { over: other.id });
  await preview();
  assert.equal(popupOf('fr').find('h2').text(), 'Nouvel An à Nice');
  // Popup inactif ou période passée : plus de conflit
  await call('PATCH', `/api/popups/${other.id}`, { end_at: '2026-01-01T00:00' });
  assert.deepEqual((await call('GET', `/api/popups/${offerPopup}`)).json().conflicts, []);
  const list = (await call('GET', '/api/popups')).json();
  assert.ok(list.every((p) => Array.isArray(p.conflicts)));
});

test('une offre supprimée emporte son popup', async () => {
  const it = offer('nouvel-an');
  assert.equal((await call('DELETE', `/api/items/${it.id}`)).statusCode, 200);
  assert.equal(db.prepare("SELECT COUNT(*) FROM cms_popups WHERE offer_key = 'nouvel-an'").pluck().get(), 0);
});
