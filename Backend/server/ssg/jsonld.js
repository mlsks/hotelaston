/**
 * Données structurées JSON-LD : graphe commun (hôtel, restaurants, site) issu des réglages,
 * plus, pour chaque page, ce qui découle de son contenu visible :
 * la page elle-même (WebPage), fil d'Ariane (BreadcrumbList), questions fréquentes (FAQPage), fiche (HotelRoom…).
 * Les nœuds sont reliés par leur @id : les moteurs de réponse lisent un seul graphe cohérent (page → site → hôtel).
 */

/**
 * Graphe commun dans la langue (repli sur la langue par défaut).
 * En repli, les adresses de l'accueil par défaut pointent vers l'accueil de la langue de la page (homeUrl).
 */
export function globalGraph(source, lang, homeUrl = null) {
  const graphs = source.settings.jsonld_graph || {};
  const g = graphs[lang] || graphs[source.defaultLang];
  if (!g) return [];
  if (graphs[lang] || !homeUrl) return g['@graph'];
  return g['@graph'].map((node) => (typeof node.url === 'string' && /\/[a-z]{2}\/$/.test(node.url) ? { ...node, url: homeUrl } : node));
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
