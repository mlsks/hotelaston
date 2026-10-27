/**
 * Statistiques (niveau 1, sans cookie) : semaine, mois ou année comparés à la période précédente,
 * filtres croisés (langue, pays, appareil, canal), acquisition, audience, comportement,
 * réservation (entonnoir, calendrier de la demande), bandeaux et popup, Core Web Vitals.
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, qs } from '../lib/api.js';
import { todayParis, fmtNumber, fmtDuration } from '../lib/format.js';

export const CHANNELS = {
  direct: 'Accès direct', organic: 'Recherche naturelle', paid: 'Publicité', social: 'Réseaux sociaux', email: 'E-mail',
  metasearch: 'Comparateurs', ai: 'Assistants IA', referral: 'Sites référents',
};
const DEVICES = { desktop: 'Ordinateur', mobile: 'Mobile', tablet: 'Tablette' };
const CONTACTS = { phone_click: 'Appel', email_click: 'E-mail', quote_submit: 'Demande de devis' };
const VITALS = {
  LCP: ['Affichage du contenu principal', 'ms'], INP: ['Réactivité aux clics', 'ms'], CLS: ['Stabilité de la mise en page', ''],
  TTFB: ['Réponse du serveur', 'ms'], FCP: ['Premier affichage', 'ms'],
};
const DIMS = ['channel', 'referrer', 'utm_campaign', 'entry', 'country', 'region', 'browser_lang', 'lang', 'device', 'page', 'source', 'element', 'chat', 'not_found', 'contact'];

let chartLib = null;
function loadChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  chartLib ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/admin/vendor/chart.js';
    s.onload = () => resolve(window.Chart);
    s.onerror = () => reject(new Error('Graphiques indisponibles.'));
    document.head.append(s);
  });
  return chartLib;
}

/** Source d'un clic vers le moteur, en clair. */
export function sourceLabel(key) {
  const [kind, id = ''] = String(key).split(':');
  return {
    cta_header: 'Bouton « Réserver » de l’en-tête', cta_hero: 'Module de réservation de l’accueil', bottom_bar: 'Barre du bas (mobile)', menu: 'Menu mobile', chat: 'Chat',
    room: `Fiche chambre ${id}`, room_card: `Carte chambre ${id}`, offer: `Offre ${id}`, banner: `Bandeau n° ${id}`, popup: `Popup n° ${id}`, page: `Page ${id || 'd’accueil'}`,
  }[kind] || key;
}

