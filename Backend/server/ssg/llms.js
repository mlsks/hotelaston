/**
 * llms.txt (https://llmstxt.org) : résumé du site en Markdown pour les assistants IA et les moteurs de réponse.
 * Tout vient de la base : faits de l'hôtel issus du graphe JSON-LD (réglage jsonld_graph), pages publiées avec
 * leur title et leur description. Rien n'est rédigé ici : corriger un fait dans l'admin corrige aussi ce fichier.
 */

const HEADINGS = {
  fr: { facts: 'Informations pratiques', places: 'Restaurant et bars', pages: "Pages de l'hôtel", rooms: 'Chambres et suites', services: 'Services', langs: 'Autres langues', more: 'Optional', sitemap: 'Plan du site (toutes les pages, toutes les langues)', address: 'Adresse', phone: 'Téléphone', email: 'E-mail', checkin: 'Arrivée à partir de', checkout: 'Départ avant', stars: 'Classement', starsValue: (n) => `${n} étoiles`, geo: 'Coordonnées GPS', map: 'Plan', amenities: 'Équipements', hours: 'horaires', daily: 'tous les jours' },
  en: { facts: 'Key facts', places: 'Restaurant and bars', pages: 'Hotel pages', rooms: 'Rooms and suites', services: 'Services', langs: 'Other languages', more: 'Optional', sitemap: 'Sitemap (every page, every language)', address: 'Address', phone: 'Phone', email: 'Email', checkin: 'Check-in from', checkout: 'Check-out by', stars: 'Rating', starsValue: (n) => `${n} stars`, geo: 'GPS coordinates', map: 'Map', amenities: 'Amenities', hours: 'hours', daily: 'daily' },
};

const line = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const address = (a) => (a ? [a.streetAddress, `${a.postalCode || ''} ${a.addressLocality || ''}`.trim(), a.addressCountry].filter(Boolean).join(', ') : '');

function hours(node, h) {
  const spec = [node.openingHoursSpecification].flat().filter(Boolean)[0];
  if (!spec) return '';
  const days = [spec.dayOfWeek].flat();
  return `${days.length === 7 ? h.daily : days.join(', ')} ${spec.opens}–${spec.closes}`;
}

/**
 * @param graph  graphe JSON-LD commun dans la langue par défaut
 * @param pages  [{ lang, path, title, description, kind: 'page' | 'rooms' | 'services', inSitemap }]
 * @param homes  [{ lang, name, url }] accueil de chaque langue publiée
 */
export function llmsTxt({ siteUrl, lang, graph, pages, homes }) {
  const h = HEADINGS[lang] || HEADINGS.en;
  const hotel = graph.find((n) => [n['@type']].flat().includes('Hotel')) || {};
  const out = [`# ${line(hotel.name) || siteUrl}`, ''];
  if (hotel.description) out.push(`> ${line(hotel.description)}`, '');

  const facts = [
    hotel.address && [h.address, address(hotel.address)],
    hotel.telephone && [h.phone, hotel.telephone],
    hotel.email && [h.email, hotel.email],
    hotel.checkinTime && [h.checkin, hotel.checkinTime],
    hotel.checkoutTime && [h.checkout, hotel.checkoutTime],
    hotel.starRating?.ratingValue && [h.stars, h.starsValue(hotel.starRating.ratingValue)],
    hotel.geo && [h.geo, `${hotel.geo.latitude}, ${hotel.geo.longitude}`],
    hotel.hasMap && [h.map, hotel.hasMap],
    hotel.amenityFeature?.length && [h.amenities, hotel.amenityFeature.filter((f) => f.value !== false).map((f) => line(f.name)).join(' ; ')],
  ].filter(Boolean);
  if (facts.length) out.push(`## ${h.facts}`, '', ...facts.map(([k, v]) => `- ${k} : ${line(v)}`), '');

  const places = graph.filter((n) => n['@id'] !== hotel['@id'] && [n['@type']].flat().some((t) => ['Restaurant', 'BarOrPub', 'CafeOrCoffeeShop'].includes(t)));
  if (places.length) {
    out.push(`## ${h.places}`, '');
    for (const p of places) {
      const extra = [hours(p, h) && `${h.hours} ${hours(p, h)}`, p.telephone].filter(Boolean).join(' · ');
      out.push(`- **${line(p.name)}** : ${line(p.description)}${extra ? ` (${extra})` : ''}`);
    }
    out.push('');
  }

  const own = pages.filter((p) => p.lang === lang && p.inSitemap);
  for (const [kind, title] of [['page', h.pages], ['rooms', h.rooms], ['services', h.services]]) {
    const list = own.filter((p) => p.kind === kind);
    if (!list.length) continue;
    out.push(`## ${title}`, '', ...list.map((p) => `- [${line(p.title)}](${siteUrl}${p.path})${p.description ? `: ${line(p.description)}` : ''}`), '');
  }

  const others = homes.filter((x) => x.lang !== lang);
  if (others.length) out.push(`## ${h.langs}`, '', ...others.map((x) => `- [${x.name}](${x.url})`), '');
  out.push(`## ${h.more}`, '', `- [${h.sitemap}](${siteUrl}/sitemap.xml)`, '');
  return out.join('\n');
}
