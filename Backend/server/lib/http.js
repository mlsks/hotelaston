/**
 * Outils communs aux routes : erreurs HTTP, dates saisies à l'heure de Paris, texte riche nettoyé.
 */
import sanitizeHtml from 'sanitize-html';
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.statusCode = status;
  }
}

export const notFound = (what = 'Élément') => new HttpError(404, `${what} introuvable.`);
export const badRequest = (message) => new HttpError(400, message);

/** Décalage (ms) d'un fuseau à une date donnée. */
function tzOffset(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

/**
 * Date saisie dans l'admin → ISO UTC.
 * « 2026-12-24T18:00 » (sans fuseau) est lu à l'heure de Paris ; une date avec fuseau est gardée telle quelle.
 */
export function toUtcIso(value, timeZone = config.timezone) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value);
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw badRequest(`Date invalide : ${s}`);
    return d.toISOString();
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) throw badRequest(`Date invalide : ${s} (attendu AAAA-MM-JJ ou AAAA-MM-JJTHH:MM)`);
  const guess = Date.UTC(m[1], m[2] - 1, m[3], m[4] || 0, m[5] || 0, m[6] || 0);
  const offset = tzOffset(new Date(guess), timeZone);
  return new Date(guess - offset).toISOString();
}

const SCHEMES = ['http', 'https', 'mailto', 'tel'];
const addRel = (tagName, attribs) => ({
  tagName,
  attribs: attribs.target === '_blank' ? { ...attribs, rel: 'noopener' } : attribs,
});

/** Texte riche des pages et des fiches : mise en forme, listes, liens, intertitres. */
export const sanitizeRich = (html) => sanitizeHtml(String(html ?? ''), {
  allowedTags: ['a', 'strong', 'em', 'b', 'i', 'br', 'span', 'small', 'abbr', 'sup', 'sub', 'time', 'p', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote'],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel', 'hreflang', 'lang', 'class'],
    span: ['class', 'title', 'lang'],
    p: ['class'],
    abbr: ['title'],
    time: ['datetime'],
  },
  allowedSchemes: SCHEMES,
  allowProtocolRelative: false,
  transformTags: { a: addRel },
});

/** Texte court des bandeaux : mise en forme simple et liens seulement. */
export const sanitizeInline = (html) => sanitizeHtml(String(html ?? ''), {
  allowedTags: ['a', 'strong', 'em', 'b', 'i', 'br', 'span'],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'], span: ['class', 'lang'] },
  allowedSchemes: SCHEMES,
  allowProtocolRelative: false,
  transformTags: { a: addRel },
});

/** Adresse externe autorisée dans un appel à l'action ou un lien externe. */
export function assertHttpUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
  } catch { /* traité ci-dessous */ }
  throw badRequest(`Adresse invalide : ${value}`);
}
