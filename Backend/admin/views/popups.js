/**
 * Popup : contenu par langue (titre, texte, bouton), média, déclenchement (délai, défilement,
 * intention de sortie ; sur mobile seulement après un geste), fréquence et pages concernées.
 * Popup d'une offre : contenu repris de la fiche, ses propres textes le remplacent.
 * Conflits : deux popups actifs aux mêmes dates sur une même page ; à l'enregistrement, l'admin
 * demande lequel afficher pendant la période commune (l'autre reprend ensuite).
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, post, patch, put, del } from '../lib/api.js';
import { setTitle, go } from '../lib/router.js';
import { toParisInput, scheduleState, fmtDateTime } from '../lib/format.js';
import { pageLabel } from './pages.js';
import { loadTargets, CTA_KINDS } from './banners.js';

/** Période commune d'un conflit, en clair. */
export function conflictPeriod(c) {
  if (!c.start && !c.end) return 'sans limite de dates';
  if (!c.start) return `jusqu’au ${fmtDateTime(c.end)}`;
  if (!c.end) return `à partir du ${fmtDateTime(c.start)}`;
  return `du ${fmtDateTime(c.start)} au ${fmtDateTime(c.end)}`;
}

/** Pages communes d'un conflit, en clair (les quatre premières). */
export function conflictPages(c, pageName) {
  if (c.allPages) return 'toutes les pages';
  const names = c.pages.slice(0, 4).map(pageName);
  return c.pages.length > 4 ? `${names.join(', ')} et ${c.pages.length - 4} autre${c.pages.length > 5 ? 's' : ''}` : names.join(', ');
}

/**
 * Demande, pour chaque conflit (même déjà tranché par les priorités), lequel des deux popups
 * afficher pendant la période commune. Rend le popup à jour (ou celui reçu si rien n'a changé).
 */
export async function resolveConflicts(store, popup, pageName) {
  let current = popup;
  for (const c of popup.conflicts) {
    const pages = conflictPages(c, pageName);
    const shown = c.winner === popup.id ? popup.name : c.name;
    const choice = await store.dialog.choose({
      title: `Conflit avec le popup « ${c.name} »`,
      body: `Les deux s’ouvrent ${conflictPeriod(c)}, sur : ${pages}.\nUne seule fenêtre s’affiche par page.${c.resolved ? ` Actuellement, c’est « ${shown} » qui s’affiche.` : ''} Laquelle afficher pendant cette période ? L’autre reprend ensuite.`,
      choices: [{ value: 'this', label: `Afficher « ${current.name} »` }, { value: 'other', label: `Afficher « ${c.name} »` }],
      cancelLabel: c.resolved ? 'Garder ce réglage' : 'Décider plus tard',
    });
    if (!choice) continue;
    if (choice === 'this') current = await post(`/popups/${current.id}/prefer`, { over: c.id });
    else {
      await post(`/popups/${c.id}/prefer`, { over: current.id });
      current = await get(`/popups/${current.id}`);
    }
  }
  return current;
}

Alpine.data('popupsView', () => ({
  popups: [],
  loading: true,
  async init() {
    try { this.popups = await get('/popups'); } catch (err) { this.$store.toast.error(err); }
    this.loading = false;
  },
  schedule: scheduleState,
  unresolved(p) { return p.is_active ? p.conflicts.filter((c) => !c.resolved).length : 0; },
  /** Popup masqué par un autre pendant une période commune (conflit tranché en sa défaveur). */
  hiddenBy(p) {
    const c = p.is_active && p.conflicts.find((x) => x.resolved && x.winner !== p.id);
    return c ? `Masqué par « ${c.name} » ${conflictPeriod(c)}` : '';
  },
  trigger(p) {
    const t = { delay: `après ${p.trigger_value ?? 8} s`, scroll: `à ${p.trigger_value ?? 50} % de la page`, exit_intent: 'quand le visiteur s’apprête à partir' }[p.trigger_type];
    const f = { once: 'une seule fois', session: 'une fois par visite', days: `au plus tous les ${p.frequency_days} jours` }[p.frequency];
    return `${t} · ${f}`;
  },
}));

