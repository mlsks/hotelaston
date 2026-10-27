/**
 * Fiches générées depuis les collections : chambres et services.
 * Portage côté serveur de renderRoom() / renderService() du site actuel :
 * même structure HTML, mais écrite dans la page au lieu d'être construite par le navigateur.
 */

/** Récupère un emplacement data-f du gabarit et retire le marqueur (comme fill() côté client). */
const slot = ($, view, name) => {
  const node = view.find(`[data-f="${name}"]`).first();
  node.removeAttr('data-f');
  return node;
};

const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#${id}"></use></svg>`;

export function fillRoom($, view, { room, rooms, amenities, cdn, t, routeKey }) {
  const r = room.data;
  slot($, view, 'name').text(r.name);
  slot($, view, 'category').text(r.category);
  slot($, view, 'h1').text(r.h1);
  slot($, view, 'shortName').text(r.shortName);
  slot($, view, 'facts').empty().append(r.facts.map((f) => $('<span>').text(f)));
  const track = slot($, view, 'galleryLabel');
  track.attr('aria-label', t('item-chambre.galerie', { name: r.name }));
  r.gallery.forEach((g, i) => {
    const img = $('<img>').attr({ src: cdn + g.src, alt: g.alt, width: String(g.w), height: String(g.h), loading: i ? 'lazy' : 'eager', decoding: 'async' });
    track.append($('<figure>').append(img, $('<figcaption>').text(g.kind)));
  });
  slot($, view, 'description').text(r.description);
  const variants = slot($, view, 'variants');
  if (r.variants) {
    variants.attr('class', 'variants');
    for (const v of r.variants) variants.append($('<div class="variant">').append($('<h3>').text(v.title), $('<p>').text(v.text)));
  }
  slot($, view, 'amenities').empty().append(r.amenities.map((key) => {
    const a = amenities.get(key);
    return $('<li>').append(icon(a.icon)).append(escapeText(a.label));
  }));
  slot($, view, 'amenitiesFull').empty().append(r.amenitiesFull.map((f) => $('<li>').text(f)));
  const reviews = slot($, view, 'reviews');
  reviews.attr('data-topic', r.reviewTopic);
  reviews.attr('data-room', room.key);
  slot($, view, 'otherRooms').empty().append(rooms
    .filter((o) => o.key !== room.key)
    .map((o) => $('<li>').append($('<a>').attr('href', `#/${routeKey}/${o.key}`).text(o.data.name))));
  view.find('[data-room-select]').attr('value', room.key);

  return {
    title: r.title,
    description: r.metaDescription,
    ld: {
      '@type': 'HotelRoom',
      name: r.name,
      description: r.description,
      floorSize: { '@type': 'QuantitativeValue', value: r.sizeM2, unitCode: 'MTK' },
      occupancy: { '@type': 'QuantitativeValue', maxValue: r.maxGuests },
      amenityFeature: r.amenitiesFull.map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true })),
      image: r.gallery.map((g) => cdn + g.src),
      containedInPlace: { '@id': 'https://www.hotel-aston.com/#hotel' },
    },
  };
}

export function fillService($, view, { service, cdn, t }) {
  const s = service.data;
  slot($, view, 'name').text(s.name);
  slot($, view, 'h1').text(s.h1);
  slot($, view, 'lede').text(s.lede);
  slot($, view, 'photos').empty().append(s.photos.map((p) => $('<figure>').append(
    $('<img>').attr({ src: cdn + p.src, alt: p.alt, width: String(p.w), height: String(p.h), decoding: 'async' }))));
  slot($, view, 'body').html(s.body); // contenu éditorial interne, nettoyé à l'enregistrement (brique 2)
  slot($, view, 'facts').empty().append(s.facts.map(([dt, dd]) => $('<div>').append($('<dt>').text(dt), $('<dd>').text(dd))));
  const faq = slot($, view, 'faq');
  faq.append($('<h2>').text(t('item-service.faq-titre', { nameLower: s.name.toLowerCase() })));
  for (const [q, a] of s.faq) faq.append($('<details>').append($('<summary>').text(q), $('<p>').text(a)));
  return { title: s.title, description: s.metaDescription, ld: null };
}

/** Texte échappé, utilisable avec .append() de Cheerio (qui lit une chaîne comme du HTML). */
function escapeText(text) {
  return String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
