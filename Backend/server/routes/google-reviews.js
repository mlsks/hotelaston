/**
 * Avis Google (écran Avis Google de l'admin) : liste, ajout, import JSON, visibilité, thèmes,
 * fiche de l'hôtel (note globale, nombre d'avis, lien). Le texte d'un avis venu de l'API
 * Google Business Profile ne se modifie pas : seuls sa visibilité, ses thèmes et sa chambre.
 */
import { guard, assertUnscoped } from '../auth/auth.js';
import { notFound, badRequest } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { normalizeReview, parseImport, upsertReviews, reviewRow, getPlace, setPlace, ReviewError, MIN_RATING, TOPICS } from '../reviews/store.js';
import { gbpConfigured } from '../reviews/gbp-sync.js';
import { config } from '../config.js';

const PARAM = { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 200 } } };
const SITE_FIELDS = ['is_visible', 'topics', 'room'];

/** Erreur de saisie → 400 lisible dans l'admin. */
const checked = (fn) => {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ReviewError) throw badRequest(err.message);
    throw err;
  }
};

export default function googleReviewRoutes(app, { db }) {
  const find = (id) => reviewRow(db.prepare('SELECT * FROM cms_google_reviews WHERE review_id = ?').get(id));

  app.get('/google-reviews', { preHandler: guard() }, async (req) => {
    assertUnscoped(req);
    return {
      place: getPlace(db),
      minRating: MIN_RATING,
      topics: TOPICS,
      syncConfigured: gbpConfigured(),
      clientId: config.gbp.clientId || null, // identifiant OAuth public (page Avis Google automatique)
      reviews: db.prepare('SELECT * FROM cms_google_reviews ORDER BY published_at DESC, review_id').all().map(reviewRow),
    };
  });

  /** Un avis saisi à la main (recopié de la fiche Google). */
  app.post('/google-reviews', { preHandler: guard('content') }, async (req, reply) => {
    assertUnscoped(req);
    const review = checked(() => normalizeReview(req.body));
    if (review.rating === undefined || !review.published_at || !review.author_name) throw badRequest('Auteur, note et date sont obligatoires.');
    if (review.review_id && find(review.review_id)) throw badRequest('Un avis porte déjà cet identifiant.');
    const res = checked(() => upsertReviews(db, [review], { origin: 'manual' }));
    if (!res.added) throw badRequest('Cet avis existe déjà (même auteur, même date, même texte).');
    const row = find(res.ids[0]);
    audit(db, req, 'create', 'google_review', row.review_id, { after: row });
    return reply.code(201).send(row);
  });

  /** Import d'un fichier JSON : liste d'avis, réponse de l'API Google (reviews, averageRating, totalReviewCount). */
  app.post('/google-reviews/import', {
    preHandler: guard('content'),
    bodyLimit: 8 * 1024 * 1024,
    schema: { body: { type: 'object', required: ['data'], properties: { data: {}, sample: { type: 'boolean' } } } },
  }, async (req) => {
    assertUnscoped(req);
    const { reviews, place } = checked(() => parseImport(req.body.data));
    const res = checked(() => upsertReviews(db, reviews, { origin: req.body.sample ? 'sample' : 'import' }));
    if (place) checked(() => setPlace(db, place));
    audit(db, req, 'import', 'google_review', null, { after: { added: res.added, updated: res.updated, place } });
    return { added: res.added, updated: res.updated, unchanged: res.unchanged, place: place ? getPlace(db) : null };
  });

  app.patch('/google-reviews/:id', { preHandler: guard('content'), schema: { params: PARAM } }, async (req) => {
    assertUnscoped(req);
    const before = find(req.params.id);
    if (!before) throw notFound('Avis');
    const fields = checked(() => normalizeReview(req.body));
    delete fields.review_id;
    const locked = before.origin === 'api' && Object.keys(fields).filter((k) => !SITE_FIELDS.includes(k));
    if (locked?.length) throw badRequest('Avis repris de Google : seuls sa visibilité, ses thèmes et sa chambre se modifient.');
    checked(() => upsertReviews(db, [{ ...fields, review_id: before.review_id }], { origin: before.origin }));
    const after = find(before.review_id);
    audit(db, req, 'update', 'google_review', before.review_id, { before, after });
    return after;
  });

  app.delete('/google-reviews/:id', { preHandler: guard('content'), schema: { params: PARAM } }, async (req, reply) => {
    assertUnscoped(req);
    const before = find(req.params.id);
    if (!before) throw notFound('Avis');
    db.prepare('DELETE FROM cms_google_reviews WHERE review_id = ?').run(before.review_id);
    audit(db, req, 'delete', 'google_review', before.review_id, { before });
    return reply.code(204).send();
  });

  /** Fiche Google de l'hôtel : vraie note globale, nombre total d'avis, lien vers la fiche. */
  app.put('/google-reviews/place', {
    preHandler: guard('content'),
    schema: { body: { type: 'object', additionalProperties: false, properties: {
      rating: { type: ['number', 'string', 'null'] }, review_count: { type: ['integer', 'string', 'null'] }, maps_url: { type: ['string', 'null'], maxLength: 2000 },
    } } },
  }, async (req) => {
    assertUnscoped(req);
    const before = getPlace(db);
    const after = checked(() => setPlace(db, req.body));
    audit(db, req, 'update', 'google_place', 1, { before, after });
    return after;
  });
}
