/**
 * Calcul nocturne : agrégats quotidiens (an_daily) et purge.
 * Événements et visites bruts gardés 13 mois, agrégats 25 mois (repères CNIL).
 */
import { config } from '../config.js';
import { dayIn } from '../lib/util.js';

const DAY = 864e5;
const DIMS = ['', 'lang', 'country', 'channel', 'device'];

/** (Re)calcule les agrégats d'un jour. */
export function aggregateDay(db, day) {
  db.transaction(() => {
    db.prepare('DELETE FROM an_daily WHERE day = ?').run(day);
    const insert = db.prepare('INSERT INTO an_daily (day, metric, dim, value) VALUES (?, ?, ?, ?)');
    for (const dim of DIMS) {
      const key = dim ? `v.${dim}` : "''";
      const rows = db.prepare(`SELECT ${key} AS k, COUNT(DISTINCT v.visitor) AS visitors, COUNT(*) AS visits, SUM(v.is_engaged) AS engaged_visits,
          SUM(v.pages) AS pageviews, SUM(v.searches) AS searches, SUM(v.booking_clicks) AS booking_clicks, SUM(v.contacts) AS contacts,
          SUM(v.booking_clicks > 0) AS converting_visits
        FROM an_visits v WHERE v.day = ? GROUP BY k`).all(day);
      for (const r of rows) {
        if (dim && r.k === null) continue;
        const d = dim ? `${dim}:${r.k}` : '';
        for (const m of ['visitors', 'visits', 'engaged_visits', 'pageviews', 'searches', 'booking_clicks', 'contacts', 'converting_visits']) {
          insert.run(day, m, d, r[m] || 0);
        }
      }
    }
  })();
}

/** Agrège les jours terminés pas encore calculés, puis purge les données trop anciennes. */
export function nightly(db, { now = new Date(), log = () => {} } = {}) {
  const today = dayIn(now, config.timezone);
  const days = db.prepare(`SELECT DISTINCT day FROM an_visits WHERE day < ? AND day NOT IN (SELECT DISTINCT day FROM an_daily) ORDER BY day`).pluck().all(today);
  for (const day of days) aggregateDay(db, day);
  const rawCutoff = dayIn(new Date(now.getTime() - 396 * DAY), config.timezone); // 13 mois
  const dailyCutoff = dayIn(new Date(now.getTime() - 761 * DAY), config.timezone); // 25 mois
  const purged = db.transaction(() => ({
    events: db.prepare('DELETE FROM an_events WHERE day < ?').run(rawCutoff).changes,
    visits: db.prepare('DELETE FROM an_visits WHERE day < ?').run(rawCutoff).changes,
    daily: db.prepare('DELETE FROM an_daily WHERE day < ?').run(dailyCutoff).changes,
  }))();
  if (days.length || purged.events) log(`Statistiques : ${days.length} jour(s) agrégé(s), ${purged.events} événement(s) purgé(s).`);
  return { aggregated: days, purged };
}
