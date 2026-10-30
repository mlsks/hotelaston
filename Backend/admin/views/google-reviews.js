/**
 * Avis Google : fiche de l'hôtel (note globale, nombre d'avis, lien), liste des avis filtrée sur
 * 4 et 5 étoiles par défaut, affichage / masquage, ajout à la main et import d'un fichier JSON.
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, post, put, patch, del } from '../lib/api.js';

const TOPIC_LABELS = { sejour: 'Séjour', chambres: 'Chambres', 'petit-dejeuner': 'Petit-déjeuner', rooftop: 'Rooftop', restaurant: 'Restaurant', seminaire: 'Séminaire' };
const ORIGINS = {
  sample: ['Exemple', 'bg-amber-50 text-amber-800 ring-amber-200'],
  manual: ['Saisi à la main', 'bg-slate-50 text-slate-700 ring-slate-200'],
  import: ['Importé', 'bg-azure-100 text-azure-900 ring-azure-800/20'],
  api: ['Google (API)', 'bg-emerald-50 text-emerald-800 ring-emerald-200'],
};
const FILTERS = [['top', '4 et 5 étoiles'], ['all', 'Toutes les notes'], ['low', '1 à 3 étoiles'], ['hidden', 'Masqués']];
const blank = () => ({ author_name: '', rating: 5, published_at: new Date().toISOString().slice(0, 10), comment: '', review_url: '', author_photo_url: '', reply_comment: '', topics: [], room: '' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

Alpine.data('googleReviewsView', () => ({
  TOPIC_LABELS,
  ORIGINS,
  FILTERS,
  reviews: [],
  place: { rating: '', review_count: '', maps_url: '' },
  minRating: 4,
  topics: [],
  syncConfigured: false,
  syncedAt: null,
  loading: true,
  filter: 'top',
  search: '',
  form: null, // avis en cours de saisie ou de modification
  importing: null,
  busy: false,

  async init() {
    try { await this.load(); } catch (err) { this.$store.toast.error(err); }
    this.loading = false;
  },
  async load() {
    const data = await get('/google-reviews');
    this.reviews = data.reviews;
    this.minRating = data.minRating;
    this.topics = data.topics;
    this.syncConfigured = data.syncConfigured;
    this.syncedAt = data.place.synced_at;
    this.place = { rating: data.place.rating ?? '', review_count: data.place.review_count ?? '', maps_url: data.place.maps_url || '' };
  },

  get shown() {
    const q = this.search.trim().toLowerCase();
    return this.reviews.filter((r) => {
      if (this.filter === 'top' && r.rating < this.minRating) return false;
      if (this.filter === 'low' && r.rating >= this.minRating) return false;
      if (this.filter === 'hidden' && r.is_visible) return false;
      return !q || `${r.author_name} ${r.comment} ${r.reply_comment || ''}`.toLowerCase().includes(q);
    });
  },
  /** Avis qui partent sur le site à la prochaine publication. */
  get onSite() { return this.reviews.filter((r) => r.is_visible && r.rating >= this.minRating).length; },
  get samples() { return this.reviews.filter((r) => r.origin === 'sample').length; },
  stars: (n) => '★'.repeat(n) + '☆'.repeat(5 - n),
  day: (iso) => (iso ? dateFmt.format(new Date(iso)) : '—'),
  initial: (r) => (r.author_name || '?').trim().charAt(0).toUpperCase(),
  status(r) {
    if (r.rating < this.minRating) return 'Jamais affiché sur le site (moins de 4 étoiles)';
    return r.is_visible ? 'Affiché sur le site' : 'Masqué';
  },

  async savePlace() {
    this.busy = true;
    try {
      const p = await put('/google-reviews/place', {
        rating: this.place.rating === '' ? null : Number(this.place.rating),
        review_count: this.place.review_count === '' ? null : Number(this.place.review_count),
        maps_url: this.place.maps_url.trim() || null,
      });
      this.place = { rating: p.rating ?? '', review_count: p.review_count ?? '', maps_url: p.maps_url || '' };
      this.$store.toast.push('Fiche Google enregistrée : elle s’applique à la prochaine publication.');
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.busy = false;
    }
  },

  async toggle(r) {
    try {
      const updated = await patch(`/google-reviews/${encodeURIComponent(r.review_id)}`, { is_visible: !r.is_visible });
      Object.assign(r, updated);
      this.$store.toast.push(updated.is_visible ? 'Avis affiché à la prochaine publication.' : 'Avis masqué à la prochaine publication.');
    } catch (err) {
      this.$store.toast.error(err);
    }
  },

  add() {
    this.importing = null;
    this.form = { ...blank(), isNew: true };
  },
  edit(r) {
    this.importing = null;
    this.form = {
      isNew: false, locked: r.origin === 'api', review_id: r.review_id, author_name: r.author_name, rating: r.rating,
      published_at: r.published_at.slice(0, 10), comment: r.comment, review_url: r.review_url || '', author_photo_url: r.author_photo_url || '',
      reply_comment: r.reply_comment || '', topics: [...r.topics], room: r.room || '',
    };
  },
  toggleTopic(t) {
    this.form.topics = this.form.topics.includes(t) ? this.form.topics.filter((x) => x !== t) : [...this.form.topics, t];
  },
  async saveForm() {
    const f = this.form;
    const site = { topics: f.topics, room: f.room.trim() || null };
    const body = f.locked ? site : {
      ...site, author_name: f.author_name.trim(), rating: Number(f.rating), published_at: f.published_at, comment: f.comment,
      review_url: f.review_url.trim() || null, author_photo_url: f.author_photo_url.trim() || null, reply_comment: f.reply_comment.trim() || null,
    };
    this.busy = true;
    try {
      if (f.isNew) await post('/google-reviews', body);
      else await patch(`/google-reviews/${encodeURIComponent(f.review_id)}`, body);
      this.$store.toast.push(f.isNew ? 'Avis ajouté.' : 'Avis enregistré.');
      this.form = null;
      await this.load();
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.busy = false;
    }
  },
  async remove(r) {
    const ok = await this.$store.dialog.confirm({
      title: `Supprimer l’avis de ${r.author_name || 'cet auteur'} ?`,
      body: r.origin === 'api' ? 'Il reviendra à la prochaine synchronisation : pour qu’il ne s’affiche plus, masquez-le plutôt.' : 'Il disparaîtra du site à la prochaine publication.',
      confirmLabel: 'Supprimer', danger: true,
    });
    if (!ok) return;
    try {
      await del(`/google-reviews/${encodeURIComponent(r.review_id)}`);
      this.reviews = this.reviews.filter((x) => x !== r);
      this.$store.toast.push('Avis supprimé.');
    } catch (err) {
      this.$store.toast.error(err);
    }
  },

  openImport() {
    this.form = null;
    this.importing = { text: '', sample: false, result: null };
  },
  async readFile(e) {
    const file = e.target.files?.[0];
    if (file) this.importing.text = await file.text();
  },
  async runImport() {
    this.busy = true;
    try {
      const res = await post('/google-reviews/import', { data: this.importing.text, sample: this.importing.sample });
      this.$store.toast.push(`${res.added} avis ajoutés, ${res.updated} mis à jour${res.unchanged ? `, ${res.unchanged} inchangés` : ''}.`);
      this.importing = null;
      await this.load();
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.busy = false;
    }
  },
  async removeSamples() {
    const ok = await this.$store.dialog.confirm({
      title: `Supprimer les ${this.samples} avis d’exemple ?`,
      body: 'Ils disparaîtront du site à la prochaine publication. Le fichier d’exemples permet de les réimporter.',
      confirmLabel: 'Supprimer', danger: true,
    });
    if (!ok) return;
    try {
      for (const r of this.reviews.filter((x) => x.origin === 'sample')) await del(`/google-reviews/${encodeURIComponent(r.review_id)}`);
      await this.load();
      this.$store.toast.push('Exemples supprimés.');
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
}));
