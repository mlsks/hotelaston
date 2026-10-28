/**
 * Administration : utilisateurs, réglages du site, redirections, journal des modifications, compte personnel.
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, post, patch, del, qs } from '../lib/api.js';
import { randomPassword } from '../lib/format.js';
import { pageLabel } from './pages.js';

const SCOPES = [['live-music', 'Live Music (page, programme, bandeaux et médias Live Music)']];

/* ---------- Utilisateurs ---------- */
Alpine.data('usersView', () => ({
  SCOPES,
  users: [],
  creating: false,
  editing: null,
  draft: { email: '', name: '', role: 'editor', langs: [], scopes: [] },
  async init() { await this.load(); },
  async load() {
    try { this.users = await get('/users'); } catch (err) { this.$store.toast.error(err); }
  },
  roleLabel(u) { return this.$store.session.roleLabel(u); },
  toggleIn(list, v) { return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]; },
  async create() {
    try {
      const d = this.draft;
      const res = await post('/users', { email: d.email.trim(), name: d.name.trim(), role: d.role, langs: d.role === 'translator' ? d.langs : [], scopes: d.role === 'editor' ? d.scopes : [] });
      this.creating = false;
      this.draft = { email: '', name: '', role: 'editor', langs: [], scopes: [] };
      await this.load();
      await this.$store.dialog.showSecret({
        title: `Compte créé pour ${res.user.name}`,
        body: 'Transmettez ce mot de passe de façon sûre (de vive voix, SMS…). Il ne sera plus affiché. La personne pourra le changer dans « Mon compte ».',
        secret: res.password,
      });
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  edit(u) {
    this.editing = { id: u.id, name: u.name, role: u.role, langs: [...u.langs], scopes: [...u.scopes], is_active: u.is_active };
  },
  async saveEdit() {
    const e = this.editing;
    try {
      await patch(`/users/${e.id}`, { name: e.name, role: e.role, langs: e.role === 'translator' ? e.langs : [], scopes: e.role === 'editor' ? e.scopes : [], is_active: e.is_active });
      this.editing = null;
      this.$store.toast.push('Compte enregistré.');
      await this.load();
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  async resetPassword(u) {
    const ok = await this.$store.dialog.confirm({ title: `Nouveau mot de passe pour ${u.name} ?`, body: 'L’ancien ne fonctionnera plus et ses sessions ouvertes seront fermées.', confirmLabel: 'Générer' });
    if (!ok) return;
    const password = randomPassword();
    try {
      await patch(`/users/${u.id}`, { password });
      await this.$store.dialog.showSecret({ title: 'Nouveau mot de passe', body: 'À transmettre de façon sûre : il ne sera plus affiché.', secret: password });
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  async remove(u) {
    const ok = await this.$store.dialog.confirm({ title: `Supprimer le compte de ${u.name} ?`, body: 'Un compte qui a déjà fait des modifications est désactivé (le journal garde son nom) ; sinon il est supprimé.', confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    try {
      const res = await del(`/users/${u.id}`);
      this.$store.toast.push(res.deactivated ? 'Compte désactivé.' : 'Compte supprimé.');
      await this.load();
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
}));

/* ---------- Réglages ---------- */
/* Valeurs par défaut du site (templates-src/assets/remotion-vanilla.js, BOOKING_DEFAULTS) */
const BOOKING_PARAMS = {
  checkin: 'arrivalDate', checkout: 'departureDate', nights: '', adults: 'selectedAdultCount', children: 'selectedChildCount', guests: '', roomType: '', offerId: '',
};
const BOOKING_ROOMS = { confort: 'confort', privilege: 'privilege', premium: 'premium', exclusive: 'exclusive', deluxe: 'deluxe', suites: 'suites' };
const BOOKING_OFFERS = { 'escapade-gourmande': 'escapade-gourmande', 'nouvel-an': 'nouvel-an', carnaval: 'carnaval' };
const codesToText = (map) => Object.entries(map).map(([k, v]) => `${k} = ${v}`).join('\n');
const textToCodes = (text) => Object.fromEntries(text.split('\n')
  .map((line) => line.split('=').map((x) => x.trim()))
  .filter(([k, v]) => k && v));

Alpine.data('settingsView', () => ({
  settings: null,
  form: null,
  jsonld: {},
  jsonErrors: {},
  saving: false,
  async init() {
    try {
      this.settings = await get('/settings');
    } catch (err) {
      this.$store.toast.error(err);
      return;
    }
    const s = this.settings;
    this.form = {
      og_site_name: s.og_site_name || '', og_image_default: s.og_image_default || '', x_default_lang: s.x_default_lang || 'en', cdn_base: s.cdn_base || '',
      booking_base: s.booking_engine?.base || '', booking_prefix: s.booking_engine?.prefix || '',
      booking_params: Object.fromEntries(Object.entries(BOOKING_PARAMS).map(([k, v]) => [k, s.booking_engine?.params ? s.booking_engine.params[k] || '' : v])),
      booking_rooms: codesToText(s.booking_engine?.rooms || BOOKING_ROOMS),
      booking_offers: codesToText(s.booking_engine?.offers || BOOKING_OFFERS),
      reviews_source: s.reviews_meta?.source || 'demo', google_rating: s.reviews_meta?.google?.rating ?? '', google_url: s.reviews_meta?.google?.url || '',
      home_threshold: s.reviews_meta?.homeRatingThreshold ?? 4,
    };
    this.jsonld = Object.fromEntries(Object.entries(s.jsonld_graph || {}).map(([k, v]) => [k, JSON.stringify(v, null, 2)]));
  },
  checkJson(lang) {
    try {
      JSON.parse(this.jsonld[lang]);
      delete this.jsonErrors[lang];
    } catch (err) {
      this.jsonErrors[lang] = `JSON invalide : ${err.message}`;
    }
  },
  async save() {
    if (Object.keys(this.jsonErrors).length) {
      this.$store.toast.push('Corrigez le JSON des données structurées avant d’enregistrer.', 'error');
      return;
    }
    const f = this.form;
    if (!/\{(lang|locale)\}/.test(f.booking_base)) {
      this.$store.toast.push('L’adresse du moteur doit contenir {locale} (fr-FR) ou {lang} (fr), remplacé par la langue de la page.', 'error');
      return;
    }
    this.saving = true;
    try {
      await patch('/settings', {
        og_site_name: f.og_site_name, og_image_default: f.og_image_default, x_default_lang: f.x_default_lang, cdn_base: f.cdn_base,
        booking_engine: {
          ...this.settings.booking_engine, base: f.booking_base, prefix: f.booking_prefix,
          // Nom vide : paramètre non envoyé au moteur
          params: Object.fromEntries(Object.entries(f.booking_params).map(([k, v]) => [k, v.trim() || null])),
          rooms: textToCodes(f.booking_rooms),
          offers: textToCodes(f.booking_offers),
        },
        reviews_meta: {
          ...this.settings.reviews_meta, source: f.reviews_source, homeRatingThreshold: Number(f.home_threshold),
          google: { ...this.settings.reviews_meta?.google, rating: f.google_rating === '' ? null : Number(f.google_rating), url: f.google_url },
        },
        jsonld_graph: Object.fromEntries(Object.entries(this.jsonld).map(([k, v]) => [k, JSON.parse(v)])),
      });
      this.$store.ui.dirty = false;
      this.$store.toast.push('Réglages enregistrés : ils s’appliquent à la prochaine publication.');
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.saving = false;
    }
  },
  async mediaGc() {
    try {
      const res = await post('/maintenance/media-gc');
      this.$store.toast.push(`${res.deleted} média(s) effacé(s) définitivement.`);
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
}));

/* ---------- Redirections ---------- */
Alpine.data('redirectsView', () => ({
  redirects: [],
  pages: [],
  draft: { from_path: '', kind: 'page', to_page: '', to_lang: '', to_url: '', code: 301 },
  q: '',
  async init() {
    try {
      [this.redirects, this.pages] = await Promise.all([get('/redirects'), get('/pages')]);
      this.draft.to_lang = this.$store.session.defaultLang;
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  target(r) {
    if (r.to_url) return r.to_url;
    const p = this.pages.find((x) => x.id === r.to_page);
    const lang = r.to_lang || this.$store.session.defaultLang;
    return p ? `${pageLabel(p, this.$store.session.defaultLang)} (${lang.toUpperCase()}) · ${p.i18n[lang]?.path || ''}` : `page ${r.to_page}`;
  },
  get filtered() {
    const q = this.q.toLowerCase();
    return q ? this.redirects.filter((r) => `${r.from_path} ${this.target(r)}`.toLowerCase().includes(q)) : this.redirects;
  },
  pageName(p) { return pageLabel(p, this.$store.session.defaultLang); },
  async add() {
    const d = this.draft;
    const from = d.from_path.trim().replace(/^https?:\/\/[^/]+/, '');
    try {
      await post('/redirects', {
        from_path: from.startsWith('/') ? from : `/${from}`, code: Number(d.code),
        ...(d.kind === 'page' ? { to_page: Number(d.to_page), to_lang: d.to_lang || null } : { to_url: d.to_url.trim() }),
      });
      this.draft = { ...this.draft, from_path: '', to_url: '' };
      this.redirects = await get('/redirects');
      this.$store.toast.push('Redirection ajoutée.');
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  async remove(r) {
    const ok = await this.$store.dialog.confirm({ title: `Supprimer la redirection de ${r.from_path} ?`, body: 'Les liens et favoris vers cette ancienne adresse mèneront à une page introuvable.', confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    try {
      await del(`/redirects/${r.id}`);
      this.redirects = this.redirects.filter((x) => x.id !== r.id);
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
}));

/* ---------- Journal ---------- */
const ACTIONS = { create: 'Création', update: 'Modification', delete: 'Suppression', deactivate: 'Désactivation', publish: 'Publication', rollback: 'Restauration', login: 'Connexion', password: 'Mot de passe', reuse: 'Doublon réutilisé' };
const ENTITIES = { entry: 'Texte', page: 'Page', page_i18n: 'Page (SEO)', item: 'Fiche', item_i18n: 'Fiche (traduction)', item_media: 'Médias d’une fiche', media: 'Média', media_i18n: 'Média (textes)', banner: 'Bandeau', banner_i18n: 'Bandeau (texte)', banner_placements: 'Bandeau (emplacements)', popup: 'Popup', popup_i18n: 'Popup (texte)', popup_pages: 'Popup (pages)', user: 'Utilisateur', settings: 'Réglages', redirect: 'Redirection', language: 'Langue', build: 'Version du site' };

Alpine.data('auditView', () => ({
  rows: [],
  q: '',
  open: null,
  async init() {
    try { this.rows = await get(`/audit${qs({ limit: 500 })}`); } catch (err) { this.$store.toast.error(err); }
  },
  action(r) { return ACTIONS[r.action] || r.action; },
  entity(r) { return ENTITIES[r.entity] || r.entity; },
  get filtered() {
    const q = this.q.toLowerCase();
    return q ? this.rows.filter((r) => `${r.email} ${this.action(r)} ${this.entity(r)} ${r.entity_id} ${r.lang || ''}`.toLowerCase().includes(q)) : this.rows;
  },
  pretty(json) {
    if (!json) return '—';
    try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
  },
}));

/* ---------- Mon compte ---------- */
Alpine.data('accountView', () => ({
  current: '',
  next: '',
  confirm: '',
  saving: false,
  noStats: false,
  init() { this.noStats = this.$store.ui.noStats; },
  setNoStats(on) {
    this.$store.ui.noStats = on;
    this.noStats = this.$store.ui.noStats;
    this.$store.toast.push(on ? 'Vos visites sur le site ne seront plus comptées depuis ce navigateur.' : 'Vos visites sont de nouveau comptées.');
  },
  async changePassword() {
    if (this.next !== this.confirm) {
      this.$store.toast.push('Les deux mots de passe ne sont pas identiques.', 'error');
      return;
    }
    this.saving = true;
    try {
      await post('/auth/password', { current: this.current, next: this.next });
      this.current = '';
      this.next = '';
      this.confirm = '';
      this.$store.toast.push('Mot de passe changé.');
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.saving = false;
    }
  },
}));
