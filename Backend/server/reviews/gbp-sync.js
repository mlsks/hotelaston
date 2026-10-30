/**
 * Synchronisation des avis par l'API Google Business Profile, prête à être branchée :
 * il suffit de remplir GBP_* dans .env (identifiants OAuth du compte gestionnaire de la fiche).
 *
 *   node server/cli.js reviews:sync [--publish]       à la main
 *   GBP_SYNC_CRON=0 6 * * *                           chaque matin, avec publication des avis seuls
 *
 * 1. jeton d'accès obtenu à partir du jeton de renouvellement (refresh token, scope business.manage) ;
 * 2. accounts/{compte}/locations/{fiche}/reviews, page par page, du plus récent au plus ancien ;
 * 3. avis ajoutés ou mis à jour (la visibilité, les thèmes et la chambre choisis dans l'admin sont gardés),
 *    note globale et nombre d'avis de la fiche enregistrés.
 * Les avis supprimés sur Google ne sont pas effacés ici : ils se masquent ou se suppriment dans l'admin.
 */
import { config } from '../config.js';
import { parseImport, upsertReviews, setPlace } from './store.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://mybusiness.googleapis.com/v4';
const PAGE_SIZE = 50;
const MAX_PAGES = 20; // 1 000 avis au plus par synchronisation

const REQUIRED = ['clientId', 'clientSecret', 'refreshToken', 'accountId', 'locationId'];

export const gbpConfigured = (gbp = config.gbp) => REQUIRED.every((k) => gbp[k]);

async function accessToken(gbp, fetchImpl) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: gbp.clientId, client_secret: gbp.clientSecret, refresh_token: gbp.refreshToken, grant_type: 'refresh_token' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google OAuth : ${data.error_description || data.error || `erreur ${res.status}`}`);
  return data.access_token;
}

/** Toutes les pages d'avis de la fiche : { reviews, averageRating, totalReviewCount }. */
async function fetchReviews(gbp, token, fetchImpl) {
  const base = `${API}/accounts/${encodeURIComponent(gbp.accountId)}/locations/${encodeURIComponent(gbp.locationId)}/reviews`;
  const out = { reviews: [], averageRating: undefined, totalReviewCount: undefined };
  let pageToken = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const qs = new URLSearchParams({ pageSize: String(PAGE_SIZE), orderBy: 'updateTime desc', ...(pageToken ? { pageToken } : {}) });
    const res = await fetchImpl(`${base}?${qs}`, { headers: { authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Google Business Profile : ${data.error?.message || `erreur ${res.status}`}`);
    out.reviews.push(...(data.reviews || []));
    out.averageRating ??= data.averageRating;
    out.totalReviewCount ??= data.totalReviewCount;
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/**
 * Récupère les avis et les enregistre. Retourne { added, updated, unchanged, total, rating, count }.
 * fetchImpl : remplaçable pour les tests.
 */
export async function syncGoogleReviews(db, { gbp = config.gbp, fetchImpl = fetch, log = () => {} } = {}) {
  if (!gbpConfigured(gbp)) {
    throw new Error(`Synchronisation des avis non configurée : renseigner ${REQUIRED.map((k) => `GBP_${k.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}`).join(', ')} dans .env.`);
  }
  const token = await accessToken(gbp, fetchImpl);
  const data = await fetchReviews(gbp, token, fetchImpl);
  const { reviews, place } = parseImport(data);
  const res = upsertReviews(db, reviews, { origin: 'api', sync: true });
  setPlace(db, place || {}, { synced: true });
  log(`Avis Google : ${reviews.length} lus, ${res.added} ajoutés, ${res.updated} mis à jour.`);
  return { ...res, total: reviews.length, rating: place?.rating ?? null, count: place?.review_count ?? null };
}

/**
 * Synchronisation puis publication des seuls avis (le reste du site garde son contenu en ligne).
 * Sans publication complète préalable, les avis attendent la prochaine publication.
 */
export async function syncAndPublish(db, { log = () => {}, ...opts } = {}) {
  const result = await syncGoogleReviews(db, { log, ...opts });
  const { runBuild } = await import('../ssg/build.js');
  const { currentBuild } = await import('../ssg/release.js');
  const { REVIEWS_SCOPE } = await import('../ssg/snapshot.js');
  if (!currentBuild(db)) {
    log('Avis Google : rien n’est encore publié, les avis partiront avec la première publication.');
    return { ...result, build: null };
  }
  const build = await runBuild({ kind: 'production', trigger: 'manual', scope: [REVIEWS_SCOPE], log });
  log(`Avis Google : publication #${build.id} ${build.status}${build.error ? ` (${build.error})` : ''}`);
  return { ...result, build };
}
