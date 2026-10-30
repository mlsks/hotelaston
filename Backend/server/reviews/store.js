/**
 * Avis Google : lecture des formats reçus (saisie de l'admin, import JSON, API Google Business
 * Profile, API Places), enregistrement dans cms_google_reviews et fiche de l'hôtel (cms_google_place).
 *
 * Champs du site, jamais écrasés par une synchronisation : is_visible, topics, room.
 */
import { nowIso, sha, isPlainObject } from '../lib/util.js';

/** Note minimale d'un avis affiché sur le site (mention « notés 4 ou 5 étoiles »). */
export const MIN_RATING = 4;
export const TOPICS = ['sejour', 'chambres', 'petit-dejeuner', 'rooftop', 'restaurant', 'seminaire'];
export const ORIGINS = ['manual', 'import', 'api', 'sample'];
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const MAX_IMPORT = 2000;

export class ReviewError extends Error {}

const str = (v, max, what) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' && typeof v !== 'number') throw new ReviewError(`${what} : texte attendu.`);
  const s = String(v).trim();
  if (s.length > max) throw new ReviewError(`${what} : ${max} caractères au plus.`);
  return s;
};
const url = (v, what) => {
  const s = str(v, 2000, what);
  if (!s) return null;
  if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(s)) throw new ReviewError(`${what} : adresse https://… attendue.`);
  return s;
};
const iso = (v, what) => {
  const s = str(v, 40, what);
  if (!s) return null;
  // « 2026-09 » ou « 2026-09-14 » : lus à midi UTC, pour garder le même jour partout
  const full = /^\d{4}-\d{2}$/.test(s) ? `${s}-01T12:00:00Z` : /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s;
  const t = Date.parse(full);
  if (Number.isNaN(t)) throw new ReviewError(`${what} : date illisible (« ${s} »).`);
  return new Date(t).toISOString();
};

/**
 * Un avis, quel que soit son format, ramené au schéma de la table. Formats acceptés :
 *  - celui de la table (review_id, author_name, rating…), aussi produit par l'export de l'admin ;
 *  - Google Business Profile (reviewId, reviewer.displayName, starRating « FIVE », createTime, reviewReply) ;
 *  - Google Places API (authorAttribution, rating, text.text, publishTime, googleMapsUri).
 * Les champs absents restent undefined : à l'enregistrement, ils ne remplacent rien.
 */
