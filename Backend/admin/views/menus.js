/**
 * Cartes du restaurant et des bars : liste, création, et édition d'une carte
 * (rubriques et plats dans la langue par défaut, traduction des libellés dans les autres langues).
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, post, patch, put } from '../lib/api.js';
import { setTitle } from '../lib/router.js';
import { slugify, clone } from '../lib/format.js';

/* ---------- Liste ---------- */
Alpine.data('menusView', () => ({
  menus: [],
  venues: [],
  loading: true,
  draft: { title: '', venue: 'restaurant-horloge', slug: '', slugTouched: false },
  creating: false,
  async init() {
    setTitle('Cartes');
    try {
      [this.menus, this.venues] = await Promise.all([get('/menus'), get('/menus/venues')]);
    } catch (err) {
      this.$store.toast.error(err);
    }
    this.loading = false;
  },
  venueName(key) { return this.venues.find((v) => v.key === key)?.label || key; },
  get groups() {
    return this.venues.map((v) => ({ ...v, menus: this.menus.filter((m) => m.data.venue === v.key) })).filter((g) => g.menus.length);
  },
  dishes(m) { return (m.data.sections || []).reduce((n, s) => n + (s.dishes?.length || 0), 0); },
  title(m) { return m.title || m.key; },
  autoSlug() { if (!this.draft.slugTouched) this.draft.slug = slugify(this.draft.title); },
  async create() {
    this.creating = true;
    try {
      const res = await post('/menus', { title: this.draft.title, venue: this.draft.venue, slug: this.draft.slug });
      this.$store.toast.push('Carte créée : ajoutez ses rubriques et ses plats.');
      location.hash = `#/cartes/${res.key}`;
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.creating = false;
    }
  },
}));

/* ---------- Une carte ---------- */
const emptyDish = () => ({ name: '', price: '', desc: '' });

