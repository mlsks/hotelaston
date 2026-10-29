/**
 * Données structurées JSON-LD : graphe commun (hôtel, restaurants, site) issu des réglages,
 * plus, pour chaque page, ce qui découle de son contenu visible :
 * la page elle-même (WebPage), fil d'Ariane (BreadcrumbList), questions fréquentes (FAQPage), fiche (HotelRoom…).
 * Les nœuds sont reliés par leur @id : les moteurs de réponse lisent un seul graphe cohérent (page → site → hôtel).
 */

/**
 * Graphe commun dans la langue de la page. Le réglage jsonld_graph est un modèle unique : la structure
 * Schema.org (clés, types, @id, adresse, horaires…) ne change jamais ; les valeurs écrites
 *   {{clé}}          → texte traduisible (Textes → Données structurées), dans la langue de la page ;
 *   {{url:page}}     → adresse de la page dans cette langue (propriété retirée si la page n'existe pas) ;
 *   {{inLanguage}}   → langue de la page (fr-FR, en-GB…).
 * ctx : { text(key) → string, url(pageKey) → adresse absolue ou null, locale, warn? }.
 * Ancien format (un graphe figé par langue, snapshot antérieur) : repli sur la langue par défaut,
 * l'adresse de l'accueil pointant vers celle de la langue de la page (homeUrl).
 */
export function globalGraph(source, lang, ctx = null, homeUrl = null) {
  const setting = source.settings.jsonld_graph || {};
  if (Array.isArray(setting['@graph'])) return ctx ? resolveGraph(setting['@graph'], ctx) : setting['@graph'];
  const g = setting[lang] || setting[source.defaultLang];
  if (!g) return [];
  if (setting[lang] || !homeUrl) return g['@graph'];
  return g['@graph'].map((node) => (typeof node.url === 'string' && /\/[a-z]{2}\/$/.test(node.url) ? { ...node, url: homeUrl } : node));
}

const HOLE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const DROP = Symbol('drop');

/** Remplace les {{…}} du modèle ; une adresse de page inconnue retire la propriété (ou l'élément de liste). */
export function resolveGraph(nodes, { text, url, locale, warn = () => {} }) {
  const value = (ref) => {
    if (ref === 'inLanguage') return locale;
    if (ref.startsWith('url:')) {
      const href = url(ref.slice(4).trim());
      if (!href) warn(`JSON-LD : page inconnue ou non publiée « ${ref.slice(4).trim()} »`);
      return href || DROP;
    }
    const v = text(ref);
    if (v === null || v === undefined || v === '') { warn(`JSON-LD : texte vide ou inconnu « ${ref} »`); return DROP; }
    return v;
  };
  const walk = (v) => {
    if (typeof v === 'string') {
      const whole = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(v);
      if (whole) return value(whole[1]);
      let dropped = false;
      const out = v.replace(HOLE, (m, ref) => {
        const r = value(ref);
        if (r === DROP) dropped = true;
        return r === DROP ? '' : r;
      });
      return dropped && !out.trim() ? DROP : out;
    }
    if (Array.isArray(v)) return v.map(walk).filter((x) => x !== DROP);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        const r = walk(x);
        if (r !== DROP) out[k] = r;
      }
      return out;
    }
    return v;
  };
  return walk(nodes);
}

/** La page : titre, description, langue, image principale, reliée au site, à l'hôtel et à son contenu principal. */
export function webPageNode({ url, name, description, locale, siteUrl, image, breadcrumb, mainEntity, faq }) {
  return {
    '@type': faq ? ['WebPage', 'FAQPage'] : 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: locale,
    isPartOf: { '@id': `${siteUrl}/#website` },
    about: { '@id': `${siteUrl}/#hotel` },
    ...(image ? { primaryImageOfPage: { '@type': 'ImageObject', url: image } } : {}),
    ...(breadcrumb ? { breadcrumb: { '@id': breadcrumb } } : {}),
    ...(mainEntity ? { mainEntity: { '@id': mainEntity } } : {}),
    ...(faq ? { mainEntity: faq } : {}),
  };
}

export function breadcrumbFromDom($, absolute) {
  const nav = $('main nav.breadcrumb').first();
  if (!nav.length) return null;
  const items = [];
  nav.children('a, [aria-current="page"]').each((i, el) => {
    const name = $(el).text().trim();
    if (!name) return;
    const item = { '@type': 'ListItem', position: items.length + 1, name };
    if (el.name === 'a') item.item = absolute(el.attribs.href);
    items.push(item);
  });
  return items.length > 1 ? { '@type': 'BreadcrumbList', itemListElement: items } : null;
}

export function faqFromDom($) {
  const questions = [];
  $('main .faq details').each((i, el) => {
    // Réponse encore « à confirmer » par l'hôtel : pas de données structurées (les IA la citeraient comme un fait)
    if ($(el).find('.verify').length) return;
    const q = $(el).children('summary').first().text().trim();
    const a = $(el).children().not('summary').text().replace(/\s+/g, ' ').trim();
    if (q && a) questions.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } });
  });
  return questions.length ? { '@type': 'FAQPage', mainEntity: questions } : null;
}

/** Sérialise pour une balise <script> (« </script> » ne doit jamais apparaître). */
export const jsonForScript = (data) => JSON.stringify(data).replace(/</g, '\\u003c');
