/**
 * Données structurées JSON-LD : graphe commun (hôtel, restaurants, site) issu des réglages,
 * plus, pour chaque page, ce qui découle de son contenu visible :
 * fil d'Ariane (BreadcrumbList), questions fréquentes (FAQPage), fiche (HotelRoom…).
 */

/** Graphe commun dans la langue (repli sur la langue par défaut). */
export function globalGraph(source, lang) {
  const graphs = source.settings.jsonld_graph || {};
  const g = graphs[lang] || graphs[source.defaultLang];
  return g ? g['@graph'] : [];
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
    const q = $(el).children('summary').first().text().trim();
    const a = $(el).children().not('summary').text().replace(/\s+/g, ' ').trim();
    if (q && a) questions.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } });
  });
  return questions.length ? { '@type': 'FAQPage', mainEntity: questions } : null;
}

/** Sérialise pour une balise <script> (« </script> » ne doit jamais apparaître). */
export const jsonForScript = (data) => JSON.stringify(data).replace(/</g, '\\u003c');
