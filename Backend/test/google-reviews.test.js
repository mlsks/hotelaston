/**
 * Avis Google : reprise des exemples de la maquette, admin (ajout, import JSON, visibilité, fiche),
 * données du site (4 et 5 étoiles visibles, vraie note globale), synchronisation par l'API et
 * publication des seuls avis.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-avis-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';
process.env.SITE_URL = 'https://www.hotel-aston.com';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');
const { config } = await import('../server/config.js');
const { ensureGoogleReviews, LEDE } = await import('../server/ssg/google-reviews.js');
const { parseImport, upsertReviews } = await import('../server/reviews/store.js');
const { syncGoogleReviews, syncAndPublish } = await import('../server/reviews/gbp-sync.js');
const { nowIso } = await import('../server/lib/util.js');

let app;
let db;
let session;
const PASSWORD = 'mot-de-passe-de-test-123';
const SEED = path.join(config.root, 'server', 'db', 'seeds', 'avis-google-exemples.json');

function call(method, url, payload) {
  return app.inject({ method, url, payload, headers: { cookie: session.cookie, 'x-csrf-token': session.csrf } });
}
/** #data-reviews d'une page générée (prévisualisation ou version en ligne). */
const reviewsOf = (dir, rel) => {
  const html = fs.readFileSync(path.join(dir, rel, 'index.html'), 'utf8');
  return JSON.parse(html.match(/<script type="application\/json" id="data-reviews"[^>]*>([\s\S]*?)<\/script>/)[1]);
};
const preview = async () => {
  const res = await call('POST', '/api/builds/preview', {});
  assert.equal(res.statusCode, 200, res.body);
  return reviewsOf(config.previewDir, 'fr/avis');
};
const row = (id) => db.prepare('SELECT * FROM cms_google_reviews WHERE review_id = ?').get(id);

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

