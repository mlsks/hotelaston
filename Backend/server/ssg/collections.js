/**
 * Collections : définition des champs traduisibles, séparation à l'import
 * (champs communs → cms_items.data, champs traduits → cms_item_i18n.data)
 * et fusion au build.
 *
 * Syntaxe des chemins : « name » (champ), « facts[] » (tableau entier),
 * « gallery[].alt » (champ de chaque élément d'un tableau d'objets).
 */
import { isPlainObject } from '../lib/util.js';

export const COLLECTIONS = {
  rooms: {
    label: 'Chambres',
    itemTemplate: 'items/chambre.html',
    parentPage: 'chambres',
    translatable: ['name', 'shortName', 'category', 'h1', 'title', 'metaDescription', 'facts[]', 'description',
      'amenitiesFull[]', 'gallery[].kind', 'gallery[].alt', 'variants[].title', 'variants[].text'],
  },
  services: {
    label: 'Services',
    itemTemplate: 'items/service.html',
    parentPage: 'services',
    translatable: ['name', 'h1', 'title', 'metaDescription', 'lede', 'photos[].alt', 'body', 'facts[]', 'faq[]'],
  },
  amenities: { label: 'Équipements (pictogrammes)', translatable: ['label'] },
  reviews: { label: 'Avis clients', translatable: [] }, // les avis restent dans leur langue d'origine
  chat: { label: 'Réponses du chat', translatable: ['keywords[]', 'answer'] },
  // Programme Live Music : date (AAAA-MM-JJ), heure (HH:MM), lieu (selon-meteo | moon-bar | aston-club),
  // artiste (clé d'une fiche « artists ») + précisions traduites ; style : seulement s'il diffère de la fiche artiste
  gigs: { label: 'Programme Live Music', translatable: ['style', 'description'] },
  // Artistes du Live Music : nom, site internet, photo (media = identifiant de la médiathèque) + style et présentation traduits
  artists: { label: 'Artistes (Live Music)', translatable: ['style', 'bio'] },
  // Menus et listes de liens (voir link-lists.js) : liste, parent, cible (page, document, adresse) + libellé traduit
  links: { label: 'Menus et liens', translatable: ['label'] },
  // Cartes du restaurant et des bars (voir menus.js) : une page par carte, rubriques et plats
  menus: { label: 'Cartes du restaurant et des bars', translatable: ['title', 'subtitle', 'backLabel', 'note', 'sections[].title', 'sections[].dishes[].name', 'sections[].dishes[].desc'] },
};

function move(src, dst, segs) {
  if (!isPlainObject(src)) return;
  const [head, ...rest] = segs;
  const isArray = head.endsWith('[]');
  const key = isArray ? head.slice(0, -2) : head;
  if (!(key in src)) return;
  if (!rest.length) {
    dst[key] = src[key];
    delete src[key];
    return;
  }
  if (isArray) {
    if (!Array.isArray(src[key])) return;
    dst[key] ??= src[key].map(() => ({}));
    src[key].forEach((item, i) => move(item, dst[key][i], rest));
  } else {
    dst[key] ??= {};
    move(src[key], dst[key], rest);
  }
}

/** Sépare un élément en { base, translated } selon les chemins traduisibles. */
export function splitTranslatable(item, paths) {
  const base = structuredClone(item);
  const translated = {};
  for (const p of paths) move(base, translated, p.split('.'));
  return { base, translated };
}

/** Fusionne les champs traduits dans les champs communs (tableaux d'objets : élément par élément). */
export function mergeTranslation(base, tr) {
  if (tr === undefined) return base;
  if (Array.isArray(tr)) {
    if (Array.isArray(base) && tr.length && tr.every(isPlainObject) && base.every(isPlainObject)) {
      return base.map((b, i) => mergeTranslation(b, tr[i]));
    }
    return tr;
  }
  if (isPlainObject(tr) && isPlainObject(base)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(tr)) out[k] = mergeTranslation(base[k], v);
    return out;
  }
  if (isPlainObject(tr) && base === undefined) return tr;
  return tr;
}
