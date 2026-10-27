/**
 * Pages : liste (arborescence, état des langues), puis pour chaque page ses textes,
 * ses réglages SEO par langue (aperçu Google et contrôles sur le rendu réel) et sa place dans le site.
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, put, patch } from '../lib/api.js';
import { setTitle } from '../lib/router.js';

/** Nom court d'une page dans une langue. */
export function pageLabel(page, lang) {
  const row = page?.i18n?.[lang];
  return row?.nav_label || row?.title?.split(/\s[|–—]\s|,\s/)[0] || page?.key || '';
}

Alpine.data('pagesView', () => ({
  pages: [],
  q: '',
  loading: true,
  async init() {
    try {
      this.pages = await get('/pages');
    } catch (err) {
      this.$store.toast.error(err);
    }
    this.loading = false;
  },
  label(p) { return pageLabel(p, this.$store.session.defaultLang); },
  get rows() {
    const def = this.$store.session.defaultLang;
    const children = new Map();
    for (const p of this.pages) {
      const k = p.parent_id || 0;
      if (!children.has(k)) children.set(k, []);
      children.get(k).push(p);
    }
    const out = [];
    const seen = new Set();
    const walk = (parent, depth) => {
      for (const p of children.get(parent) || []) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        out.push({ ...p, depth });
        walk(p.id, depth + 1);
      }
    };
    walk(0, 0);
    for (const p of this.pages) if (!seen.has(p.id)) out.push({ ...p, depth: 0 });
    const q = this.q.toLowerCase();
    return q ? out.filter((p) => [p.key, p.i18n[def]?.title, p.i18n[def]?.path].some((v) => String(v || '').toLowerCase().includes(q))) : out;
  },
}));

const SEO_FIELDS = ['slug', 'nav_label', 'title', 'meta_description', 'og_title', 'og_description', 'og_image_id', 'noindex', 'focus_keyword'];

Alpine.data('pageView', () => ({
  page: null,
  pages: [],
  tab: 'texts',
  seo: null,
  ogImage: null,
  checks: null,
  checking: false,
  saving: false,
  settings: null,
  async init() {
    const q = this.$store.route.query;
    if (q.lang && this.$store.session.languages.some((l) => l.code === q.lang)) this.$store.ui.setLang(q.lang);
    this.tab = ['texts', 'seo', 'settings'].includes(q.tab) ? q.tab : 'texts';
    try {
      await this.load();
      if (!this.$store.session.isScoped) this.pages = await get('/pages');
    } catch (err) {
      this.$store.toast.error(err);
      return;
    }
    this.$watch('$store.ui.lang', () => {
      this.resetSeo();
      this.checks = null;
      if (this.tab === 'seo') this.runChecks();
    });
    this.$watch('tab', (t) => { if (t === 'seo' && !this.checks) this.runChecks(); });
    if (this.tab === 'seo') this.runChecks();
  },
  async load() {
    const page = await get(`/pages/${this.$store.route.params.id}`);
    delete page.entries;
    this.page = page;
    setTitle(`Page · ${pageLabel(page, this.def)}`);
    this.settings = { is_active: Boolean(page.is_active), in_sitemap: Boolean(page.in_sitemap), priority: page.priority, parent_id: page.parent_id, position: page.position };
    this.resetSeo();
  },
  get lang() { return this.$store.ui.lang; },
  get def() { return this.$store.session.defaultLang; },
  get translating() { return this.lang !== this.def; },
  get canEdit() { return this.$store.session.canTranslate(this.lang); },
  get row() { return this.page?.i18n?.[this.lang] || {}; },
  get isHome() { return this.page?.key === 'accueil'; },
  get path() {
    if (!this.seo) return '';
    return this.isHome ? `/${this.lang}/` : `/${this.lang}/${this.seo.slug || this.page.key}/`;
  },
  get published() { return Boolean(this.row.path) && this.row.state === 'ready'; },
  label(p) { return pageLabel(p, this.def); },
  resetSeo() {
    if (!this.page) return;
    const r = this.row;
    const d = this.page.i18n[this.def] || {};
    this.seo = Object.fromEntries(SEO_FIELDS.map((k) => [k, r[k] ?? (k === 'noindex' ? false : k === 'slug' && !this.translating ? d.slug : '')]));
    this.seo.noindex = Boolean(this.seo.noindex);
    this.seo.draft = r.status === 'draft';
    this.$store.route.previewPath = r.path || (d.path ? d.path.replace(/^\/[a-z]{2}\//, `/${this.lang}/`) : null);
    this.$store.ui.dirty = false;
    this.loadOgImage();
  },
  async loadOgImage() {
    this.ogImage = null;
    if (this.seo.og_image_id) {
      try { this.ogImage = await get(`/media/${this.seo.og_image_id}`); } catch { /* média supprimé */ }
    }
  },
  async pickOgImage() {
    const m = await this.$store.picker.show({ kinds: ['image'] });
    if (!m) return;
    this.seo.og_image_id = m.id;
    this.ogImage = m;
    this.$store.ui.dirty = true;
  },
  clearOgImage() {
    this.seo.og_image_id = null;
    this.ogImage = null;
    this.$store.ui.dirty = true;
  },
  get preview() {
    return this.$fmt.snippet({ url: `${this.$store.session.site.url || ''}${this.path}`, title: this.seo?.title, description: this.seo?.meta_description });
  },
  async saveSeo() {
    this.saving = true;
    try {
      const body = {};
      for (const k of SEO_FIELDS) {
        let v = this.seo[k];
        if (typeof v === 'string') v = v.trim();
        if (['nav_label', 'og_title', 'og_description', 'focus_keyword'].includes(k) && v === '') v = null;
        if (k === 'slug' && this.isHome) continue;
        body[k] = v;
      }
      if (this.translating) body.status = this.seo.draft ? 'draft' : 'ready';
      const before = this.row.path;
      this.page.i18n[this.lang] = await put(`/pages/${this.page.id}/i18n/${this.lang}`, body);
      this.$store.ui.dirty = false;
      const moved = before && before !== this.page.i18n[this.lang].path;
      this.$store.toast.push(moved ? 'Enregistré. L’ancienne adresse redirigera vers la nouvelle (301).' : 'Réglages SEO enregistrés.');
      this.resetSeo();
      this.runChecks();
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.saving = false;
    }
  },
  async runChecks() {
    if (!this.page) return;
    this.checking = true;
    try {
      this.checks = await get(`/seo/pages/${this.page.id}/${this.lang}`);
    } catch (err) {
      this.checks = { error: err.message };
    } finally {
      this.checking = false;
    }
  },
  async saveSettings() {
    this.saving = true;
    try {
      const s = this.settings;
      await patch(`/pages/${this.page.id}`, { ...s, priority: s.priority === '' || s.priority === null ? null : Number(s.priority), parent_id: s.parent_id ? Number(s.parent_id) : null, position: Number(s.position) || 0 });
      this.$store.ui.dirty = false;
      this.$store.toast.push('Réglages de la page enregistrés.');
      await this.load();
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.saving = false;
    }
  },
}));
