/**
 * sw.js — service worker du site Hôtel Aston La Scala
 * ---------------------------------------------------------------------------
 * - Pages, CSS, JS : réseau d'abord (les mises à jour apparaissent tout de suite),
 *   cache en secours hors ligne.
 * - Images du site (posters, logos, icônes) : servies depuis le cache, mises à jour
 *   en arrière-plan. La photo du Hero s'affiche donc instantanément dès la 2e visite.
 * - Vidéos : servies depuis le cache quand elles y sont, avec gestion des requêtes
 *   Range (la balise <video> lit par morceaux). Mise en cache :
 *     · en passant, quand la réponse réseau couvre tout le fichier (pas de 2e téléchargement) ;
 *     · ou à la demande de la page ({ type: 'cache-media', url }) quand la connexion le permet.
 *   Jamais en mode « économie de données ». Une requête HEAD vérifie ensuite que la
 *   copie est à jour (ETag / Last-Modified / taille) ; sinon elle est retirée.
 * Actif uniquement en HTTPS ou sur localhost.
 */
const VERSION = 'v2';
const STATIC_CACHE = `aston-static-${VERSION}`;
const MEDIA_CACHE = 'aston-media-v1';
const PRECACHE = [
  './',
  'index.html',
  'styles.css',
  'remotion-vanilla.js',
  'media/hero-piscine-1600.webp',
  'media/hero-piscine-portrait.webp',
  'media/video_hero-poster.webp',
  'img/logo-aston-blanc.png',
  'img/logo-aston-or.png',
  'favicon.ico',
];

const saveData = () => Boolean(self.navigator.connection && self.navigator.connection.saveData);
const isMedia = (url) => /\.(mp4|webm)$/i.test(url.pathname);
const isImage = (url) => /\.(webp|png|jpe?g|svg|ico)$/i.test(url.pathname);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC_CACHE, MEDIA_CACHE]);
    for (const key of await caches.keys()) if (key.startsWith('aston-') && !keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // CDN des photos, polices : laissés au navigateur
  if (isMedia(url)) event.respondWith(media(event));
  else if (isImage(url)) event.respondWith(staleWhileRevalidate(event));
  else event.respondWith(networkFirst(event));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'cache-media' && typeof event.data.url === 'string') {
    event.waitUntil(cacheMedia(event.data.url));
  }
});

/* ---------- Pages et ressources ---------- */

async function networkFirst(event) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(event.request);
    if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
    return response;
  } catch (err) {
    const cached = await cache.match(event.request, { ignoreSearch: event.request.mode === 'navigate' });
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(event.request);
  const network = fetch(event.request)
    .then((response) => {
      if (response.ok) return cache.put(event.request, response.clone()).then(() => response);
      return response;
    })
    .catch(() => cached);
  event.waitUntil(network);
  return cached || network;
}

/* ---------- Vidéos ---------- */

const inflight = new Set();
const revalidated = new Set();

async function media(event) {
  const { request } = event;
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request.url);
  if (cached) {
    event.waitUntil(revalidateMedia(cache, request.url, cached));
    return fromCache(cached, request.headers.get('range'));
  }
  const response = await fetch(request);
  if (coversWholeFile(response) && !saveData() && !inflight.has(request.url)) {
    // La copie est lue en parallèle de la lecture : un seul téléchargement
    event.waitUntil(storeMedia(cache, request.url, response.clone()));
  }
  return response;
}

async function cacheMedia(href) {
  const url = new URL(href, self.location.href);
  if (url.origin !== self.location.origin || !isMedia(url) || saveData() || inflight.has(url.href)) return;
  const cache = await caches.open(MEDIA_CACHE);
  if (await cache.match(url.href)) return;
  const response = await fetch(url.href);
  if (coversWholeFile(response)) await storeMedia(cache, url.href, response);
}

function coversWholeFile(response) {
  if (response.status === 200) return true;
  if (response.status !== 206) return false;
  const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(response.headers.get('content-range') || '');
  return Boolean(m) && Number(m[1]) === 0 && Number(m[2]) === Number(m[3]) - 1;
}

async function storeMedia(cache, url, response) {
  inflight.add(url);
  try {
    const blob = await response.blob();
    const headers = { 'Content-Type': response.headers.get('content-type') || 'video/mp4', 'Content-Length': String(blob.size) };
    for (const key of ['etag', 'last-modified']) {
      const value = response.headers.get(key);
      if (value) headers[key] = value;
    }
    await cache.put(url, new Response(blob, { status: 200, headers }));
  } catch {
    /* lecture interrompue (hors ligne, onglet fermé) : rien n'est gardé */
  } finally {
    inflight.delete(url);
  }
}

/** Réponse 200 ou 206 construite depuis la copie en cache. */
async function fromCache(cached, range) {
  const blob = await cached.blob();
  const type = cached.headers.get('content-type') || 'video/mp4';
  const size = blob.size;
  if (!range) {
    return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] !== '' ? Number(m[1]) : NaN;
  let end = m && m[2] !== '' ? Number(m[2]) : NaN;
  if (Number.isNaN(start)) { start = Math.max(0, size - (Number.isNaN(end) ? 0 : end)); end = size - 1; } // bytes=-N
  if (Number.isNaN(end) || end >= size) end = size - 1;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}

/** Une fois par démarrage du service worker : la copie correspond-elle encore au fichier en ligne ? */
async function revalidateMedia(cache, url, cached) {
  if (revalidated.has(url) || saveData()) return;
  revalidated.add(url);
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!head.ok) return;
    const changed = ['etag', 'last-modified', 'content-length'].some((key) => {
      const online = head.headers.get(key);
      const kept = cached.headers.get(key);
      return online && kept && online !== kept;
    });
    if (changed) await cache.delete(url); // nouvelle version au prochain passage
  } catch {
    /* hors ligne : on garde la copie */
  }
}
