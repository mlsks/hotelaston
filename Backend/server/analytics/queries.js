/**
 * Requêtes du tableau de bord (ARCHITECTURE.md § 8.7).
 * Période : semaine (lundi → dimanche), mois ou année civils, comparée à la précédente.
 * Filtres croisés : langue, pays, appareil, canal (sur la visite).
 *
 * Visiteurs uniques : exacts à la journée ; sur une période, somme des visiteurs de chaque jour
 * (sans identifiant persistant, une même personne revenue deux jours compte deux fois).
 */

const DAY = 864e5;
const iso = (d) => d.toISOString().slice(0, 10);

/** Bornes (AAAA-MM-JJ incluses) d'une période contenant `date`, et de la période précédente. */
export function periodRange(period, date) {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Date invalide : ${date}`);
  let from;
  let to;
  let prevFrom;
  let prevTo;
  if (period === 'week') {
    from = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY);
    to = new Date(from.getTime() + 6 * DAY);
    prevFrom = new Date(from.getTime() - 7 * DAY);
    prevTo = new Date(from.getTime() - DAY);
  } else if (period === 'month') {
    from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12));
    to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12));
    prevFrom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1, 12));
    prevTo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0, 12));
  } else if (period === 'year') {
    from = new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 12));
    to = new Date(Date.UTC(d.getUTCFullYear(), 11, 31, 12));
    prevFrom = new Date(Date.UTC(d.getUTCFullYear() - 1, 0, 1, 12));
    prevTo = new Date(Date.UTC(d.getUTCFullYear() - 1, 11, 31, 12));
  } else {
    throw new Error(`Période inconnue : ${period}`);
  }
  return { period, from: iso(from), to: iso(to), previous: { from: iso(prevFrom), to: iso(prevTo) } };
}

const FILTERS = ['lang', 'country', 'device', 'channel'];

/** Clause WHERE sur an_visits (alias v) pour une période et des filtres. */
function visitWhere({ from, to }, filters = {}) {
  const where = ['v.day BETWEEN @from AND @to'];
  const params = { from, to };
  for (const f of FILTERS) {
    if (filters[f]) {
      where.push(`v.${f} = @f_${f}`);
      params[`f_${f}`] = filters[f];
    }
  }
  return { sql: where.join(' AND '), params };
}

export function summary(db, range, filters) {
  const w = visitWhere(range, filters);
  const row = db.prepare(`SELECT COUNT(*) AS visits, COALESCE(SUM(v.is_engaged), 0) AS engaged_visits, COALESCE(SUM(v.pages), 0) AS pageviews,
      COALESCE(SUM(v.searches), 0) AS searches, COALESCE(SUM(v.booking_clicks), 0) AS booking_clicks, COALESCE(SUM(v.contacts), 0) AS contacts,
      COALESCE(SUM(v.booking_clicks > 0), 0) AS converting_visits, COALESCE(AVG(v.engaged_ms), 0) AS avg_engaged_ms
    FROM an_visits v WHERE ${w.sql}`).get(w.params);
  const visitors = db.prepare(`SELECT COALESCE(SUM(n), 0) FROM (SELECT COUNT(DISTINCT v.visitor) AS n FROM an_visits v WHERE ${w.sql} GROUP BY v.day)`).pluck().get(w.params);
  const archived = archivedSummary(db, range, filters);
  const total = { visitors, ...row };
  if (archived) for (const k of Object.keys(archived)) total[k] = (total[k] || 0) + archived[k];
  return {
    ...total,
    avg_engaged_ms: Math.round(total.avg_engaged_ms),
    engaged_rate: rate(total.engaged_visits, total.visits),
    conversion_rate: rate(total.converting_visits, total.visits),
  };
}

const rate = (n, d) => (d ? Math.round((n / d) * 10000) / 100 : 0);

/** Jours dont les données brutes ont été purgées (plus de 13 mois) : agrégats quotidiens. */
function archivedSummary(db, { from, to }, filters = {}) {
  const firstRaw = db.prepare('SELECT MIN(day) FROM an_visits').pluck().get();
  const until = firstRaw && firstRaw <= to ? firstRaw : null;
  const active = FILTERS.filter((f) => filters[f]);
  if (active.length > 1) return null; // les agrégats ne croisent pas les filtres
  const dim = active.length ? `${active[0]}:${filters[active[0]]}` : '';
  const rows = db.prepare(`SELECT metric, SUM(value) AS v FROM an_daily WHERE dim = ? AND day BETWEEN ? AND ? ${until ? 'AND day < ?' : ''} GROUP BY metric`)
    .all(...[dim, from, to, ...(until ? [until] : [])]);
  if (!rows.length) return null;
  const m = Object.fromEntries(rows.map((r) => [r.metric, r.v]));
  return {
    visitors: m.visitors || 0, visits: m.visits || 0, engaged_visits: m.engaged_visits || 0, pageviews: m.pageviews || 0,
    searches: m.searches || 0, booking_clicks: m.booking_clicks || 0, contacts: m.contacts || 0, converting_visits: m.converting_visits || 0,
  };
}

/** Courbes : un point par jour (semaine, mois) ou par mois (année). */
export function timeseries(db, range, filters) {
  const w = visitWhere(range, filters);
  const byMonth = range.period === 'year';
  const bucket = byMonth ? 'substr(v.day, 1, 7)' : 'v.day';
  const rows = db.prepare(`SELECT ${bucket} AS bucket, COUNT(*) AS visits, COALESCE(SUM(v.booking_clicks), 0) AS booking_clicks,
      COALESCE(SUM(v.searches), 0) AS searches, COALESCE(SUM(v.booking_clicks > 0), 0) AS converting_visits
    FROM an_visits v WHERE ${w.sql} GROUP BY bucket`).all(w.params);
  const visitors = db.prepare(`SELECT ${byMonth ? 'substr(day, 1, 7)' : 'day'} AS bucket, SUM(n) AS visitors
    FROM (SELECT v.day, COUNT(DISTINCT v.visitor) AS n FROM an_visits v WHERE ${w.sql} GROUP BY v.day) GROUP BY bucket`).all(w.params);
  const byKey = new Map(rows.map((r) => [r.bucket, r]));
  const vis = new Map(visitors.map((r) => [r.bucket, r.visitors]));
  const keys = [];
  if (byMonth) {
    for (let m = 1; m <= 12; m += 1) keys.push(`${range.from.slice(0, 4)}-${String(m).padStart(2, '0')}`);
  } else {
    for (let t = Date.parse(`${range.from}T12:00:00Z`); t <= Date.parse(`${range.to}T12:00:00Z`); t += DAY) keys.push(iso(new Date(t)));
  }
  return keys.map((k) => ({ bucket: k, visitors: vis.get(k) || 0, visits: 0, booking_clicks: 0, searches: 0, converting_visits: 0, ...byKey.get(k) }));
}

const VISIT_DIMS = {
  channel: 'v.channel', referrer: 'v.referrer', utm_source: 'v.utm_source', utm_campaign: 'v.utm_campaign',
  entry: 'v.entry_path', exit: 'v.exit_path', country: 'v.country', region: 'v.region', lang: 'v.lang', browser_lang: 'v.browser_lang', device: 'v.device',
};

/** Classements. dim : canal, référent, campagne, page d'entrée, pays… ou page, source, element, chat, not_found, contact. */
export function top(db, dim, range, filters, limit = 20) {
  const w = visitWhere(range, filters);
  if (VISIT_DIMS[dim]) {
    return db.prepare(`SELECT COALESCE(${VISIT_DIMS[dim]}, '(aucun)') AS key, COUNT(*) AS visits, COALESCE(SUM(v.booking_clicks > 0), 0) AS converting_visits,
        COALESCE(SUM(v.booking_clicks), 0) AS booking_clicks, ROUND(AVG(v.engaged_ms)) AS avg_engaged_ms
      FROM an_visits v WHERE ${w.sql} GROUP BY key ORDER BY visits DESC LIMIT @limit`).all({ ...w.params, limit })
      .map((r) => ({ ...r, conversion_rate: rate(r.converting_visits, r.visits) }));
  }
  const events = (extra) => `FROM an_events e JOIN an_visits v ON v.visit = e.visit WHERE ${w.sql} ${extra}`;
  switch (dim) {
    case 'page':
      return db.prepare(`SELECT e.path AS key, SUM(e.type = 'pageview') AS views, COUNT(DISTINCT CASE WHEN e.type = 'pageview' THEN e.visit END) AS visits,
          ROUND(AVG(CASE WHEN e.type = 'engagement' THEN e.engaged_ms END)) AS avg_engaged_ms, ROUND(AVG(CASE WHEN e.type = 'engagement' THEN e.scroll_pct END)) AS avg_scroll_pct
        ${events("AND e.type IN ('pageview', 'engagement')")} GROUP BY e.path ORDER BY views DESC LIMIT @limit`).all({ ...w.params, limit });
    case 'source':
      return db.prepare(`SELECT COALESCE(e.source, '(inconnue)') AS key, COUNT(*) AS booking_clicks, COUNT(DISTINCT e.visit) AS visits
        ${events("AND e.type = 'booking_click'")} GROUP BY key ORDER BY booking_clicks DESC LIMIT @limit`).all({ ...w.params, limit });
    case 'element':
      return db.prepare(`SELECT key,
          SUM(type IN ('banner_view', 'popup_view')) AS views, SUM(type IN ('banner_click', 'popup_click')) AS clicks,
          SUM(type = 'booking_click') AS booking_clicks FROM (
            SELECT e.type, CASE WHEN e.type = 'booking_click' THEN COALESCE(e.via, e.source) ELSE e.source END AS key
            ${events("AND e.type IN ('banner_view', 'popup_view', 'banner_click', 'popup_click', 'booking_click')")}
          ) WHERE key LIKE 'banner:%' OR key LIKE 'popup:%' GROUP BY key ORDER BY views DESC LIMIT @limit`).all({ ...w.params, limit })
        .map((r) => ({ ...r, click_rate: rate(r.clicks, r.views), booking_rate: rate(r.booking_clicks, r.clicks || r.views) }));
    case 'chat':
      return db.prepare(`SELECT COALESCE(e.element_id, '(sans réponse)') AS key, COUNT(*) AS questions
        ${events("AND e.type = 'chat_question'")} GROUP BY key ORDER BY questions DESC LIMIT @limit`).all({ ...w.params, limit });
    case 'not_found':
      return db.prepare(`SELECT e.path AS key, COUNT(*) AS hits ${events("AND e.type = 'not_found'")} GROUP BY e.path ORDER BY hits DESC LIMIT @limit`).all({ ...w.params, limit });
    case 'contact':
      return db.prepare(`SELECT e.type || ' · ' || COALESCE(e.source, e.path) AS key, COUNT(*) AS contacts
        ${events("AND e.type IN ('phone_click', 'email_click', 'quote_submit')")} GROUP BY key ORDER BY contacts DESC LIMIT @limit`).all({ ...w.params, limit });
    default:
      throw new Error(`Classement inconnu : ${dim}`);
  }
}

/** Entonnoir : visite → fiche chambre / offre → recherche de dates → clic vers le moteur. */
export function funnel(db, range, filters) {
  const w = visitWhere(range, filters);
  const r = db.prepare(`SELECT COUNT(*) AS visits,
      COALESCE(SUM(EXISTS (SELECT 1 FROM an_events e WHERE e.visit = v.visit AND e.type = 'pageview'
        AND (e.template IN ('chambre', 'chambres', 'offres', 'appartements') OR e.path LIKE '%/chambres/%'))), 0) AS viewed_offer,
      COALESCE(SUM(v.searches > 0), 0) AS searched, COALESCE(SUM(v.booking_clicks > 0), 0) AS clicked
    FROM an_visits v WHERE ${w.sql}`).get(w.params);
  return [
    { step: 'visits', label: 'Visites', count: r.visits, rate: 100 },
    { step: 'viewed_offer', label: 'Fiche chambre ou offre vue', count: r.viewed_offer, rate: rate(r.viewed_offer, r.visits) },
    { step: 'searched', label: 'Recherche de dates', count: r.searched, rate: rate(r.searched, r.visits) },
    { step: 'clicked', label: 'Clic vers le moteur de réservation', count: r.clicked, rate: rate(r.clicked, r.visits) },
  ];
}

const bucketOf = (n, edges) => edges.find(([max]) => n <= max)?.[1] ?? edges[edges.length - 1][1];

/** Calendrier de la demande et profil des recherches (dates choisies dans le module). */
export function demand(db, range, filters) {
  const w = visitWhere(range, filters);
  const rows = db.prepare(`SELECT e.arrival, e.nights, e.adults, e.children, e.lead_days, e.room_type, e.offer_id
    FROM an_events e JOIN an_visits v ON v.visit = e.visit WHERE ${w.sql} AND e.type = 'booking_search' AND e.arrival IS NOT NULL`).all(w.params);
  const count = (fn) => {
    const m = new Map();
    for (const r of rows) {
      const k = fn(r);
      if (k !== null && k !== undefined) m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m].map(([key, searches]) => ({ key, searches }));
  };
  // Semaine ISO : celle qui contient le jeudi ; la semaine 1 contient le 4 janvier
  const isoWeek = (date) => {
    const d = new Date(`${date}T12:00:00Z`);
    const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * DAY);
    const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4, 12));
    const week1Thursday = new Date(jan4.getTime() + (3 - ((jan4.getUTCDay() + 6) % 7)) * DAY);
    const week = 1 + Math.round((thursday - week1Thursday) / (7 * DAY));
    return `${thursday.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
  };
  const LEAD = [[0, "le jour même"], [7, '1 à 7 jours'], [30, '8 à 30 jours'], [90, '31 à 90 jours'], [Infinity, 'plus de 90 jours']];
  return {
    searches: rows.length,
    arrivals_by_week: count((r) => isoWeek(r.arrival)).sort((a, b) => a.key.localeCompare(b.key)),
    lead_time: LEAD.map(([, label]) => ({ key: label, searches: rows.filter((r) => bucketOf(r.lead_days ?? 0, LEAD) === label).length })),
    nights: count((r) => r.nights).sort((a, b) => a.key - b.key),
    party: count((r) => `${r.adults ?? '?'} adulte(s)${r.children ? ` + ${r.children} enfant(s)` : ''}`).sort((a, b) => b.searches - a.searches),
    room_types: count((r) => r.room_type || null).sort((a, b) => b.searches - a.searches),
    offers: count((r) => r.offer_id || null).sort((a, b) => b.searches - a.searches),
  };
}

