/**
 * Navigation de l'admin : adresses « #/… », droits par écran, menu latéral.
 * Chaque écran est un fragment HTML (views/<nom>.html) dont la racine porte son x-data ;
 * Alpine initialise le fragment dès qu'il est inséré.
 */
import Alpine from '/admin/vendor/alpine.js';

const s = () => Alpine.store('session');
const unscoped = () => !s().isScoped;
const admin = () => s().isAdmin;
const content = () => s().canContent && !s().isScoped;

const ROUTES = [
  { path: '/', view: 'home', title: 'Accueil' },
  { path: '/pages', view: 'pages', title: 'Pages', allow: unscoped },
  { path: '/pages/:id', view: 'page', title: 'Page' },
  { path: '/textes/:scope', view: 'texts', title: 'Textes', allow: unscoped },
  { path: '/collections', view: 'collections', title: 'Fiches et listes', allow: unscoped },
  { path: '/collections/:key', view: 'collection', title: 'Fiches' },
  { path: '/collections/:key/:id', view: 'item', title: 'Fiche' },
  { path: '/medias', view: 'media', title: 'Médiathèque' },
  { path: '/bandeaux', view: 'banners', title: 'Bandeaux' },
  { path: '/bandeaux/:id', view: 'banner', title: 'Bandeau' },
  { path: '/popups', view: 'popups', title: 'Popup', allow: unscoped },
  { path: '/popups/:id', view: 'popup', title: 'Popup', allow: unscoped },
  { path: '/traductions', view: 'translations', title: 'Traductions', allow: unscoped },
  { path: '/langues', view: 'languages', title: 'Langues', allow: admin },
  { path: '/versions', view: 'builds', title: 'Publication et versions' },
  { path: '/seo', view: 'seo', title: 'Rapport SEO', allow: unscoped },
  { path: '/statistiques', view: 'stats', title: 'Statistiques', allow: () => s().canStats },
  { path: '/redirections', view: 'redirects', title: 'Redirections', allow: unscoped },
  { path: '/utilisateurs', view: 'users', title: 'Utilisateurs', allow: admin },
  { path: '/reglages', view: 'settings', title: 'Réglages', allow: admin },
  { path: '/journal', view: 'audit', title: 'Journal des modifications', allow: admin },
  { path: '/compte', view: 'account', title: 'Mon compte' },
];

/** Pictogrammes du menu (traits 24 × 24). */
const ICON = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  pages: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>',
  text: '<path d="M4 6h16M4 12h10M4 18h13"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  banner: '<rect x="3" y="7" width="18" height="6" rx="1.5"/><path d="M6 17h12"/>',
  popup: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="7" y="8" width="10" height="8" rx="1"/>',
  translate: '<path d="M4 5h9M8.5 3v2c0 4-2 7.5-5 9"/><path d="M6 9c1 2.5 3 4.5 6 5.5"/><path d="m13 21 4-10 4 10M14.5 17.5h5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  rocket: '<path d="M12 15c4-3 6-7 6-12-5 0-9 2-12 6l-3 1 2 2"/><path d="M9 12l3 3"/><path d="M12 15l-1 3 2 2 1-3"/><circle cx="14.5" cy="8.5" r="1.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  arrows: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.6 3 5.2"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6.2l2.1 2.1M17.7 15.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 17.8l2.1-2.1M17.7 8.3l2.1-2.1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
export const icon = (name, cls = 'size-5') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;

/** Menu latéral selon le rôle et le périmètre. */
export function navigation() {
  const ses = s();
  if (!ses.user) return [];
  const scoped = ses.isScoped;
  const sections = [
    { label: null, items: [{ href: '#/', label: 'Accueil', icon: 'home' }] },
    {
      label: 'Contenu',
      items: [
        ...(scoped
          ? ses.scopedPages.map((p) => ({ href: `#/pages/${p.id}`, label: `Page ${p.i18n?.[ses.defaultLang]?.nav_label || p.i18n?.[ses.defaultLang]?.title?.split(/[|,–—:]/)[0]?.trim() || p.key}`, icon: 'pages' }))
          : [{ href: '#/pages', label: 'Pages', icon: 'pages' },
            { href: '#/textes/global', label: 'Textes communs', icon: 'text' },
            { href: '#/textes/ui', label: 'Textes de l’interface', icon: 'code' },
            { href: '#/collections', label: 'Fiches et listes', icon: 'list' }]),
        ...(scoped && ses.user.scopes.includes('live-music') ? [{ href: '#/collections/gigs', label: 'Programme des concerts', icon: 'music' },
          { href: '#/collections/artists', label: 'Artistes', icon: 'users' }] : []),
        { href: '#/medias', label: 'Médiathèque', icon: 'image' },
        { href: '#/bandeaux', label: 'Bandeaux', icon: 'banner' },
        ...(scoped ? [] : [{ href: '#/popups', label: 'Popup', icon: 'popup' }]),
      ],
    },
    ...(scoped ? [] : [{
      label: 'Langues',
      items: [
        { href: '#/traductions', label: 'Traductions', icon: 'translate' },
        ...(ses.isAdmin ? [{ href: '#/langues', label: 'Langues du site', icon: 'globe' }] : []),
      ],
    }]),
    {
      label: 'Site',
      items: [
        { href: '#/versions', label: 'Publication et versions', icon: 'rocket' },
        ...(scoped ? [] : [{ href: '#/seo', label: 'Rapport SEO', icon: 'search' }]),
        ...(ses.canStats ? [{ href: '#/statistiques', label: 'Statistiques', icon: 'chart' }] : []),
        ...(content() ? [{ href: '#/redirections', label: 'Redirections', icon: 'arrows' }] : []),
      ],
    },
    ...(ses.isAdmin ? [{
      label: 'Administration',
      items: [
        { href: '#/utilisateurs', label: 'Utilisateurs', icon: 'users' },
        { href: '#/reglages', label: 'Réglages', icon: 'cog' },
        { href: '#/journal', label: 'Journal des modifications', icon: 'clock' },
      ],
    }] : []),
  ];
  return sections.filter((sec) => sec.items.length);
}

