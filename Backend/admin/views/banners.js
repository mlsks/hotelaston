/**
 * Bandeaux : texte par langue, apparence, lien, programmation et emplacements (zone × pages).
 * Un compte limité (Live Music) ne voit que ses bandeaux et ne les place que sur ses pages.
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, post, patch, put, del } from '../lib/api.js';
import { setTitle, go } from '../lib/router.js';
import { toParisInput, scheduleState } from '../lib/format.js';
import { pageLabel } from './pages.js';

export const VARIANTS = [
  ['info', 'Information', '#14385c', '#ffffff'],
  ['promo', 'Offre', '#c9a45e', '#0b1f34'],
  ['evenement', 'Événement', '#0f2a45', '#f3ede1'],
  ['alerte', 'Alerte', '#8f2f1d', '#ffffff'],
];

/** Cibles possibles d'un appel à l'action : pages, fiches (chambres, services), réservation. */
export async function loadTargets(session) {
  const out = { pages: [], items: [], rooms: [] };
  out.pages = (await get('/pages')).map((p) => ({ value: `page:${p.key}`, label: pageLabel(p, session.defaultLang) }));
  if (!session.isScoped) {
    const [rooms, services, offers] = await Promise.all([get('/collections/rooms/items'), get('/collections/services/items'), get('/collections/offers/items')]);
    // Moteur de réservation : une chambre ou une offre présélectionnée
    out.rooms = [...rooms.map((r) => ({ value: `room:${r.key}`, label: r.merged.name || r.key })),
      ...offers.filter((o) => o.merged.action === 'booking').map((o) => ({ value: `offer:${o.key}`, label: `Offre · ${o.merged.title || o.key}` }))];
    out.items = [...rooms.map((r) => ({ value: `item:rooms/${r.key}`, label: `Chambre · ${r.merged.name || r.key}` })),
      ...services.map((s) => ({ value: `item:services/${s.key}`, label: `Service · ${s.merged.name || s.key}` }))];
  }
  return out;
}

export const CTA_KINDS = [['none', 'Pas de bouton'], ['page', 'Une page du site'], ['item', 'Une fiche (chambre, service)'], ['booking', 'Le moteur de réservation'], ['url', 'Une adresse externe']];

Alpine.data('bannersView', () => ({
  banners: [],
  loading: true,
  async init() {
    try { this.banners = await get('/banners'); } catch (err) { this.$store.toast.error(err); }
    this.loading = false;
  },
  schedule: scheduleState,
  text(b) { return b.i18n[this.$store.session.defaultLang]?.text || ''; },
  where(b) {
    if (!b.placements.length) return 'Placé nulle part';
    const zones = [...new Set(b.placements.map((p) => p.zone))];
    const all = b.placements.some((p) => !p.page_id);
    return `${zones.join(', ')} · ${all ? 'toutes les pages' : `${new Set(b.placements.map((p) => p.page_id)).size} page(s)`}`;
  },
}));

