/**
 * Textes du site (data-cms-*) : édition dans la langue de travail, texte d'origine en regard
 * pour les traductions, enregistrement de chaque texte dès qu'on quitte le champ.
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, put, qs } from '../lib/api.js';
import { setTitle } from '../lib/router.js';

/** Textes communs : d'où ils viennent (layout ou gabarit de fiche). */
const PREFIX = { global: 'Toutes les pages', 'item-chambre': 'Fiches chambre', 'item-service': 'Fiches service' };

Alpine.data('entriesEditor', (source, opts = {}) => ({
  entries: [],
  loading: true,
  q: opts.q || '',
  onlyTodo: false,
  asDraft: false,
  openCount: 3,
  async init() {
    try {
      this.entries = await get(`/entries${qs(source)}`);
    } catch (err) {
      this.$store.toast.error(err);
    }
    this.prepare();
    this.loading = false;
    this.$watch('$store.ui.lang', () => this.prepare());
    // Arrivé depuis la liste des traductions : ouvrir et montrer le texte demandé
    const target = Number(this.$store.route.query.entry);
    if (target) {
      this.openCount = 999;
      this.$nextTick(() => {
        const el = document.getElementById(`entry-${target}`);
        el?.scrollIntoView({ block: 'center' });
        el?.classList.add('bg-amber-50');
      });
    }
  },
  get lang() { return this.$store.ui.lang; },
  get def() { return this.$store.session.defaultLang; },
  get translating() { return this.lang !== this.def; },
  get canEdit() { return this.$store.session.canTranslate(this.lang); },
  prepare() {
    for (const e of this.entries) {
      e.draft = e.values[this.lang]?.value ?? '';
      e.saveState = null;
    }
  },
  source(e) { return e.values[this.def]?.value ?? ''; },
  state(e) { return e.values[this.lang]?.state || 'missing'; },
  matches(e) {
    if (this.translating && (e.type === 'media' || !e.translatable)) return false; // une photo, un lien ou un chiffre vaut pour toutes les langues
    if (this.onlyTodo && this.state(e) === 'ready') return false;
    if (!this.q) return true;
    const q = this.q.toLowerCase();
    return [e.key, e.label, e.draft, this.source(e)].some((v) => String(v || '').toLowerCase().includes(q));
  },
  get sections() {
    const map = new Map();
    for (const e of this.entries) {
      if (!this.matches(e)) continue;
      const prefix = PREFIX[e.key.split('.')[0]];
      const name = prefix ? `${prefix} · ${e.section || 'autres textes'}` : e.section || 'Autres textes';
      if (!map.has(name)) map.set(name, { name, entries: [], todo: 0 });
      const sec = map.get(name);
      sec.entries.push(e);
      if (this.state(e) !== 'ready') sec.todo += 1;
    }
    return [...map.values()];
  },
  get summary() {
    if (this.loading) return '';
    if (!this.translating) return `${this.entries.length} textes`;
    const texts = this.entries.filter((e) => e.type !== 'media' && e.translatable);
    const todo = texts.filter((e) => this.state(e) !== 'ready').length;
    return todo ? `${todo} texte(s) à traduire ou à revoir sur ${texts.length}` : 'Tout est traduit';
  },
  rows(e) {
    const len = Math.max(String(e.draft || '').length, String(this.source(e)).length);
    return Math.min(8, Math.max(1, Math.ceil(len / 70)));
  },
  async save(e, { status = null, force = false } = {}) {
    const current = e.values[this.lang]?.value ?? '';
    if (!force && e.draft === current) return;
    if (!this.canEdit) return;
    const lang = this.lang;
    e.saveState = 'saving';
    try {
      const body = { value: e.draft };
      if (lang !== this.def) body.status = status || (this.asDraft ? 'draft' : 'ready');
      const updated = await put(`/entries/${e.id}/${lang}`, body);
      e.values = updated.values;
      e.saveState = 'saved';
      setTimeout(() => { if (e.saveState === 'saved') e.saveState = null; }, 2500);
    } catch (err) {
      e.saveState = 'error';
      this.$store.toast.error(err);
    }
  },
  /** Image d'un emplacement photo (langue de travail, sinon langue d'origine). */
  mediaThumb(e) { return e.values[this.lang]?.thumb || e.values[this.def]?.thumb || ''; },
  /** Choisit l'image dans la médiathèque ; { remove: true } la retire (photo facultative : le pictogramme revient). */
  async pickMedia(e, { remove = false } = {}) {
    const m = remove ? { id: null } : await this.$store.picker.show({ kinds: ['image'] });
    if (!m || !this.canEdit) return;
    e.saveState = 'saving';
    try {
      e.values = (await put(`/entries/${e.id}/${this.lang}`, { media_id: m.id })).values;
      e.saveState = 'saved';
      setTimeout(() => { if (e.saveState === 'saved') e.saveState = null; }, 2500);
    } catch (err) {
      e.saveState = 'error';
      this.$store.toast.error(err);
    }
  },
  copySource(e) {
    e.draft = this.source(e);
    this.save(e);
  },
}));

Alpine.data('textsView', () => ({
  get scope() { return this.$store.route.params.scope; },
  get title() { return { ui: 'Textes de l’interface', jsonld: 'Données structurées (JSON-LD)' }[this.scope] || 'Textes communs'; },
  init() {
    setTitle(this.title);
  },
}));
