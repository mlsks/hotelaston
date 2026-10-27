/**
 * Fiches et listes : chambres, services, équipements, avis, réponses du chat, programme Live Music.
 * Formulaire décrit par lib/collections.js ; en traduction, seuls les champs traduisibles sont modifiables.
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, post, patch, put, del } from '../lib/api.js';
import { setTitle, go } from '../lib/router.js';
import * as fmt from '../lib/format.js';
import { SPECS, fieldsFor, fieldTranslatable, splitTranslatable, translationForm, missingTranslations } from '../lib/collections.js';

const spec = (key) => SPECS[key] || { noun: 'élément', title: (d) => d.name || d.label || d.title || '', subtitle: () => '' };

Alpine.data('collectionsView', () => ({
  collections: [],
  async init() {
    try { this.collections = await get('/collections'); } catch (err) { this.$store.toast.error(err); }
  },
  translatable(c) { return c.schema.translatable?.length > 0; },
}));

Alpine.data('collectionView', () => ({
  collection: null,
  items: [],
  loading: true,
  q: '',
  async init() {
    const key = this.$store.route.params.key;
    try {
      const all = await get('/collections');
      this.collection = all.find((c) => c.key === key) || { key, label: key, schema: { translatable: [] } };
      setTitle(this.collection.label);
      await this.load();
    } catch (err) {
      this.$store.toast.error(err);
    }
    this.loading = false;
  },
  async load() {
    this.items = await get(`/collections/${this.collection.key}/items`);
  },
  get spec() { return spec(this.collection?.key); },
  title(it) { return this.spec.title(it.merged, fmt) || it.key; },
  subtitle(it) { return this.spec.subtitle?.(it.merged, fmt) || ''; },
  get sorted() {
    const list = [...this.items];
    if (this.spec.sort) list.sort(this.spec.sort);
    const q = this.q.toLowerCase();
    return q ? list.filter((it) => JSON.stringify(it.merged).toLowerCase().includes(q)) : list;
  },
  /** Programme : à venir d'abord, concerts passés à part. */
  get groups() {
    if (this.collection?.key !== 'gigs') return [{ label: null, items: this.sorted }];
    const today = fmt.todayParis();
    const upcoming = this.sorted.filter((it) => (it.merged.date || '') >= today);
    const past = this.sorted.filter((it) => (it.merged.date || '') < today).reverse();
    return [{ label: 'À venir', items: upcoming }, { label: 'Passés', items: past, muted: true }];
  },
  get canReorder() { return !this.spec.sort && this.$store.session.canContent && !this.q; },
  get translatable() { return this.collection?.schema.translatable?.length > 0; },
  async move(it, dir) {
    const list = this.sorted;
    const i = list.indexOf(it);
    const other = list[i + dir];
    if (!other) return;
    try {
      // Positions recalculées sur toute la liste : aucun ex aequo possible
      const order = [...list];
      order.splice(i, 1);
      order.splice(i + dir, 0, it);
      await Promise.all(order.map((x, pos) => (x.position === pos ? null : patch(`/items/${x.id}`, { position: pos }))));
      await this.load();
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  async toggle(it) {
    try {
      await patch(`/items/${it.id}`, { is_active: !it.is_active });
      await this.load();
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
}));

Alpine.data('itemView', () => ({
  collection: null,
  item: null,
  isNew: false,
  form: {},
  meta: { key: '', is_active: true, start_at: '', end_at: '', slug: '' },
  options: { amenities: [] },
  cdnBase: '',
  saving: false,
  asDraft: false,
  jsonErrors: {},
  async init() {
    const { key, id } = this.$store.route.params;
    this.isNew = id === 'nouveau';
    if (this.$store.route.query.lang) this.$store.ui.setLang(this.$store.route.query.lang);
    try {
      const all = await get('/collections');
      this.collection = all.find((c) => c.key === key);
      if (!this.collection) throw new Error('Collection inconnue.');
      if (!this.isNew) this.item = await get(`/items/${id}`);
      if (this.spec.fields?.some((f) => f.source === 'amenities')) {
        const list = await get('/collections/amenities/items');
        this.options.amenities = list.map((a) => [a.key, a.merged.label || a.key]);
      }
      if (this.spec.fields?.some((f) => f.type === 'icon')) this.$store.icons.load();
      if (!this.$store.session.isScoped) {
        try { this.cdnBase = (await get('/settings')).cdn_base || ''; } catch { /* réglages non lisibles */ }
      }
    } catch (err) {
      this.$store.toast.error(err);
      return;
    }
    this.reset();
    this.$watch('$store.ui.lang', () => this.reset());
  },
  get spec() { return spec(this.collection?.key); },
  get paths() { return this.collection?.schema.translatable || []; },
  get def() { return this.$store.session.defaultLang; },
  get lang() { return this.paths.length ? this.$store.ui.lang : this.def; },
  get translating() { return this.lang !== this.def && !this.isNew; },
  get canEdit() { return this.translating ? this.$store.session.canTranslate(this.lang) : this.$store.session.canContent; },
  get source() { return this.item?.merged || {}; },
  get state() { return this.item?.i18n?.[this.lang]?.state || 'missing'; },
  get fields() {
    const all = fieldsFor(this.collection?.key, this.isNew ? this.form : this.source);
    return this.translating ? all.filter((f) => fieldTranslatable(this.paths, f.key)) : all;
  },
  get heading() {
    if (this.isNew) return `Nouveau ${this.spec.noun || 'élément'}`;
    return this.spec.title(this.source, fmt) || this.item?.key;
  },
  reset() {
    if (!this.collection) return;
    if (this.isNew) {
      this.form = this.spec.blank ? this.spec.blank() : {};
    } else if (this.translating) {
      const tr = this.item.i18n[this.lang];
      this.form = translationForm(this.item.data, tr?.data, this.paths, this.source);
      this.meta.slug = tr?.slug || '';
      this.asDraft = tr?.status === 'draft';
    } else {
      this.form = fmt.clone(this.source);
    }
    if (this.item) {
      this.meta.key = this.item.key;
      this.meta.is_active = Boolean(this.item.is_active);
      this.meta.start_at = fmt.toParisInput(this.item.start_at);
      this.meta.end_at = fmt.toParisInput(this.item.end_at);
    }
    for (const f of this.fields) {
      if (['list', 'pairs', 'objects', 'tags'].includes(f.type) && !Array.isArray(this.form[f.key])) this.form[f.key] = [];
    }
    this.jsonErrors = {};
    setTitle(this.heading);
    this.$store.ui.dirty = false;
  },
  /* ---------- Champs ---------- */
  readOnly(f, sub = null) {
    if (!this.canEdit) return true;
    if (!this.translating) return false;
    return !fieldTranslatable(this.paths, f.key, sub?.key ?? null);
  },
  sourceOf(f, i = null, sub = null) {
    if (!this.translating) return '';
    let v = this.source[f.key];
    if (i !== null) v = v?.[i];
    if (sub) v = v?.[sub.key];
    return Array.isArray(v) ? v.join(' · ') : v ?? '';
  },
  selectValue(f) { return String(this.form[f.key] ?? ''); },
  setSelect(f, value) {
    const opt = f.options.find((o) => String(o[0] ?? '') === value);
    this.form[f.key] = opt ? opt[0] : value;
    this.$store.ui.dirty = true;
  },
  tagOptions(f) { return f.options || this.options[f.source] || []; },
  hasTag(f, v) { return (this.form[f.key] || []).includes(v); },
  toggleTag(f, v) {
    const list = this.form[f.key] || [];
    this.form[f.key] = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
    this.$store.ui.dirty = true;
  },
  addRow(f) {
    const blank = f.type === 'pairs' ? ['', ''] : f.type === 'objects' ? Object.fromEntries((f.fields || []).map((s) => [s.key, s.type === 'number' ? null : ''])) : '';
    this.form[f.key] = [...(this.form[f.key] || []), blank];
    this.$store.ui.dirty = true;
  },
  removeRow(f, i) {
    this.form[f.key].splice(i, 1);
    this.$store.ui.dirty = true;
  },
  moveRow(f, i, dir) {
    const list = this.form[f.key];
    if (i + dir < 0 || i + dir >= list.length) return;
    [list[i], list[i + dir]] = [list[i + dir], list[i]];
    this.$store.ui.dirty = true;
  },
  /** Les listes d'objets suivent la structure de la langue d'origine : pas d'ajout ni de retrait en traduction. */
  structureLocked(f) { return this.translating && f.type === 'objects'; },
  jsonText(f) { return JSON.stringify(this.form[f.key], null, 2); },
  setJson(f, text) {
    try {
      this.form[f.key] = JSON.parse(text);
      delete this.jsonErrors[f.key];
    } catch {
      this.jsonErrors[f.key] = 'JSON invalide : corrigez avant d’enregistrer.';
    }
    this.$store.ui.dirty = true;
  },
  imageUrl(src) {
    if (!src) return '';
    if (/^(https?:)?\//.test(src)) return src;
    return this.cdnBase ? `${this.cdnBase}${src}` : '';
  },
  /* ---------- Enregistrement ---------- */
  cleaned() {
    const data = fmt.clone(this.form);
    for (const f of fieldsFor(this.collection.key, data)) {
      if (f.type === 'number' && (data[f.key] === '' || data[f.key] === undefined)) data[f.key] = null;
      if (f.type === 'list') data[f.key] = (data[f.key] || []).map((v) => String(v).trim()).filter(Boolean);
      if (f.type === 'pairs') data[f.key] = (data[f.key] || []).filter((p) => String(p[0] || '').trim() || String(p[1] || '').trim());
      if (f.type === 'objects') {
        for (const row of data[f.key] || []) for (const s of f.fields || []) if (s.type === 'number' && row[s.key] === '') row[s.key] = null;
      }
    }
    return data;
  },
  async save() {
    if (Object.keys(this.jsonErrors).length) {
      this.$store.toast.push('Un champ JSON est invalide.', 'error');
      return;
    }
    this.saving = true;
    try {
      const data = this.cleaned();
      const dates = { start_at: this.meta.start_at || null, end_at: this.meta.end_at || null };
      if (this.isNew) {
        const key = fmt.slugify(this.meta.key || this.spec.key?.(data) || this.spec.title(data, fmt)) || `element-${Date.now().toString(36)}`;
        const created = await post(`/collections/${this.collection.key}/items`, { key, data, is_active: this.meta.is_active, ...dates });
        this.$store.ui.dirty = false;
        this.$store.toast.push(this.collection.key === 'gigs' ? 'Concert ajouté.' : 'Élément créé.');
        go(`#/collections/${this.collection.key}/${created.id}`);
        return;
      }
      if (this.translating) {
        const missing = missingTranslations(data, this.source, fieldsFor(this.collection.key, this.source), this.paths);
        const status = missing.length || this.asDraft ? 'draft' : 'ready';
        const body = { data: splitTranslatable(data, this.paths).translated, status };
        if (this.collection.item_template && this.meta.slug) body.slug = fmt.slugify(this.meta.slug);
        this.item = await put(`/items/${this.item.id}/i18n/${this.lang}`, body);
        if (missing.length) this.$store.toast.push(`Traduction incomplète, enregistrée en brouillon (non publiée) : ${missing.join(', ')}.`, 'error', { ms: 9000 });
        else this.$store.toast.push('Traduction enregistrée.');
      } else {
        this.item = await patch(`/items/${this.item.id}`, { data, is_active: this.meta.is_active, ...dates });
        this.$store.toast.push('Enregistré.');
      }
      this.reset();
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.saving = false;
    }
  },
  async remove() {
    const ok = await this.$store.dialog.confirm({
      title: `Supprimer « ${this.heading} » ?`,
      body: 'L’élément disparaîtra du site à la prochaine publication. Cette suppression est définitive.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`/items/${this.item.id}`);
      this.$store.ui.dirty = false;
      this.$store.toast.push('Supprimé.');
      go(`#/collections/${this.collection.key}`);
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
}));
