/**
 * Programme Live Music écrit dans la page au build (collection « gigs »).
 * Chaque concert à venir devient aussi un MusicEvent JSON-LD (résultats enrichis « événements »).
 * Sans concert programmé, la liste reste vide et le script du site affiche les prochains
 * vendredis et samedis, comme avant.
 */
import { config } from '../config.js';
import { dayIn } from '../lib/util.js';
import { toUtcIso } from '../lib/http.js';
import { esc } from './media-render.js';

const VENUES = { 'selon-meteo': 'live-music.lieu-selon-meteo', 'moon-bar': 'live-music.lieu-moon-bar', 'aston-club': 'live-music.lieu-aston-club' };

/** Concerts à venir (à partir d'aujourd'hui, heure de Paris), triés. */
export function upcomingGigs(source, lang, now, limit = 12) {
  const today = dayIn(now, config.timezone);
  return source.collectionItems('gigs', lang, now)
    .filter((g) => /^\d{4}-\d{2}-\d{2}$/.test(g.data.date || '') && g.data.date >= today && g.data.artist)
    .sort((a, b) => `${a.data.date}${a.data.time || ''}`.localeCompare(`${b.data.date}${b.data.time || ''}`))
    .slice(0, limit);
}

function timeLabel(time, locale) {
  if (!/^\d{2}:\d{2}$/.test(time || '')) return '';
  const [h, m] = time.split(':').map(Number);
  const label = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
  return locale.startsWith('fr') ? label.replace(':', 'h') : label;
}

/**
 * Remplit [data-gig-list] ; renvoie les MusicEvent pour le JSON-LD.
 * @param text (clé) → texte dans la langue
 */
export function renderGigList($, { source, lang, now, text, pageUrl }) {
  const list = $('[data-gig-list]').first();
  if (!list.length) return [];
  const gigs = upcomingGigs(source, lang, now);
  if (!gigs.length) return [];
  const locale = source.lang(lang).locale;
  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const events = [];
  for (const g of gigs) {
    const { date, time, venue = 'selon-meteo', artist, style, description } = g.data;
    const [y, mo, d] = date.split('-').map(Number);
    const where = text(VENUES[venue] || VENUES['selon-meteo']);
    const line = [timeLabel(time, locale), style, where].filter(Boolean).join(' · ');
    list.append(`<li data-gig="${esc(g.key)}"><time datetime="${esc(time ? `${date}T${time}` : date)}">${esc(dateFmt.format(new Date(Date.UTC(y, mo - 1, d))))}</time>`
      + `<span>${esc(line)}</span><span><strong>${esc(artist)}</strong>${description ? ` — ${esc(description)}` : ''}</span></li>`);
    events.push({
      '@type': 'MusicEvent',
      name: `${artist} — Live Music`,
      startDate: toUtcIso(time ? `${date}T${time}` : date),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      isAccessibleForFree: true,
      location: {
        '@type': 'Place',
        name: `Hôtel Aston La Scala — ${where}`,
        address: { '@type': 'PostalAddress', streetAddress: '12 avenue Félix Faure', postalCode: '06000', addressLocality: 'Nice', addressCountry: 'FR' },
      },
      performer: { '@type': 'MusicGroup', name: artist },
      organizer: { '@id': 'https://www.hotel-aston.com/#hotel' },
      ...(description ? { description } : {}),
      url: pageUrl,
    });
  }
  return events;
}
