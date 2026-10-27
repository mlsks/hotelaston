/**
 * Accueil : état du site (version en ligne, prévisualisation), traductions, SEO, statistiques
 * de la semaine ; pour l'éditeur Live Music, les prochains concerts.
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, qs } from '../lib/api.js';
import { todayParis } from '../lib/format.js';

Alpine.data('homeView', () => ({
  loading: true,
  builds: null,
  translations: null,
  seo: null,
  stats: null,
  gigs: [],
  async init() {
    const s = this.$store.session;
    const tasks = [get('/builds?limit=10').then((b) => { this.builds = b; })];
    if (!s.isScoped) {
      tasks.push(get('/translations/status').then((t) => { this.translations = t; }));
      tasks.push(get('/seo/report').then((r) => { this.seo = r; }));
    }
    if (s.canStats) tasks.push(get(`/analytics/summary${qs({ period: 'week', date: todayParis() })}`).then((r) => { this.stats = r; }));
    if (s.isScoped && s.user.scopes.includes('live-music')) {
      tasks.push(get('/collections/gigs/items').then((items) => {
        const today = todayParis();
        this.gigs = items.map((it) => ({ ...it.merged, id: it.id, is_active: it.is_active }))
          .filter((g) => g.date >= today).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 6);
      }));
    }
    await Promise.allSettled(tasks);
    this.loading = false;
  },
  get lastPreview() { return this.builds?.items.find((b) => b.kind === 'preview' && b.status !== 'failed') || null; },
  get greeting() {
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    return h < 18 ? 'Bonjour' : 'Bonsoir';
  },
  delta(key) {
    const cur = this.stats?.current?.[key] ?? 0;
    const prev = this.stats?.previous?.[key] ?? 0;
    if (!prev) return null;
    return Math.round(((cur - prev) / prev) * 100);
  },
  venue(v) {
    return { 'selon-meteo': 'Selon la météo', 'moon-bar': 'Moon Bar', 'aston-club': "L'Aston Club" }[v] || v || '';
  },
}));