test('exemples de la maquette repris dans la table des avis, collection retirée', async () => {
  const rows = db.prepare('SELECT * FROM cms_google_reviews ORDER BY review_id').all();
  assert.equal(rows.length, 8);
  assert.ok(rows.every((r) => r.origin === 'sample'));
  assert.equal(row('exemple-avis-01').author_name, 'Claire M.');
  assert.equal(row('exemple-avis-01').published_at, '2026-09-01T12:00:00.000Z');
  assert.ok(!db.prepare("SELECT 1 FROM cms_collections WHERE key = 'reviews'").get());
  const place = db.prepare('SELECT * FROM cms_google_place').get();
  assert.equal(place.rating, 3.8);
  assert.match(place.maps_url, /^https:\/\/maps\.app\.goo\.gl\//);
  assert.equal(ensureGoogleReviews(db), 0);
  // Chapeau de la page Avis : plus de « tous les avis tels qu'ils nous parviennent »
  const lede = db.prepare("SELECT v.value FROM cms_entry_values v JOIN cms_entries e ON e.id = v.entry_id WHERE e.key = 'avis.005-p' AND v.lang = 'fr'").pluck().get();
  assert.equal(lede, LEDE);

  // Le fichier d'exemples reprend les mêmes avis : rien d'ajouté
  const { reviews } = parseImport(fs.readFileSync(SEED, 'utf8'));
  const res = upsertReviews(db, reviews, { origin: 'sample' });
  assert.equal(res.added, 0);
});

test('formats acceptés : table, Google Business Profile, Places API', () => {
  const { reviews, place } = parseImport({
    averageRating: 4.3, totalReviewCount: 812,
    reviews: [
      { reviewId: 'gbp-1', reviewer: { displayName: 'Ana', profilePhotoUrl: 'https://lh3.googleusercontent.com/a/1' }, starRating: 'FIVE',
        comment: 'Parfait', createTime: '2026-10-20T08:00:00Z', reviewReply: { comment: 'Merci Ana', updateTime: '2026-10-21T08:00:00Z' } },
      { name: 'places/x/reviews/pl-1', rating: 4, text: { text: 'Bien' }, authorAttribution: { displayName: 'Bo', photoUri: 'https://lh3.googleusercontent.com/a/2' },
        publishTime: '2026-10-19T08:00:00Z', googleMapsUri: 'https://www.google.com/maps/reviews/pl-1' },
      { author_name: 'Cy', rating: 5, comment: 'Top', published_at: '2026-10-18' },
    ],
  });
  assert.deepEqual(place, { rating: 4.3, review_count: 812 });
  assert.equal(reviews[0].review_id, 'gbp-1');
  assert.equal(reviews[0].rating, 5);
  assert.equal(reviews[0].reply_comment, 'Merci Ana');
  assert.equal(reviews[1].review_id, 'pl-1');
  assert.equal(reviews[1].review_url, 'https://www.google.com/maps/reviews/pl-1');
  assert.equal(reviews[2].published_at, '2026-10-18T12:00:00.000Z');
  assert.throws(() => parseImport([{ author_name: 'X', rating: 6, published_at: '2026-10-01' }]), /Avis n° 1 : Note/);
  assert.throws(() => parseImport('{pas du json'), /JSON invalide/);
  assert.throws(() => parseImport([{ author_name: 'X', rating: 5, published_at: '2026-10-01', author_photo_url: 'javascript:alert(1)' }]), /https/);
});

test('admin : liste, ajout, import, masquage, fiche ; le site ne montre que 4 et 5 étoiles visibles', async () => {
  let data = await preview();
  // Exemples : 7 sur 8 (l'avis à 3 étoiles est écarté), du plus récent au plus ancien, marqués « Exemple »
  assert.equal(data.items.length, 7);
  assert.ok(data.items.every((it) => it.rating >= 4 && it.sample));
  assert.equal(data.items[0].author, 'Claire M.');
  assert.deepEqual(data.google, { rating: 3.8, count: null, url: data.google.url });
  assert.equal(data.minRating, 4);
  assert.equal(data.ratingThreshold, 4.2); // note moyenne masquée en dessous

  let res = await call('GET', '/api/google-reviews');
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().reviews.length, 8);
  assert.equal(res.json().syncConfigured, false);

  res = await call('POST', '/api/google-reviews', { author_name: 'Léa', rating: 5, comment: 'Superbe rooftop', published_at: '2026-10-25',
    review_url: 'https://maps.app.goo.gl/avis-lea', topics: ['rooftop'] });
  assert.equal(res.statusCode, 201, res.body);
  const lea = res.json();
  assert.match(lea.review_id, /^local-/);
  assert.equal(lea.origin, 'manual');
  assert.equal((await call('POST', '/api/google-reviews', { author_name: 'Léa', rating: 5, comment: 'Superbe rooftop', published_at: '2026-10-25' })).statusCode, 400);
  assert.equal((await call('POST', '/api/google-reviews', { author_name: 'Léa', rating: 9, published_at: '2026-10-25' })).statusCode, 400);

  res = await call('POST', '/api/google-reviews/import', { data: JSON.stringify({ averageRating: 4.1, totalReviewCount: 1234, reviews: [
    { reviewId: 'g-5', reviewer: { displayName: 'Max' }, starRating: 'FIVE', comment: 'Merci !', createTime: '2026-10-27T09:00:00Z' },
    { reviewId: 'g-2', reviewer: { displayName: 'Zoé' }, starRating: 'TWO', comment: 'Bruyant', createTime: '2026-10-28T09:00:00Z' },
  ] }) });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual([res.json().added, res.json().updated], [2, 0]);
  assert.equal(res.json().place.rating, 4.1);

  res = await call('PATCH', `/api/google-reviews/${encodeURIComponent('exemple-avis-01')}`, { is_visible: false });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().is_visible, false);
  res = await call('PUT', '/api/google-reviews/place', { rating: 4.2, review_count: 1240, maps_url: 'https://maps.app.goo.gl/miuLYvSR4CBYPEBw7' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await call('PUT', '/api/google-reviews/place', { maps_url: 'http://exemple.fr' })).statusCode, 400);

  data = await preview();
  const authors = data.items.map((it) => it.author);
  assert.deepEqual(authors.slice(0, 2), ['Max', 'Léa']); // les plus récents d'abord ; Zoé (2 étoiles) écartée
  assert.ok(!authors.includes('Zoé') && !authors.includes('Claire M.'));
  assert.deepEqual(data.google, { rating: 4.2, count: 1240, url: 'https://maps.app.goo.gl/miuLYvSR4CBYPEBw7' });
  const max = data.items[0];
  assert.equal(max.sample, false);
  assert.equal(max.url, 'https://maps.app.goo.gl/miuLYvSR4CBYPEBw7'); // sans lien propre : la fiche
  assert.equal(data.items[1].url, 'https://maps.app.goo.gl/avis-lea');

  // Mention des critères de sélection : texte d'interface traduisible
  const entry = db.prepare("SELECT v.value FROM cms_entries e JOIN cms_entry_values v ON v.entry_id = e.id WHERE e.key = 'ui.reviews.selection' AND v.lang = 'fr'").pluck().get();
  assert.equal(entry, "Sélection d'avis Google récents notés 4 ou 5 étoiles.");
  // Traductions livrées (seeds/ui-strings.json), prêtes : les langues restent publiées
  const en = db.prepare("SELECT v.value, v.status FROM cms_entries e JOIN cms_entry_values v ON v.entry_id = e.id WHERE e.key = 'ui.reviews.all' AND v.lang = 'en'").get();
  assert.deepEqual({ ...en }, { value: 'See all reviews on Google Maps', status: 'ready' });

  assert.equal((await call('DELETE', `/api/google-reviews/${encodeURIComponent(lea.review_id)}`)).statusCode, 204);
  assert.ok(!row(lea.review_id));
});