Alpine.data('bannerView', () => ({
  VARIANTS,
  banner: null,
  isNew: false,
  zones: [],
  pages: [],
  targets: { pages: [], items: [], rooms: [] },
  form: null,
  texts: {},
  placements: {},
  foreign: 0,
  saving: false,
  async init() {
    const id = this.$store.route.params.id;
    this.isNew = id === 'nouveau';
    if (this.$store.route.query.lang) this.$store.ui.setLang(this.$store.route.query.lang);
    try {
      const [zones, pages, targets] = await Promise.all([get('/zones'), get('/pages'), loadTargets(this.$store.session)]);
      this.zones = zones;
      this.pages = pages;
      this.targets = targets;
      if (!this.isNew) this.banner = await get(`/banners/${id}`);
      this.$store.icons.load();
    } catch (err) {
      this.$store.toast.error(err);
      return;
    }
    this.reset();
  },
  reset() {
    const b = this.banner || { name: '', variant: 'info', bg_color: null, text_color: null, icon: null, cta_kind: 'none', cta_target: null, dismissible: 1, priority: 0, is_active: 1, start_at: null, end_at: null, placements: [], i18n: {} };
    this.form = {
      name: b.name, variant: b.variant, bg_color: b.bg_color || '', text_color: b.text_color || '', icon: b.icon || '',
      cta_kind: b.cta_kind || 'none', cta_target: b.cta_target || '', dismissible: Boolean(b.dismissible), priority: b.priority || 0,
      is_active: Boolean(b.is_active), start_at: toParisInput(b.start_at), end_at: toParisInput(b.end_at),
    };
    this.texts = Object.fromEntries(this.$store.session.languages.map((l) => [l.code, {
      text: b.i18n[l.code]?.text || '', cta_label: b.i18n[l.code]?.cta_label || '', cta_url: b.i18n[l.code]?.cta_url || '', status: b.i18n[l.code]?.status, state: b.i18n[l.code]?.state || 'missing',
    }]));
    // Compte limité : seules ses pages sont modifiables ; le serveur conserve les autres emplacements
    const own = new Set(this.pages.map((p) => p.id));
    const mine = this.scoped ? b.placements.filter((p) => own.has(p.page_id)) : b.placements;
    this.foreign = this.scoped ? b.placements.length - mine.length : 0;
    this.placements = Object.fromEntries(this.zones.map((z) => {
      const rows = mine.filter((p) => p.zone === z.key);
      const mode = !rows.length ? 'none' : rows.some((p) => !p.page_id) ? 'all' : 'pages';
      return [z.key, { mode, pages: rows.filter((p) => p.page_id).map((p) => p.page_id) }];
    }));
    setTitle(this.isNew ? 'Nouveau bandeau' : `Bandeau · ${b.name}`);
    this.$store.ui.dirty = false;
  },
  get lang() { return this.$store.ui.lang; },
  get def() { return this.$store.session.defaultLang; },
  get canEdit() { return this.$store.session.canContent; },
  get canText() { return this.$store.session.canTranslate(this.lang); },
  get scoped() { return this.$store.session.isScoped; },
  get colors() {
    const v = VARIANTS.find((x) => x[0] === this.form.variant) || VARIANTS[0];
    return { bg: this.form.bg_color || v[2], fg: this.form.text_color || v[3] };
  },
  get state() { return scheduleState({ ...this.form, start_at: this.form.start_at ? new Date(this.form.start_at).toISOString() : null, end_at: this.form.end_at ? new Date(this.form.end_at).toISOString() : null }); },
  get ctaChoices() {
    const k = this.form.cta_kind;
    if (k === 'page') return this.targets.pages;
    if (k === 'item') return this.targets.items;
    if (k === 'booking') return [{ value: '', label: 'Le moteur, sans présélection' }, ...this.targets.rooms];
    return [];
  },
  get kinds() { return this.scoped ? CTA_KINDS.filter((k) => ['none', 'page'].includes(k[0])) : CTA_KINDS; },
  togglePage(zone, id) {
    const p = this.placements[zone];
    p.pages = p.pages.includes(id) ? p.pages.filter((x) => x !== id) : [...p.pages, id];
    this.$store.ui.dirty = true;
  },
  pageName(p) { return pageLabel(p, this.def); },
  async save() {
    this.saving = true;
    try {
      const f = this.form;
      let id = this.banner?.id;
      if (this.canEdit) {
        const body = {
          name: f.name.trim(), variant: f.variant, bg_color: f.bg_color || null, text_color: f.text_color || null, icon: f.icon || null,
          cta_kind: f.cta_kind, cta_target: f.cta_kind === 'none' ? null : f.cta_target || (f.cta_kind === 'booking' ? '' : null),
          dismissible: f.dismissible, priority: Number(f.priority) || 0, is_active: f.is_active, start_at: f.start_at || null, end_at: f.end_at || null,
        };
        this.banner = id ? await patch(`/banners/${id}`, body) : await post('/banners', body);
        id = this.banner.id;
        const rows = [];
        for (const [zone, p] of Object.entries(this.placements)) {
          if (p.mode === 'all') rows.push({ zone, page_id: null });
          if (p.mode === 'pages') for (const pid of p.pages) rows.push({ zone, page_id: pid });
        }
        this.banner = await put(`/banners/${id}/placements`, rows);
      }
      const t = this.texts[this.lang];
      if (this.canText && t.text.trim()) {
        this.banner = await put(`/banners/${id}/i18n/${this.lang}`, { text: t.text, cta_label: t.cta_label || null, cta_url: t.cta_url || null, ...(this.lang !== this.def ? { status: 'ready' } : {}) });
      }
      this.$store.ui.dirty = false;
      this.$store.toast.push('Bandeau enregistré.');
      if (this.isNew) go(`#/bandeaux/${id}`);
      else this.reset();
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.saving = false;
    }
  },
  async remove() {
    const ok = await this.$store.dialog.confirm({ title: `Supprimer le bandeau « ${this.banner.name} » ?`, body: 'Il disparaîtra du site à la prochaine publication.', confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    try {
      await del(`/banners/${this.banner.id}`);
      this.$store.ui.dirty = false;
      go('#/bandeaux');
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
}));