export function normalizeReview(input) {
  if (!isPlainObject(input)) throw new ReviewError('Avis : objet JSON attendu.');
  const r = {};
  if ('starRating' in input || 'reviewer' in input) {
    // Google Business Profile : accounts.locations.reviews
    r.review_id = input.reviewId ?? String(input.name ?? '').split('/').pop();
    r.author_name = input.reviewer?.isAnonymous ? 'Un client Google' : input.reviewer?.displayName;
    r.author_photo_url = input.reviewer?.profilePhotoUrl;
    r.rating = STARS[input.starRating];
    r.comment = input.comment ?? '';
    r.published_at = input.createTime;
    r.reply_comment = input.reviewReply?.comment ?? null;
    r.reply_at = input.reviewReply?.updateTime ?? null;
  } else if ('authorAttribution' in input || 'publishTime' in input) {
    // Google Places API (New) : places.reviews
    r.review_id = String(input.name ?? '').split('/').pop();
    r.author_name = input.authorAttribution?.displayName;
    r.author_photo_url = input.authorAttribution?.photoUri;
    r.rating = input.rating;
    r.comment = input.originalText?.text ?? input.text?.text ?? '';
    r.published_at = input.publishTime;
    r.review_url = input.googleMapsUri;
  } else {
    for (const k of ['review_id', 'author_name', 'author_photo_url', 'rating', 'comment', 'published_at', 'review_url',
      'is_visible', 'reply_comment', 'reply_at', 'topics', 'room']) if (k in input) r[k] = input[k];
  }

  const out = {};
  if (r.review_id !== undefined) out.review_id = str(r.review_id, 200, 'Identifiant') || undefined;
  if (r.author_name !== undefined) out.author_name = str(r.author_name, 120, 'Auteur') || '';
  if (r.author_photo_url !== undefined) out.author_photo_url = url(r.author_photo_url, 'Photo de l’auteur');
  if (r.rating !== undefined) {
    const n = Number(r.rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new ReviewError('Note : un nombre entier de 1 à 5.');
    out.rating = n;
  }
  if (r.comment !== undefined) out.comment = str(r.comment, 5000, 'Avis') || '';
  if (r.published_at !== undefined) out.published_at = iso(r.published_at, 'Date de publication');
  if (r.review_url !== undefined) out.review_url = url(r.review_url, 'Lien de l’avis');
  if (r.is_visible !== undefined) out.is_visible = r.is_visible ? 1 : 0;
  if (r.reply_comment !== undefined) out.reply_comment = str(r.reply_comment, 5000, 'Réponse') || null;
  if (r.reply_at !== undefined) out.reply_at = iso(r.reply_at, 'Date de la réponse');
  if (r.topics !== undefined) {
    if (!Array.isArray(r.topics) || r.topics.some((t) => !TOPICS.includes(t))) throw new ReviewError(`Thèmes : parmi ${TOPICS.join(', ')}.`);
    out.topics = [...new Set(r.topics)];
  }
  if (r.room !== undefined) {
    const room = str(r.room, 80, 'Chambre');
    if (room && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(room)) throw new ReviewError('Chambre : adresse de la fiche chambre (ex. deluxe).');
    out.room = room || null;
  }
  return out;
}

/** Contenu d'un fichier d'import : liste d'avis, réponse de l'API (reviews + averageRating…), ou un seul avis. */
export function parseImport(payload) {
  let data = payload;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (err) {
      throw new ReviewError(`JSON invalide : ${err.message}`);
    }
  }
  let reviews;
  let place = null;
  if (Array.isArray(data)) reviews = data;
  else if (isPlainObject(data) && Array.isArray(data.reviews)) {
    reviews = data.reviews;
    const rating = data.averageRating ?? data.rating;
    const count = data.totalReviewCount ?? data.userRatingCount;
    if (rating !== undefined || count !== undefined) place = { rating, review_count: count };
  } else if (isPlainObject(data)) reviews = [data];
  else throw new ReviewError('Une liste d’avis est attendue.');
  if (reviews.length > MAX_IMPORT) throw new ReviewError(`${MAX_IMPORT} avis au plus par import.`);
  return {
    reviews: reviews.map((r, i) => {
      try {
        return normalizeReview(r);
      } catch (err) {
        throw new ReviewError(`Avis n° ${i + 1} : ${err.message}`);
      }
    }),
    place,
  };
}

/** Identifiant d'un avis saisi sans identifiant Google : stable pour un même auteur, une même date et un même texte. */
const localId = (r) => `local-${sha(`${r.author_name}\n${r.published_at}\n${r.comment}`, 16)}`;

const COLS = ['author_name', 'author_photo_url', 'rating', 'comment', 'published_at', 'review_url', 'is_visible', 'reply_comment', 'reply_at', 'topics', 'room'];
/** Champs propres au site : une synchronisation par l'API ne les change jamais. */
const SITE_FIELDS = ['is_visible', 'topics', 'room'];

/**
 * Ajoute ou met à jour des avis (déjà normalisés). Un avis existant ne prend que les champs fournis ;
 * pendant une synchronisation (sync), les champs du site (visibilité, thèmes, chambre) sont gardés.
 * Retourne { added, updated, unchanged, ids }.
 */
