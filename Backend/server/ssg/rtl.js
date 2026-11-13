/**
 * Langues écrites de droite à gauche (arabe ; hébreu, persan et ourdou si on les ajoute un jour).
 * La page reçoit dir="rtl" (render.js) et la feuille de style se retourne seule (styles.css, partie 12).
 */
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);

export const isRtl = (code) => RTL_LANGS.has(String(code || '').toLowerCase().split('-')[0]);

/**
 * Dans une page en arabe, l'algorithme bidirectionnel du navigateur range mal deux sortes de textes :
 *   - un numéro en plusieurs groupes (« 04 92 17 53 00 », SIRET « 798 563 003 ») : l'ordre des groupes
 *     s'inverse (« 00 53 17 92 04 ») ;
 *   - un texte tout en lettres latines qui commence ou finit par un chiffre ou un signe (« 12 avenue Félix
 *     Faure », « FR93 798 563 003 », « @hotelastonlascalanice ») : le chiffre ou le signe passe de l'autre côté.
 * Chacun est isolé dans un <bdi>, qui le garde dans l'ordre de gauche à droite.
 */
export const GROUPED_NUMBER = /\+?\d+(?:[  .]\d{2,})+/g;

const LATIN = /[A-Za-z\u00c0-\u024f]/;
const RTL_LETTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SKIP = new Set(['script', 'style', 'textarea', 'title', 'option', 'bdi', 'svg', 'template', 'noscript']);

export function isolateNumbers($) {
  const walk = (node) => {
    for (const child of [...(node.children || [])]) {
      if (child.type === 'text') {
        const text = child.data;
        if (LATIN.test(text) && !RTL_LETTER.test(text)) { // texte tout latin : isolé en entier
          const lead = text.match(/^\s*/)[0];
          const trail = text.slice(lead.length).match(/\s*$/)[0];
          $(child).replaceWith(`${lead}<bdi>${escapeHtml(text.trim())}</bdi>${trail}`);
          continue;
        }
        GROUPED_NUMBER.lastIndex = 0;
        if (!GROUPED_NUMBER.test(text)) continue;
        GROUPED_NUMBER.lastIndex = 0;
        let html = '';
        let last = 0;
        for (const m of text.matchAll(GROUPED_NUMBER)) {
          html += `${escapeHtml(text.slice(last, m.index))}<bdi>${escapeHtml(m[0])}</bdi>`;
          last = m.index + m[0].length;
        }
        html += escapeHtml(text.slice(last));
        $(child).replaceWith(html);
      } else if (child.type === 'tag' && !SKIP.has(child.name)) {
        walk(child);
      }
    }
  };
  $('body').each((i, el) => walk(el));
}