Alpine.data('statsView', () => ({
  CHANNELS,
  DEVICES,
  VITALS,
  period: 'month',
  date: todayParis(),
  filters: { lang: '', country: '', device: '', channel: '' },
  summary: null,
  series: [],
  top: {},
  funnel: [],
  demand: null,
  vitals: [],
  loading: false,
  charts: {},
  async init() {
    await this.load();
  },
  get params() { return { period: this.period, date: this.date, ...this.filters }; },
  async load() {
    this.loading = true;
    const p = this.params;
    try {
      const [summary, series, funnel, demand, vitals, ...tops] = await Promise.all([
        get(`/analytics/summary${qs(p)}`), get(`/analytics/timeseries${qs(p)}`), get(`/analytics/funnel${qs(p)}`),
        get(`/analytics/demand${qs(p)}`), get(`/analytics/vitals${qs(p)}`),
        ...DIMS.map((dim) => get(`/analytics/top${qs({ ...p, dim, limit: 15 })}`)),
      ]);
      this.summary = summary;
      this.series = series.points;
      this.funnel = funnel.steps;
      this.demand = demand;
      this.vitals = vitals.rows;
      this.top = Object.fromEntries(DIMS.map((d, i) => [d, tops[i].rows]));
      this.$nextTick(() => this.draw());
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.loading = false;
    }
  },
  setPeriod(p) {
    this.period = p;
    this.load();
  },
  shift(dir) {
    const d = new Date(`${this.date}T12:00:00Z`);
    if (this.period === 'week') d.setUTCDate(d.getUTCDate() + 7 * dir);
    if (this.period === 'month') d.setUTCMonth(d.getUTCMonth() + dir, 1);
    if (this.period === 'year') d.setUTCFullYear(d.getUTCFullYear() + dir);
    this.date = d.toISOString().slice(0, 10);
    this.load();
  },
  setFilter(name, value) {
    this.filters[name] = this.filters[name] === value ? '' : value;
    this.load();
  },
  get hasFilters() { return Object.values(this.filters).some(Boolean); },
  clearFilters() {
    this.filters = { lang: '', country: '', device: '', channel: '' };
    this.load();
  },
  get rangeLabel() {
    const r = this.summary?.range;
    if (!r) return '';
    const f = (d, o) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...o }).format(new Date(`${d}T12:00:00Z`));
    if (r.period === 'year') return f(r.from, { year: 'numeric' });
    if (r.period === 'month') return f(r.from, { month: 'long', year: 'numeric' });
    return `du ${f(r.from, { day: 'numeric', month: 'short' })} au ${f(r.to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  },
  get isCurrent() { return this.summary && this.summary.range.to >= todayParis(); },
  kpis() {
    const c = this.summary?.current || {};
    return [
      ['visitors', 'Visiteurs', fmtNumber(c.visitors)],
      ['visits', 'Visites', fmtNumber(c.visits)],
      ['engaged_rate', 'Visites engagées', `${fmtNumber(c.engaged_rate)} %`, 'Plus de 10 secondes, 2 pages ou une action'],
      ['pageviews', 'Pages vues', fmtNumber(c.pageviews)],
      ['searches', 'Recherches de dates', fmtNumber(c.searches)],
      ['booking_clicks', 'Clics vers le moteur', fmtNumber(c.booking_clicks)],
      ['conversion_rate', 'Taux de conversion', `${fmtNumber(c.conversion_rate)} %`, 'Visites avec au moins un clic vers le moteur de réservation'],
      ['contacts', 'Contacts', fmtNumber(c.contacts), 'Appels, e-mails et demandes de devis'],
    ];
  },
  delta(key) {
    const cur = this.summary?.current?.[key] ?? 0;
    const prev = this.summary?.previous?.[key] ?? 0;
    if (!prev) return null;
    if (key.endsWith('_rate')) return Math.round((cur - prev) * 10) / 10;
    return Math.round(((cur - prev) / prev) * 100);
  },
  deltaText(key) {
    const d = this.delta(key);
    if (d === null) return '';
    return `${d > 0 ? '+' : ''}${fmtNumber(d)}${key.endsWith('_rate') ? ' pt' : ' %'}`;
  },
  channel: (k) => CHANNELS[k] || k,
  device: (k) => DEVICES[k] || k,
  source: sourceLabel,
  contact(key) {
    const [type, where] = String(key).split(' · ');
    return `${CONTACTS[type] || type}${where ? ` · ${sourceLabel(where).replace(/^Page /, 'page ')}` : ''}`;
  },
  duration: fmtDuration,
  share(rows, key, row) {
    const max = Math.max(...rows.map((r) => r[key] || 0), 1);
    return `${Math.round(((row[key] || 0) / max) * 100)}%`;
  },
  exportUrl(report, dim = null) { return `/api/analytics/export.csv${qs({ ...this.params, report, dim, limit: 200 })}`; },
  vitalLabel(m) { return VITALS[m]?.[0] || m; },
  vitalValue(r) { return r.metric === 'CLS' ? String(r.p75).replace('.', ',') : `${fmtNumber(r.p75)} ms`; },
  get vitalsOverall() { return this.vitals.filter((r) => r.template === '*'); },
  get vitalsDetail() { return this.vitals.filter((r) => r.template !== '*').slice(0, 30); },
  async draw() {
    let Chart;
    try { Chart = await loadChart(); } catch { return; }
    const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const navy = css('--color-azure-800') || '#14385c';
    const gold = css('--color-gold') || '#c9a45e';
    const sky = css('--color-azure-500') || '#2e6a9a';
    const make = (id, config) => {
      const el = this.$refs[id];
      if (!el) return;
      this.charts[id]?.destroy();
      this.charts[id] = new Chart(el, config);
    };
    const labels = this.series.map((p) => {
      const d = p.bucket.length === 7 ? `${p.bucket}-15` : p.bucket;
      const o = p.bucket.length === 7 ? { month: 'short' } : { day: 'numeric', month: 'short' };
      return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...o }).format(new Date(`${d}T12:00:00Z`));
    });
    const base = {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(15,42,69,.06)' } } },
    };
    make('timeline', {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Visiteurs', data: this.series.map((p) => p.visitors), borderColor: navy, backgroundColor: `${navy}22`, fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: 'Visites', data: this.series.map((p) => p.visits), borderColor: sky, tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [4, 3] },
          { label: 'Clics vers le moteur', data: this.series.map((p) => p.booking_clicks), borderColor: gold, backgroundColor: gold, tension: 0.3, pointRadius: 2, borderWidth: 2 },
        ],
      },
      options: base,
    });
    const weeks = this.demand?.arrivals_by_week || [];
    make('arrivals', {
      type: 'bar',
      data: { labels: weeks.map((w) => w.key.replace(/^\d{4}-S/, 'S')), datasets: [{ label: 'Recherches', data: weeks.map((w) => w.searches), backgroundColor: navy, borderRadius: 3 }] },
      options: { ...base, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => `Arrivée semaine ${weeks[items[0].dataIndex].key}` } } } },
    });
  },
  destroy() {
    for (const c of Object.values(this.charts)) c.destroy();
  },
}));
