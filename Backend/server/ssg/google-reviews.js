/**
 * Avis Google sur le site : reprise, une fois, des avis de l'ancienne collection « reviews »
 * (exemples de la maquette) dans cms_google_reviews, et données lues par le script du site
 * (#data-reviews) : avis visibles notés 4 ou 5 étoiles, du plus récent au plus ancien, avec la
 * vraie note globale de la fiche Google.
 */
import { nowIso, sha } from '../lib/util.js';
import { MIN_RATING } from '../reviews/store.js';

const SEEDED = 'google_reviews';
/**
 * Chapeau de la page Avis clients : l'ancien annonçait tous les avis « tels qu'ils nous parviennent »,
 * faux dès que le site n'en montre qu'une sélection. Remplacé s'il n'a pas été retouché (les
 * traductions passent « à revoir »).
 */
const LEDE_KEY = 'avis.005-p';
const OLD_LEDE = "Nous publions les avis récents tels qu'ils nous parviennent, avec nos réponses, y compris quand ils pointent ce que nous devons améliorer.";
export const LEDE = 'Une sélection de nos avis Google récents notés 4 ou 5 étoiles, avec nos réponses. Tous les avis, y compris ceux qui pointent ce que nous devons améliorer, se lisent sur notre fiche Google.';

/** Seuil par défaut de la note moyenne affichée (Réglages → Avis clients). */
export const RATING_THRESHOLD = 4.2;

/** Avis transmis au navigateur, au plus (la page Avis en montre 20). */
const MAX_ITEMS = 40;

/**
 * Avis de la collection « reviews » → table des avis Google (exemples si les réglages disaient
 * « Exemples »), note et lien de la fiche → cms_google_place ; la collection est ensuite retirée.
 * Sans effet tant que le site n'est pas importé.
 */
export function ensureGoogleReviews(db) {
  if (db.prepare('SELECT 1 FROM cms_settings WHERE key = ?').get(SEEDED)) return 0;
  if (!db.prepare("SELECT 1 FROM cms_collections WHERE key = 'reviews'").get()) return 0;
  const metaRow = db.prepare("SELECT value FROM cms_settings WHERE key = 'reviews_meta'").pluck().get();
  const meta = metaRow ? JSON.parse(metaRow) : {};
  const origin = meta.source === 'real' ? 'manual' : 'sample';
  const items = db.prepare("SELECT key, data, is_active FROM cms_items WHERE collection = 'reviews' ORDER BY position, id").all();
  const now = nowIso();
  db.transaction(() => {
    const ins = db.prepare(`INSERT OR IGNORE INTO cms_google_reviews (review_id, author_name, rating, comment, published_at, is_visible,
      reply_comment, topics, room, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const it of items) {
      const d = JSON.parse(it.data);
      const rating = Math.min(5, Math.max(1, Math.round(Number(d.rating) || 5)));
      // « 2026-09 » (mois du séjour) : premier du mois, le site n'affiche que le mois
      const date = /^\d{4}-\d{2}$/.test(d.date || '') ? `${d.date}-01T12:00:00.000Z` : now;
      ins.run(`${origin === 'sample' ? 'exemple' : 'local'}-${it.key}`, d.author || '', rating, d.text || '', date, it.is_active ? 1 : 0,
        d.reply || null, JSON.stringify(Array.isArray(d.topics) ? d.topics : []), d.room || null, origin, now, now);
    }
    if (meta.google?.rating != null || meta.google?.url) {
      db.prepare(`INSERT OR IGNORE INTO cms_google_place (id, rating, review_count, maps_url, updated_at) VALUES (1, ?, NULL, ?, ?)`)
        .run(meta.google.rating ?? null, meta.google.url || null, now);
    }
    db.prepare("DELETE FROM cms_items WHERE collection = 'reviews'").run();
    db.prepare("DELETE FROM cms_collections WHERE key = 'reviews'").run();
    db.prepare("INSERT INTO cms_settings (key, value, updated_at) VALUES ('reviews_meta', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(JSON.stringify({ homeRatingThreshold: meta.homeRatingThreshold ?? 4 }), now);
    db.prepare(`UPDATE cms_entry_values SET value = ?, source_hash = ?, updated_at = ?
      WHERE lang = (SELECT code FROM cms_languages WHERE is_default = 1) AND value = ?
      AND entry_id = (SELECT id FROM cms_entries WHERE key = ?)`).run(LEDE, sha(LEDE), now, OLD_LEDE, LEDE_KEY);
    db.prepare('INSERT INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)').run(SEEDED, 'true', now);
  })();
  return items.length;
}

/** Données de #data-reviews pour une page (les avis restent dans leur langue d'origine). */
export function reviewsData(source) {
  const place = source.googlePlace || {};
  const items = source.googleReviews
    .filter((r) => r.is_visible && r.rating >= MIN_RATING)
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .slice(0, MAX_ITEMS)
    .map((r) => ({
      id: r.review_id,
      author: r.author_name,
      photo: r.author_photo_url || null,
      rating: r.rating,
      text: r.comment,
      date: r.published_at.slice(0, 10),
      url: r.review_url || place.maps_url || null,
      reply: r.reply_comment || '',
      topics: JSON.parse(r.topics || '[]'),
      room: r.room || null,
      sample: r.origin === 'sample',
    }));
  return {
    // Note moyenne affichée seulement à partir de ce seuil (en dessous : ni chiffre ni étoiles de la fiche)
    ratingThreshold: source.settings.reviews_meta?.ratingThreshold ?? RATING_THRESHOLD,
    minRating: MIN_RATING,
    google: { rating: place.rating ?? null, count: place.review_count ?? null, url: place.maps_url || null },
    items,
  };
}
