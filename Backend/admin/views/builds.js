/**
 * Publication et versions : version en ligne, historique des générations, restauration
 * d'une version conservée ; rapport SEO du dernier build.
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, post } from '../lib/api.js';

const KIND = { preview: 'Prévisualisation', production: 'Publication' };
const TRIGGER = { manual: 'à la demande', cron: 'régénération de nuit', restore: 'restauration' };
const STATUS = {
  success: ['Réussi', 'bg-emerald-50 text-emerald-800 ring-emerald-200'],
  skipped: ['Inchangé', 'bg-slate-100 text-slate-600 ring-slate-200'],
  failed: ['Échec', 'bg-rose-50 text-rose-700 ring-rose-200'],
  running: ['En cours', 'bg-amber-50 text-amber-800 ring-amber-200'],
  pending: ['En attente', 'bg-amber-50 text-amber-800 ring-amber-200'],
};

Alpine.data('buildsView', () => ({
  data: null,
  open: null,
  showPreviews: false,
  async init() {
    await this.load();
    window.addEventListener('admin:published', () => this.load());
  },
  async load() {
    try { this.data = await get('/builds?limit=60'); } catch (err) { this.$store.toast.error(err); }
  },
  get rows() { return (this.data?.items || []).filter((b) => this.showPreviews || b.kind === 'production'); },
  kind(b) { return `${KIND[b.kind] || b.kind} · ${TRIGGER[b.triggered_by] || b.triggered_by}`; },
  status(b) { return STATUS[b.status] || [b.status, 'bg-slate-100 text-slate-600 ring-slate-200']; },
  canRestore(b) {
    return this.$store.session.canPublish && !this.$store.session.isScoped
      && b.kind === 'production' && b.status === 'success' && b.release_path && !b.is_current;
  },
  async restore(b) {
    const res = await this.$store.dialog.confirm({
      title: `Remettre en ligne la version #${b.id} ?`,
      body: `Publiée le ${this.$fmt.fmtDateTime(b.finished_at)}. Le site en ligne revient immédiatement à cette version ; la version actuelle reste disponible.`,
      confirmLabel: 'Restaurer',
      checkbox: { label: 'Restaurer aussi le contenu dans le back-office (les textes reviennent à leur état de cette version ; une sauvegarde de la base est faite avant)', checked: false },
    });
    if (!res?.ok) return;
    try {
      await post(`/builds/${b.id}/restore`, { with_content: res.checked });
      this.$store.toast.push(`Version #${b.id} remise en ligne.`);
      await this.load();
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
}));

Alpine.data('seoView', () => ({
  report: null,
  pages: [],
  which: 'production',
  q: '',
  async init() {
    try {
      [this.report, this.pages] = await Promise.all([get('/seo/report'), get('/pages')]);
      if (!this.report.production) this.which = 'preview';
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  get build() { return this.report?.[this.which]; },
  /** Avertissements regroupés par page (« /fr/chambres/ : title de 69 caractères »). */
  get groups() {
    const map = new Map();
    const q = this.q.toLowerCase();
    for (const w of this.build?.warnings || []) {
      if (q && !w.toLowerCase().includes(q)) continue;
      const m = /^([a-z]{2})?(\/[^\s:]*)\s*:\s*(.*)$/.exec(w);
      const path = m ? (m[2].startsWith(`/${m[1]}/`) || !m[1] ? m[2] : `/${m[1]}${m[2]}`) : 'Site';
      const text = m ? m[3] : w;
      if (!map.has(path)) map.set(path, { path, items: [], page: this.pageFor(path) });
      map.get(path).items.push(text);
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length);
  },
  pageFor(path) {
    for (const p of this.pages) {
      for (const [lang, row] of Object.entries(p.i18n)) if (row.path === path) return { id: p.id, lang };
    }
    return null;
  },
}));