Alpine.data('popupView', () => ({
  CTA_KINDS,
  popup: null,
  isNew: false,
  pages: [],
  targets: { pages: [], items: [], rooms: [] },
  form: null,
  texts: {},
  scope: { mode: 'all', pages: [] },
  media: null,
  saving: false,
  conflictPeriod,
  conflictPages(c) { return conflictPages(c, (k) => this.pageKeyName(k)); },
  async init() {
    const id = this.$store.route.params.id;
    this.isNew = id === 'nouveau';
    if (this.$store.route.query.lang) this.$store.ui.setLang(this.$store.route.query.lang);
    try {
      [this.pages, this.targets] = await Promise.all([get('/pages'), loadTargets(this.$store.session)]);
      if (!this.isNew) this.popup = await get(`/popups/${id}`);
    } catch (err) {
      this.$store.toast.error(err);
      return;
    }
    this.reset();
  },
  async reset() {
    const p = this.popup || { name: '', is_active: 0, start_at: null, end_at: null, media_id: null, trigger_type: 'delay', trigger_value: 8, mobile_trigger: 'scroll', frequency: 'days', frequency_days: 7, priority: 0, pages: [], i18n: {} };
    this.form = {
      name: p.name, is_active: Boolean(p.is_active), start_at: toParisInput(p.start_at), end_at: toParisInput(p.end_at), media_id: p.media_id,
      trigger_type: p.trigger_type, trigger_value: p.trigger_value, mobile_trigger: p.mobile_trigger, frequency: p.frequency,
      frequency_days: p.frequency_days, priority: p.priority || 0, reshow: false,
    };
    this.texts = Object.fromEntries(this.$store.session.languages.map((l) => {
      const r = p.i18n[l.code] || {};
      return [l.code, { title: r.title || '', body: r.body || '', cta_label: r.cta_label || '', cta_kind: r.cta_kind || 'none', cta_target: r.cta_target || '', state: r.state || 'missing' }];
    }));
    const include = p.pages.filter((r) => r.mode === 'include');
    const exclude = p.pages.filter((r) => r.mode === 'exclude');
    this.scope = include.length && !include.some((r) => !r.page_id)
      ? { mode: 'include', pages: include.map((r) => r.page_id) }
      : exclude.length ? { mode: 'exclude', pages: exclude.map((r) => r.page_id) } : { mode: 'all', pages: [] };
    setTitle(this.isNew ? 'Nouveau popup' : `Popup · ${p.name}`);
    this.media = null;
    if (p.media_id) {
      try { this.media = await get(`/media/${p.media_id}`); } catch { /* média supprimé */ }
    }
    this.$store.ui.dirty = false;
  },
  get lang() { return this.$store.ui.lang; },
  get def() { return this.$store.session.defaultLang; },
  get canEdit() { return this.$store.session.canContent; },
  get canText() { return this.$store.session.canTranslate(this.lang); },
  get t() { return this.texts[this.lang]; },
  get offer() { return this.popup?.offer || null; },
  get ctaKinds() { return this.popup?.offer_key ? [['none', 'Celui de l’offre'], ...CTA_KINDS.slice(1)] : CTA_KINDS; },
  get conflicts() { return this.form?.is_active ? this.popup?.conflicts || [] : []; },
  winnerName(c) { return c.winner === this.popup.id ? `« ${this.popup.name} »` : `« ${c.name} »`; },
  pageKeyName(key) {
    const p = this.pages.find((x) => x.key === key);
    return p ? this.pageName(p) : key;
  },
  async decide() {
    try {
      this.popup = await resolveConflicts(this.$store, this.popup, (k) => this.pageKeyName(k));
      await this.reset();
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  get state() { return scheduleState({ ...this.form, start_at: this.form.start_at ? new Date(this.form.start_at).toISOString() : null, end_at: this.form.end_at ? new Date(this.form.end_at).toISOString() : null }); },
  ctaChoices(kind) {
    if (kind === 'page') return this.targets.pages;
    if (kind === 'item') return this.targets.items;
    if (kind === 'booking') return [{ value: '', label: 'Le moteur, sans présélection' }, ...this.targets.rooms];
    return [];
  },
  pageName(p) { return pageLabel(p, this.def); },
  togglePage(id) {
    this.scope.pages = this.scope.pages.includes(id) ? this.scope.pages.filter((x) => x !== id) : [...this.scope.pages, id];
    this.$store.ui.dirty = true;
  },
  async pickMedia() {
    const m = await this.$store.picker.show({ kinds: ['image', 'video', 'audio'] });
    if (!m) return;
    this.form.media_id = m.id;
    this.media = m;
    this.$store.ui.dirty = true;
  },
  clearMedia() {
    this.form.media_id = null;
    this.media = null;
    this.$store.ui.dirty = true;
  },
  async save() {
    this.saving = true;
    try {
      const f = this.form;
      let id = this.popup?.id;
      if (this.canEdit) {
        const body = {
          name: f.name.trim(), is_active: f.is_active, start_at: f.start_at || null, end_at: f.end_at || null, media_id: f.media_id || null,
          trigger_type: f.trigger_type, trigger_value: f.trigger_type === 'exit_intent' ? null : Number(f.trigger_value) || 0, mobile_trigger: f.mobile_trigger,
          frequency: f.frequency, frequency_days: f.frequency === 'days' ? Number(f.frequency_days) || 7 : null, priority: Number(f.priority) || 0,
          ...(f.reshow ? { reshow: true } : {}),
        };
        this.popup = id ? await patch(`/popups/${id}`, body) : await post('/popups', body);
        id = this.popup.id;
        const rows = this.scope.mode === 'all' ? [] : this.scope.pages.map((pid) => ({ page_id: pid, mode: this.scope.mode }));
        this.popup = await put(`/popups/${id}/pages`, rows);
      }
      const t = this.t;
      const own = t.title.trim() || t.body || t.cta_kind !== 'none';
      // Popup d'une offre : des textes vides le laissent reprendre ceux de l'offre
      if (this.canText && (t.title.trim() || (this.popup.offer_key && (own || this.popup.i18n[this.lang]?.state !== 'missing')))) {
        this.popup = await put(`/popups/${id}/i18n/${this.lang}`, {
          title: t.title.trim(), body: t.body || null, cta_label: t.cta_label || null, cta_kind: t.cta_kind,
          cta_target: t.cta_kind === 'none' ? null : t.cta_target, ...(this.lang !== this.def ? { status: 'ready' } : {}),
        });
      }
      this.$store.ui.dirty = false;
      this.$store.toast.push('Popup enregistré.');
      if (this.canEdit && this.popup.is_active) this.popup = await resolveConflicts(this.$store, this.popup, (k) => this.pageKeyName(k));
      if (this.isNew) go(`#/popups/${id}`);
      else await this.reset();
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.saving = false;
    }
  },
  async remove() {
    const ok = await this.$store.dialog.confirm({ title: `Supprimer le popup « ${this.popup.name} » ?`, body: 'Il disparaîtra du site à la prochaine publication.', confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    try {
      await del(`/popups/${this.popup.id}`);
      this.$store.ui.dirty = false;
      go('#/popups');
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
}));
