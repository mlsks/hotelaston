/**
 * Programme Live Music écrit dans la page au build (collection « gigs »), avec la fiche de
 * chaque artiste (collection « artists ») : photo de la médiathèque, style, présentation, site.
 * Chaque concert à venir devient aussi un MusicEvent JSON-LD avec son performer (résultats enrichis
 * « événements », moteurs génératifs).
 * Sans concert programmé, la liste reste vide et le script du site affiche les prochains
 * vendredis et samedis, comme avant.
 */
import { config } from '../config.js';
import { dayIn } from '../lib/util.js';
import { toUtcIso } from '../lib/http.js';
import { esc, pictureHtml } from './media-render.js';

const VENUES = { 'selon-meteo': 'live-music.lieu-selon-meteo', 'moon-bar': 'live-music.lieu-moon-bar', 'aston-club': 'live-music.lieu-aston-club' };

/** Fiches artistes actives, par clé. */
export const artistsByKey = (source, lang, now) => new Map(source.collectionItems('artists', lang, now).map((a) => [a.key, a.data]));

/** Concerts à venir (à partir d'aujourd'hui, heure de Paris) dont l'artiste a une fiche visible, triés. */
export function upcomingGigs(source, lang, now, limit = 12, artists = artistsByKey(source, lang, now)) {
  const today = dayIn(now, config.timezone);
  return source.collectionItems('gigs', lang, now)
    .filter((g) => /^\d{4}-\d{2}-\d{2}$/.test(g.data.date || '') && g.data.date >= today && artists.get(g.data.artist)?.name)
    .sort((a, b) => `${a.data.date}${a.data.time || ''}`.localeCompare(`${b.data.date}${b.data.time || ''}`))
    .slice(0, limit);
}

function timeLabel(time, locale) {
  if (!/^\d{2}:\d{2}$/.test(time || '')) return '';
  const [h, m] = time.split(':').map(Number);
  const label = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
  return locale.startsWith('fr') ? label.replace(':', 'h') : label;
}

/** Adresse absolue de la plus grande variante WebP d'une photo (données structurées). */
function imageUrl(info, siteUrl) {
  const ws = (info?.variants || []).filter((v) => /^w\d+$/.test(v.purpose)).sort((a, b) => b.width - a.width);
  return ws.length ? `${siteUrl}/media/${ws[0].path}` : null;
}

/**
 * Remplit [data-gig-list] ; renvoie les MusicEvent pour le JSON-LD.
 * @param text (clé) → texte dans la langue
 */
export function renderGigList($, { source, lang, now, text, pageUrl, siteUrl }) {
  const list = $('[data-gig-list]').first();
  if (!list.length) return [];
  const artists = artistsByKey(source, lang, now);
  const gigs = upcomingGigs(source, lang, now, 12, artists);
  if (!gigs.length) return [];
  const locale = source.lang(lang).locale;
  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const events = [];
  for (const g of gigs) {
    const { date, time, venue = 'selon-meteo', description } = g.data;
    const a = artists.get(g.data.artist);
    const style = g.data.style || a.style;
    const about = description || a.bio;
    const website = /^https?:\/\//i.test(a.website || '') ? a.website.trim() : '';
    const photo = a.media ? source.mediaFor(a.media, lang) : null;
    const [y, mo, d] = date.split('-').map(Number);
    const where = text(VENUES[venue] || VENUES['selon-meteo']);
    const line = [timeLabel(time, locale), style, where].filter(Boolean).join(' · ');
    const picture = photo ? pictureHtml({ ...photo, alt: photo.alt || a.name }, { sizes: '72px', portrait: false, className: 'gig-list__photo' }) : '';
    const link = website ? ` <a class="gig-list__site" href="${esc(website)}" target="_blank" rel="noopener">${esc(text('ui.gigs.website'))}</a>` : '';
    list.append(`<li data-gig="${esc(g.key)}"${picture ? ' class="has-photo"' : ''}>${picture}<time datetime="${esc(time ? `${date}T${time}` : date)}">${esc(dateFmt.format(new Date(Date.UTC(y, mo - 1, d))))}</time>`
      + `<span>${esc(line)}</span><span><strong>${esc(a.name)}</strong>${about ? ` — ${esc(about)}` : ''}${link}</span></li>`);
    const image = imageUrl(photo, siteUrl);
    events.push({
      '@type': 'MusicEvent',
      name: `${a.name} — Live Music`,
      startDate: toUtcIso(time ? `${date}T${time}` : date),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      isAccessibleForFree: true,
      location: {
        '@type': 'Place',
        name: `Hôtel Aston La Scala — ${where}`,
        address: { '@type': 'PostalAddress', streetAddress: '12 avenue Félix Faure', postalCode: '06000', addressLocality: 'Nice', addressCountry: 'FR' },
      },
      performer: {
        '@type': 'MusicGroup',
        name: a.name,
        ...(style ? { genre: style } : {}),
        ...(a.bio ? { description: a.bio } : {}),
        ...(image ? { image } : {}),
        ...(website ? { url: website, sameAs: [website] } : {}),
      },
      organizer: { '@id': 'https://www.hotel-aston.com/#hotel' },
      ...(about ? { description: about } : {}),
      ...(image ? { image: [image] } : {}),
      url: pageUrl,
    });
  }
  return events;
}