Alpine.data('menuView', () => ({
  item: null,
  info: null,
  venues: [],
  form: null, // langue par défaut : structure complète
  tr: null, // autre langue : libellés seulement, alignés sur la structure
  asDraft: false,
  saving: false,
  async init() {
    if (this.$store.route.query.lang) this.$store.ui.setLang(this.$store.route.query.lang);
    try {
      const key = this.$store.route.params.key;
      const [menus, venues] = await Promise.all([get('/menus'), get('/menus/venues')]);
      this.venues = venues;
      this.info = menus.find((m) => m.key === key);
      if (!this.info) throw new Error('Carte introuvable.');
      this.item = await get(`/items/${this.info.id}`);
    } catch (err) {
      this.$store.toast.error(err);
      return;
    }
    this.prepare();
    this.$watch('$store.ui.lang', () => this.prepare());
  },
  get lang() { return this.$store.ui.lang; },
  get def() { return this.$store.session.defaultLang; },
  get translating() { return this.lang !== this.def; },
  get canEdit() { return this.$store.session.canContent; },
  get canText() { return this.$store.session.canTranslate(this.lang); },
  get state() { return this.item?.i18n[this.lang]?.state || 'missing'; },
  /** Contenu dans la langue par défaut (structure + textes). */
  get source() { return this.item.merged; },
  prepare() {
    const m = this.item.merged;
    this.form = {
      title: m.title || '', subtitle: m.subtitle || '', backLabel: m.backLabel || '', note: m.note || '', venue: m.venue,
      sections: (m.sections || []).map((s) => ({ title: s.title || '', dishes: (s.dishes || []).map((d) => ({ name: d.name || '', price: d.price || '', desc: d.desc || '' })) })),
    };
    const own = this.item.i18n[this.lang]?.data || {};
    this.tr = {
      title: own.title || '', subtitle: own.subtitle || '', backLabel: own.backLabel || '', note: own.note || '',
      sections: this.form.sections.map((s, i) => ({
        title: own.sections?.[i]?.title || '',
        dishes: s.dishes.map((d, j) => ({ name: own.sections?.[i]?.dishes?.[j]?.name || '', desc: own.sections?.[i]?.dishes?.[j]?.desc || '' })),
      })),
    };
    setTitle(`Carte · ${m.title || this.info.key}`);
    this.$store.route.previewPath = this.info.path ? this.info.path.replace(/^\/[a-z]{2}\//, `/${this.lang}/`) : null;
    this.$store.ui.dirty = false;
  },
  touch() { this.$store.ui.dirty = true; },
  venueName(key) { return this.venues.find((v) => v.key === key)?.label || key; },
  /* Structure (langue par défaut) */
  addSection() {
    this.form.sections.push({ title: '', dishes: [emptyDish()] });
    this.touch();
    this.$nextTick(() => document.getElementById(`section-${this.form.sections.length - 1}`)?.focus());
  },
  addDish(s, si) {
    s.dishes.push(emptyDish());
    this.touch();
    this.$nextTick(() => document.getElementById(`dish-${si}-${s.dishes.length - 1}`)?.focus());
  },
  move(list, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.touch();
  },
  async removeSection(i) {
    const s = this.form.sections[i];
    if (s.dishes.some((d) => d.name) && !(await this.$store.dialog.confirm({ title: `Supprimer la rubrique « ${s.title || 'sans titre'} » ?`, body: `Ses ${s.dishes.length} plat(s) seront supprimés aussi, dans toutes les langues, à l’enregistrement.`, confirmLabel: 'Supprimer', danger: true }))) return;
    this.form.sections.splice(i, 1);
    this.touch();
  },
  removeDish(s, j) {
    s.dishes.splice(j, 1);
    this.touch();
  },
  /** Données envoyées : les champs vides sont retirés. */
  clean(form) {
    const t = (v) => String(v || '').trim();
    const out = { title: t(form.title), venue: form.venue, sections: [] };
    for (const k of ['subtitle', 'backLabel', 'note']) out[k] = t(form[k]);
    out.sections = form.sections.map((s) => ({
      title: t(s.title),
      dishes: s.dishes.filter((d) => t(d.name)).map((d) => ({ name: t(d.name), price: t(d.price), desc: t(d.desc) })),
    }));
    return out;
  },
  async save() {
    this.saving = true;
    try {
      if (this.translating) {
        const t = (v) => String(v || '').trim();
        const data = {
          title: t(this.tr.title), subtitle: t(this.tr.subtitle), backLabel: t(this.tr.backLabel), note: t(this.tr.note),
          sections: this.tr.sections.map((s) => ({ title: t(s.title), dishes: s.dishes.map((d) => ({ name: t(d.name), desc: t(d.desc) })) })),
        };
        this.item = await put(`/items/${this.item.id}/i18n/${this.lang}`, { data, status: this.asDraft ? 'draft' : 'ready' });
      } else {
        // Les plats retirés ou déplacés décalent les traductions : elles passent « à revoir »
        this.item = await patch(`/items/${this.item.id}`, { data: this.clean(this.form) });
      }
      this.prepare();
      this.$store.toast.push('Carte enregistrée.');
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.saving = false;
    }
  },
  async toggle() {
    const active = !this.info.is_active;
    if (!active && !(await this.$store.dialog.confirm({ title: 'Masquer cette carte ?', body: 'Sa page et les liens qui y mènent disparaissent du site à la prochaine publication. Vous pourrez la réafficher.', confirmLabel: 'Masquer' }))) return;
    try {
      await patch(`/menus/${encodeURIComponent(this.info.key)}`, { is_active: active });
      this.info.is_active = active ? 1 : 0;
      this.$store.toast.push(active ? 'Carte réaffichée.' : 'Carte masquée.');
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  copyFrench() {
    this.tr = clone({
      title: this.source.title || '', subtitle: this.source.subtitle || '', backLabel: this.source.backLabel || '', note: this.source.note || '',
      sections: this.form.sections.map((s) => ({ title: s.title, dishes: s.dishes.map((d) => ({ name: d.name, desc: d.desc })) })),
    });
    this.touch();
  },
}));