/** Faux Google : jeton OAuth puis deux pages d'avis. */
function fakeGoogle(pages, calls = []) {
  return async (url, opts = {}) => {
    calls.push(String(url));
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      assert.equal(new URLSearchParams(opts.body).get('refresh_token'), 'rt');
      return Response.json({ access_token: 'at', expires_in: 3600 });
    }
    assert.equal(opts.headers.authorization, 'Bearer at');
    assert.match(String(url), /^https:\/\/mybusiness\.googleapis\.com\/v4\/accounts\/123\/locations\/456\/reviews\?/);
    const token = new URL(url).searchParams.get('pageToken');
    return Response.json(pages[token || 'first']);
  };
}
const GBP = { clientId: 'id', clientSecret: 'secret', refreshToken: 'rt', accountId: '123', locationId: '456' };

test('synchronisation par l’API : ajout, mise à jour, choix de l’admin gardés, publication des avis seuls', async () => {
  await assert.rejects(() => syncGoogleReviews(db, { gbp: { ...GBP, refreshToken: '' } }), /GBP_REFRESH_TOKEN/);

  // Première publication complète, puis un brouillon ailleurs qui ne doit pas partir avec les avis
  const pub = await call('POST', '/api/builds/publish', {});
  assert.equal(pub.statusCode, 200, pub.body);
  const legal = db.prepare("SELECT v.entry_id, v.value FROM cms_entry_values v JOIN cms_entries e ON e.id = v.entry_id WHERE e.key = 'ui.reviews.all' AND v.lang = 'fr'").get();
  db.prepare("UPDATE cms_entry_values SET value = 'BROUILLON' WHERE entry_id = ? AND lang = 'fr'").run(legal.entry_id);
  db.prepare('UPDATE cms_google_reviews SET is_visible = 0 WHERE review_id = ?').run('g-5');

  const calls = [];
  const res = await syncAndPublish(db, {
    gbp: GBP,
    fetchImpl: fakeGoogle({
      first: { averageRating: 4.3, totalReviewCount: 1250, nextPageToken: 'p2', reviews: [
        { reviewId: 'g-5', reviewer: { displayName: 'Max' }, starRating: 'FIVE', comment: 'Merci beaucoup !', createTime: '2026-10-27T09:00:00Z' },
        { reviewId: 'g-9', reviewer: { displayName: 'Ines', profilePhotoUrl: 'https://lh3.googleusercontent.com/a/ines' }, starRating: 'FOUR', comment: 'Très bien', createTime: '2026-10-29T09:00:00Z' },
      ] },
      p2: { reviews: [{ reviewId: 'g-10', reviewer: { isAnonymous: true }, starRating: 'FIVE', createTime: '2026-10-29T10:00:00Z' }] },
    }, calls),
  });
  assert.equal(calls.length, 3);
  assert.deepEqual([res.added, res.updated, res.total], [2, 1, 3]);
  assert.equal(res.build.status, 'success');
  assert.equal(row('g-5').comment, 'Merci beaucoup !');
  assert.equal(row('g-5').is_visible, 0, 'masqué dans l’admin : reste masqué');
  assert.equal(row('g-5').origin, 'api');
  assert.equal(row('g-10').author_name, 'Un client Google');
  assert.ok(db.prepare('SELECT synced_at FROM cms_google_place').pluck().get());

  const live = reviewsOf(config.publicDist, 'fr/avis');
  assert.equal(live.google.rating, 4.3);
  assert.equal(live.google.count, 1250);
  assert.deepEqual(live.items.slice(0, 2).map((it) => it.author), ['Un client Google', 'Ines']);
  assert.ok(!live.items.some((it) => it.author === 'Max'));
  const html = fs.readFileSync(path.join(config.publicDist, 'fr', 'avis', 'index.html'), 'utf8');
  assert.ok(!html.includes('BROUILLON'), 'le brouillon d’un texte ne part pas avec les avis');

  // Texte d'un avis repris de Google : non modifiable dans l'admin
  assert.equal((await call('PATCH', '/api/google-reviews/g-9', { comment: 'Retouché' })).statusCode, 400);
  assert.equal((await call('PATCH', '/api/google-reviews/g-9', { topics: ['chambres'], room: 'deluxe' })).statusCode, 200);
});

test('page Avis Google automatique : servie avec le droit d’appeler Google, et seulement elle', async () => {
  const tool = await app.inject({ method: 'GET', url: '/admin/outils/avis-google.html' });
  assert.equal(tool.statusCode, 200);
  assert.match(tool.headers['content-security-policy'], /script-src 'self' https:\/\/accounts\.google\.com/);
  assert.match(tool.headers['content-security-policy'], /connect-src 'self' https:\/\/\*\.googleapis\.com/);
  const js = await app.inject({ method: 'GET', url: '/admin/outils/avis-google.js' });
  assert.equal(js.statusCode, 200);
  const admin = await app.inject({ method: 'GET', url: '/admin/' });
  assert.match(admin.headers['content-security-policy'], /connect-src 'self';/);
  assert.equal((await call('GET', '/api/google-reviews')).json().clientId, null);
});