/** L'entrée du menu active pour l'adresse courante (la plus longue qui correspond). */
export function isActive(href, path) {
  const target = href.slice(1);
  if (target === '/') return path === '/';
  return path === target || path.startsWith(`${target}/`);
}

const cache = new Map();
async function fragment(name) {
  if (!cache.has(name)) {
    cache.set(name, (async () => {
      const res = await fetch(`/admin/views/${name}.html`);
      if (!res.ok) throw new Error(`Écran introuvable : ${name}`);
      let html = await res.text();
      // Morceaux partagés : <template data-include="nom"></template>
      for (const m of [...html.matchAll(/<template data-include="([a-z-]+)"><\/template>/g)]) {
        const part = await fetch(`/admin/views/parts/${m[1]}.html`).then((r) => r.text());
        html = html.replace(m[0], part);
      }
      return html;
    })());
  }
  try {
    return await cache.get(name);
  } catch (err) {
    cache.delete(name);
    throw err;
  }
}

function parse(hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(query)) };
}

function match(pattern, path) {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

let renderToken = 0;
let currentHash = location.hash;

async function render() {
  const token = ++renderToken;
  const el = document.getElementById('view');
  const route = Alpine.store('route');
  const { path, query } = parse(location.hash);
  let found = null;
  for (const r of ROUTES) {
    const params = match(r.path, path);
    if (params) {
      found = { ...r, params };
      break;
    }
  }
  Alpine.store('ui').menuOpen = false;
  if (!found) found = { view: 'notfound', title: 'Introuvable', params: {} };
  if (found.allow && !found.allow()) found = { view: 'forbidden', title: 'Accès réservé', params: {} };
  Object.assign(route, { view: found.view, params: found.params, query, path, title: found.title, previewPath: null });
  document.title = `${found.title} · Back-office Aston La Scala`;
  if (['notfound', 'forbidden'].includes(found.view)) {
    el.innerHTML = `<div class="card p-8 max-w-xl"><h1 class="text-xl font-semibold">${found.title}</h1>
      <p class="mt-2 text-slate-600">${found.view === 'forbidden' ? 'Votre compte ne donne pas accès à cet écran.' : 'Cette adresse ne correspond à aucun écran.'}</p>
      <a class="btn btn-secondary mt-6" href="#/">Retour à l’accueil</a></div>`;
    return;
  }
  el.innerHTML = '<div class="py-16 text-center text-slate-500">Chargement…</div>';
  try {
    const html = await fragment(found.view);
    if (token !== renderToken) return;
    el.innerHTML = html;
    window.scrollTo(0, 0);
  } catch (err) {
    if (token === renderToken) el.innerHTML = `<div class="card p-8 text-rose-700">${err.message}</div>`;
  }
}

/** Fixe le titre de l'écran (en-tête et onglet du navigateur). */
export function setTitle(title) {
  Alpine.store('route').title = title;
  document.title = `${title} · Back-office Aston La Scala`;
}

export function startRouter() {
  window.addEventListener('hashchange', () => {
    const ui = Alpine.store('ui');
    if (ui.dirty && location.hash !== currentHash && !window.confirm('Des modifications ne sont pas enregistrées. Quitter cet écran quand même ?')) {
      history.replaceState(null, '', currentHash);
      return;
    }
    ui.dirty = false;
    currentHash = location.hash;
    render();
  });
  window.addEventListener('beforeunload', (e) => {
    if (Alpine.store('ui').dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  render();
}

export const go = (hash) => {
  if (location.hash === hash) render();
  else location.hash = hash;
};
export const rerender = () => render();
