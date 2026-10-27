/**
 * Règles communes à l'import (pose des data-cms-*) et au build (injection).
 * Les deux doivent voir exactement les mêmes nœuds de texte, sinon l'injection
 * se décalerait : toute modification ici concerne les deux côtés.
 */
import { hasLetter } from '../lib/util.js';

/** Éléments dont le contenu n'est jamais du texte éditable. */
export const SKIP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'code', 'pre', 'head']);

/** Balises de mise en forme autorisées dans un texte riche. */
export const PHRASING_TAGS = new Set(['a', 'strong', 'em', 'b', 'i', 'br', 'span', 'small', 'abbr', 'sup', 'sub', 'time', 'mark', 's', 'u', 'q', 'cite']);

/** Attributs autorisés sur ces balises : au-delà (data-*, événements…), l'élément reste dans le gabarit. */
export const PHRASING_ATTRS = new Set(['href', 'class', 'title', 'lang', 'hreflang', 'rel', 'target', 'datetime', 'aria-label', 'aria-current', 'aria-hidden']);

/** Attributs porteurs de texte visible ou lu par les lecteurs d'écran. */
export const TEXT_ATTRS = ['alt', 'title', 'aria-label', 'placeholder', 'data-label', 'data-subject'];

/** Éléments SVG dont le texte est traduisible (plans, légendes). */
export const SVG_TEXT_TAGS = new Set(['text', 'tspan', 'title', 'desc']);

/** Nœuds de texte traduisibles directement sous un élément, dans l'ordre. */
export const textNodes = (el) => (el.children || []).filter((c) => c.type === 'text' && hasLetter(c.data));

/** Vrai si tout le contenu de l'élément est du texte et de la mise en forme simple. */
export function isRichCandidate(el) {
  for (const c of el.children || []) {
    if (c.type === 'text') continue;
    if (c.type !== 'tag' || !PHRASING_TAGS.has(c.name)) return false;
    if (Object.keys(c.attribs || {}).some((a) => !PHRASING_ATTRS.has(a))) return false;
    if (!isRichCandidate(c)) return false;
  }
  return true;
}

/**
 * Injection (côté build) : remplace chaque texte annoté par sa valeur.
 * @param text (clé) → { value, missing }
 * @param mark (élément, missing) → repère visuel éventuel (prévisualisation)
 */
export function injectTexts($, text, mark = () => {}) {
  $('[data-cms-key]').each((i, el) => {
    const r = text(el.attribs['data-cms-key']);
    $(el).text(r.value);
    mark(el, r.missing);
  });
  $('[data-cms-html]').each((i, el) => {
    const r = text(el.attribs['data-cms-html']);
    $(el).html(r.value);
    mark(el, r.missing);
  });
  $('[data-cms-text]').each((i, el) => {
    const nodes = textNodes(el);
    el.attribs['data-cms-text'].split(',').forEach((key, j) => {
      const r = text(key);
      if (nodes[j]) nodes[j].data = r.value;
      mark(el, r.missing);
    });
  });
  $('[data-cms-attr]').each((i, el) => {
    for (const [attr, key] of parseAttrMap(el.attribs['data-cms-attr'])) {
      const r = text(key);
      el.attribs[attr] = r.value;
      mark(el, r.missing);
    }
  });
}

/** Lit data-cms-attr="alt:cle;aria-label:cle2" → [['alt', 'cle'], …]. */
export const parseAttrMap = (value) => String(value || '').split(';').filter(Boolean).map((pair) => {
  const i = pair.indexOf(':');
  return [pair.slice(0, i), pair.slice(i + 1)];
});