export function upsertReviews(db, reviews, { origin = 'import', sync = false } = {}) {
  if (!ORIGINS.includes(origin)) throw new ReviewError(`Origine inconnue : ${origin}.`);
  const now = nowIso();
  const find = db.prepare('SELECT * FROM cms_google_reviews WHERE review_id = ?');
  const insert = db.prepare(`INSERT INTO cms_google_reviews (review_id, ${COLS.join(', ')}, origin, created_at, updated_at)
    VALUES (@review_id, ${COLS.map((c) => `@${c}`).join(', ')}, @origin, @now, @now)`);
  const result = { added: 0, updated: 0, unchanged: 0, ids: [] };
  db.transaction(() => {
    for (const input of reviews) {
      const r = { ...input };
      if (r.topics) r.topics = JSON.stringify(r.topics);
      const id = r.review_id || (r.published_at && localId({ author_name: r.author_name ?? '', comment: r.comment ?? '', published_at: r.published_at }));
      const before = id && find.get(id);
      if (!before) {
        if (r.rating === undefined) throw new ReviewError(`Avis de ${r.author_name || 'auteur inconnu'} : note manquante.`);
        if (!r.published_at) throw new ReviewError(`Avis de ${r.author_name || 'auteur inconnu'} : date de publication manquante.`);
        insert.run({
          review_id: id, author_name: '', author_photo_url: null, comment: '', review_url: null, is_visible: 1,
          reply_comment: null, reply_at: null, topics: '[]', room: null, ...r, origin, now,
        });
        result.added += 1;
        result.ids.push(id);
        continue;
      }
      const fields = COLS.filter((c) => r[c] !== undefined && !(sync && SITE_FIELDS.includes(c)) && r[c] !== before[c]);
      // Un exemple repris par un vrai avis (même identifiant) n'est plus un exemple
      const newOrigin = sync || before.origin === 'sample' ? origin : before.origin;
      if (!fields.length && newOrigin === before.origin) {
        result.unchanged += 1;
        continue;
      }
      db.prepare(`UPDATE cms_google_reviews SET ${[...fields.map((c) => `${c} = @${c}`), 'origin = @origin', 'updated_at = @now'].join(', ')} WHERE review_id = @id`)
        .run({ ...Object.fromEntries(fields.map((c) => [c, r[c]])), origin: newOrigin, now, id });
      result.updated += 1;
      result.ids.push(id);
    }
  })();
  return result;
}

/** Ligne de la table → objet pour l'admin et l'export (thèmes lus). */
export const reviewRow = (row) => row && { ...row, topics: JSON.parse(row.topics || '[]'), is_visible: Boolean(row.is_visible) };

export function getPlace(db) {
  return db.prepare('SELECT rating, review_count, maps_url, synced_at, updated_at FROM cms_google_place WHERE id = 1').get()
    || { rating: null, review_count: null, maps_url: null, synced_at: null, updated_at: null };
}

/** Note globale, nombre d'avis, lien de la fiche : seuls les champs fournis changent. */
export function setPlace(db, input, { synced = false } = {}) {
  const next = { ...getPlace(db) };
  if (input.rating !== undefined) {
    const n = input.rating === null || input.rating === '' ? null : Number(input.rating);
    if (n !== null && (!Number.isFinite(n) || n < 1 || n > 5)) throw new ReviewError('Note globale : de 1 à 5.');
    next.rating = n === null ? null : Math.round(n * 10) / 10;
  }
  if (input.review_count !== undefined) {
    const n = input.review_count === null || input.review_count === '' ? null : Number(input.review_count);
    if (n !== null && (!Number.isInteger(n) || n < 0)) throw new ReviewError('Nombre d’avis : un nombre entier.');
    next.review_count = n;
  }
  if (input.maps_url !== undefined) next.maps_url = url(input.maps_url, 'Lien de la fiche Google');
  const now = nowIso();
  if (synced) next.synced_at = now;
  db.prepare(`INSERT INTO cms_google_place (id, rating, review_count, maps_url, synced_at, updated_at) VALUES (1, @rating, @review_count, @maps_url, @synced_at, @now)
    ON CONFLICT (id) DO UPDATE SET rating = @rating, review_count = @review_count, maps_url = @maps_url, synced_at = @synced_at, updated_at = @now`)
    .run({ ...next, now });
  return getPlace(db);
}
