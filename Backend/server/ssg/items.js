/**
 * Fiches générées depuis les collections : chambres et services.
 * Portage côté serveur de renderRoom() / renderService() du site actuel :
 * même structure HTML, mais écrite dans la page au lieu d'être construite par le navigateur.
 */
import { pictureHtml } from './media-render.js';

/** Récupère un emplacement data-f du gabarit et retire le marqueur (comme fill() côté client). */
const slot = ($, view, name) => {
  const node = view.find(`[data-f="${name}"]`).first();
  node.removeAttr('data-f');
  return node;
};

const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#${id}"></use></svg>`;

/**
 * Photo d'une fiche : média de la médiathèque (row.media) en <picture> WebP,
 * sinon ancienne photo du CDN (row.src). Le texte alternatif de la fiche l'emporte.
 */
function photoHtml($, row, { cdn, media, sizes, loading }) {
  const info = row.media ? media(row.media) : null;
  if (info) return pictureHtml({ ...info, alt: row.alt ?? info.alt }, { sizes, loading, portrait: false });
  if (!row.src) return '';
  return $('<img>').attr({ src: cdn + row.src, alt: row.alt, width: String(row.w), height: String(row.h), loading, decoding: 'async' });
}

/** Adresse absolue d'une photo de fiche (données structurées). */
function photoUrl(row, { cdn, media, siteUrl }) {
  const info = row.media ? media(row.media) : null;
  if (!info) return row.src ? cdn + row.src : null;
  const ws = info.variants.filter((v) => /^w\d+$/.test(v.purpose)).sort((a, b) => b.width - a.width);
  return ws.length ? `${siteUrl}/media/${ws[0].path}` : null;
}

export function fillRoom($, view, { room, rooms, amenities, cdn, media, siteUrl, t, routeKey }) {
  const r = room.data;
  slot($, view, 'name').text(r.name);
  slot($, view, 'category').text(r.category);
  slot($, view, 'h1').text(r.h1);
  slot($, view, 'shortName').text(r.shortName);
  slot($, view, 'facts').empty().append(r.facts.map((f) => $('<span>').text(f)));
  const track = slot($, view, 'galleryLabel');
  track.attr('aria-label', t('item-chambre.galerie', { name: r.name }));
  r.gallery.forEach((g, i) => {
    const img = photoHtml($, g, { cdn, media, sizes: '(min-width: 1100px) 60vw, 100vw', loading: i ? 'lazy' : 'eager' });
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
      image: r.gallery.map((g) => photoUrl(g, { cdn, media, siteUrl })).filter(Boolean),
      containedInPlace: { '@id': 'https://www.hotel-aston.com/#hotel' },
    },
  };
}

export function fillService($, view, { service, cdn, media, t }) {
  const s = service.data;
  slot($, view, 'name').text(s.name);
  slot($, view, 'h1').text(s.h1);
  slot($, view, 'lede').text(s.lede);
  slot($, view, 'photos').empty().append(s.photos.map((p) => $('<figure>').append(
    photoHtml($, p, { cdn, media, sizes: '(min-width: 1100px) 50vw, 100vw', loading: '' }))));
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
