/**
 * Petits utilitaires partagés : empreintes, dates, texte.
 */
import crypto from 'node:crypto';

/** Empreinte SHA-256 en hexadécimal, éventuellement tronquée. */
export const sha = (data, length = 64) => crypto.createHash('sha256').update(data).digest('hex').slice(0, length);

export const nowIso = () => new Date().toISOString();

/** Remplace chaque suite d'espaces par un seul espace (le HTML les affiche ainsi de toute façon). */
export const collapse = (s) => String(s).replace(/\s+/g, ' ');

/** Vrai si la chaîne contient au moins une lettre (« › », « — », « 360° » ou « 2 » n'en ont pas). */
export const hasLetter = (s) => /\p{L}/u.test(s);

/** Date du jour (AAAA-MM-JJ) dans un fuseau donné. */
export function dayIn(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Remplace {nom} par vars.nom. */
export const fillVars = (template, vars = {}) => String(template).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