const THRESHOLDS = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], TTFB: [800, 1800], FCP: [1800, 3000] };
const p75 = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(0.75 * s.length) - 1)] : null;
};

/** Core Web Vitals mesurés chez les visiteurs : 75e centile par mesure, type de page et appareil. */
export function vitals(db, range, filters) {
  const w = visitWhere(range, filters);
  const rows = db.prepare(`SELECT e.metric, e.value, COALESCE(e.template, '(autre)') AS template, v.device
    FROM an_events e JOIN an_visits v ON v.visit = e.visit WHERE ${w.sql} AND e.type = 'web_vital' AND e.value IS NOT NULL`).all(w.params);
  const groups = new Map();
  for (const r of rows) {
    for (const key of [`${r.metric}|*|*`, `${r.metric}|${r.template}|${r.device}`]) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r.value);
    }
  }
  return [...groups].map(([key, values]) => {
    const [metric, template, device] = key.split('|');
    const value = p75(values);
    const [good, poor] = THRESHOLDS[metric] || [Infinity, Infinity];
    return { metric, template, device, samples: values.length, p75: metric === 'CLS' ? Math.round(value * 1000) / 1000 : Math.round(value),
      rating: value <= good ? 'bon' : value <= poor ? 'à améliorer' : 'mauvais' };
  }).sort((a, b) => a.metric.localeCompare(b.metric) || b.samples - a.samples);
}

/** Tableau → CSV (séparateur « ; » pour Excel en français). */
export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => (v === null || v === undefined ? '' : /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return `﻿${[cols.join(';'), ...rows.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\r\n')}\r\n`;
}
