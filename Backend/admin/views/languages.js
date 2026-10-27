/**
 * Langues du site (administrateurs) et suivi des traductions : avancement par langue et par module,
 * liste des éléments à traduire avec un lien direct vers leur éditeur.
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, post, patch, qs } from '../lib/api.js';

const MODULES = { pages: 'Pages (SEO)', entries: 'Textes', items: 'Fiches', media: 'Médias', banners: 'Bandeaux', popups: 'Popup' };

Alpine.data('translationsView', () => ({
  MODULES,
  status: null,
  lang: null,
  module: '',
  state: '',
  todo: [],
  pages: [],
  loading: false,
  async init() {
    try {
      [this.status, this.pages] = await Promise.all([get('/translations/status'), get('/pages')]);
      const s = this.$store.session;
      const mine = this.status.langs.filter((l) => s.canTranslate(l.code));
      this.lang = (mine.find((l) => l.code === this.$store.ui.lang) || mine[0] || this.status.langs[0])?.code;
      await this.loadTodo();
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  async loadTodo() {
    if (!this.lang) return;
    this.loading = true;
    try {
      this.todo = await get(`/translations/todo${qs({ lang: this.lang, module: this.module, state: this.state, limit: 2000 })}`);
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.loading = false;
    }
  },
  choose(code) {
    this.lang = code;
    this.$store.ui.setLang(code);
    this.loadTodo();
  },
  /** Lien vers l'éditeur de l'élément, dans la bonne langue. */
  link(u) {
    const lang = this.lang;
    if (u.module === 'pages') return `#/pages/${u.id}?lang=${lang}&tab=seo`;
    if (u.module === 'entries') {
      if (u.ref.startsWith('ui.')) return `#/textes/ui?lang=${lang}&entry=${u.id}`;
      const page = this.pages.find((p) => p.key === u.ref.split('.')[0]);
      return page ? `#/pages/${page.id}?lang=${lang}&entry=${u.id}` : `#/textes/global?lang=${lang}&entry=${u.id}`;
    }
    if (u.module === 'items') return `#/collections/${u.ref.split('/')[0]}/${u.id}?lang=${lang}`;
    if (u.module === 'media') return `#/medias?open=${u.id}`;
    if (u.module === 'banners') return `#/bandeaux/${u.id}?lang=${lang}`;
    if (u.module === 'popups') return `#/popups/${u.id}?lang=${lang}`;
    return '#/';
  },
  get current() { return this.status?.langs.find((l) => l.code === this.lang); },
}));

Alpine.data('languagesView', () => ({
  languages: [],
  adding: false,
  draft: { code: '', name: '', native_name: '', locale: '', booking_lang: '' },
  async init() { await this.load(); },
  async load() {
    try { this.languages = await get('/languages'); } catch (err) { this.$store.toast.error(err); }
  },
  async toggle(l) {
    const on = !l.is_active;
    if (on) {
      const ok = await this.$store.dialog.confirm({
        title: `Mettre le site en ligne en ${l.name.toLowerCase()} ?`,
        body: 'À la prochaine publication, chaque page entièrement traduite sera publiée dans cette langue, avec son sélecteur de langue et ses balises hreflang. Les pages incomplètes restent en attente.',
        confirmLabel: 'Activer',
      });
      if (!ok) return;
    }
    try {
      await patch(`/languages/${l.code}`, { is_active: on });
      await this.refresh();
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  async move(l, dir) {
    const list = [...this.languages];
    const i = list.indexOf(l);
    if (!list[i + dir]) return;
    list.splice(i, 1);
    list.splice(i + dir, 0, l);
    try {
      await Promise.all(list.map((x, pos) => (x.position === pos + 1 ? null : patch(`/languages/${x.code}`, { position: pos + 1 }))));
      await this.refresh();
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  async save(l) {
    try {
      await patch(`/languages/${l.code}`, { name: l.name, native_name: l.native_name, locale: l.locale, booking_lang: l.booking_lang });
      this.$store.toast.push('Langue enregistrée.');
      await this.refresh();
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  async add() {
    try {
      const d = this.draft;
      await post('/languages', { ...d, code: d.code.toLowerCase(), booking_lang: (d.booking_lang || d.code).toLowerCase() });
      this.draft = { code: '', name: '', native_name: '', locale: '', booking_lang: '' };
      this.adding = false;
      this.$store.toast.push('Langue ajoutée (inactive) : ses textes peuvent être traduits avant la mise en ligne.');
      await this.refresh();
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  async refresh() {
    await this.load();
    this.$store.session.languages = await get('/languages');
  },
}));
