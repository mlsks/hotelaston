/**
 * Médiathèque : envoi (glisser-déposer, plusieurs fichiers), dossiers, recherche, détail d'un média
 * (textes alternatifs par langue, point d'intérêt du recadrage portrait, crédit, dossier),
 * liens externes, suppression avec contrôle des pages qui l'utilisent.
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, post, patch, put, del, upload, qs, ApiError } from '../lib/api.js';

Alpine.data('mediaView', () => ({
  items: [],
  total: 0,
  folders: [],
  folder: '',
  kind: '',
  q: '',
  trash: false,
  loading: true,
  offset: 0,
  queue: [],
  dragging: false,
  current: null,
  detail: null,
  i18n: {},
  saving: false,
  embedUrl: '',
  embedTitle: '',
  uploadFolder: '/',
  async init() {
    if (this.$store.session.isScoped) this.uploadFolder = '/live-music';
    await this.load();
    const open = Number(this.$store.route.query.open);
    if (open) this.open({ id: open });
  },
  async load(more = false) {
    this.loading = true;
    try {
      const offset = more ? this.items.length : 0;
      const res = await get(`/media${qs({ folder: this.folder, kind: this.kind, q: this.q, deleted: this.trash || undefined, limit: 60, offset })}`);
      this.items = more ? [...this.items, ...res.items] : res.items;
      this.total = res.total;
      this.folders = await get('/media/folders');
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.loading = false;
    }
  },
  get canUpload() { return this.$store.session.canContent && !this.trash; },
  /* ---------- Envoi ---------- */
  drop(e) {
    this.dragging = false;
    if (!this.canUpload) return;
    this.send([...e.dataTransfer.files]);
  },
  async send(files) {
    const folder = this.uploadFolder || '/';
    for (const file of files) this.queue.push({ name: file.name, progress: 0, state: 'waiting', file });
    for (const job of this.queue.filter((j) => j.state === 'waiting')) {
      job.state = 'sending';
      const fd = new FormData();
      fd.append('folder', folder);
      fd.append('file', job.file);
      try {
        const res = await upload('/media?wait=1', fd, (p) => { job.progress = p; });
        job.state = res.media.status === 'error' ? 'error' : res.duplicate ? 'duplicate' : 'done';
        job.message = res.media.status === 'error' ? res.media.error : res.duplicate ? 'déjà dans la médiathèque' : (res.media.warnings || []).join(' ');
      } catch (err) {
        job.state = 'error';
        job.message = err.message;
      }
      job.file = null;
    }
    await this.load();
    setTimeout(() => { this.queue = this.queue.filter((j) => ['sending', 'waiting', 'error'].includes(j.state)); }, 6000);
  },
  async addEmbed() {
    try {
      const res = await post('/media/embed', { url: this.embedUrl.trim(), folder: this.uploadFolder || '/', ...(this.embedTitle ? { title: this.embedTitle } : {}) });
      this.embedUrl = '';
      this.embedTitle = '';
      this.$store.toast.push(res.duplicate ? 'Ce lien est déjà dans la médiathèque.' : 'Lien ajouté.');
      await this.load();
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  /* ---------- Détail ---------- */
  async open(m) {
    try {
      this.detail = await get(`/media/${m.id}`);
      this.current = m.id;
      this.i18n = Object.fromEntries(this.$store.session.languages.map((l) => [l.code, {
        alt: this.detail.i18n[l.code]?.alt || '', title: this.detail.i18n[l.code]?.title || '', caption: this.detail.i18n[l.code]?.caption || '',
      }]));
      this.detailForm = { folder: this.detail.folder, credit: this.detail.credit || '' };
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  close() {
    this.detail = null;
    this.current = null;
  },
  detailForm: { folder: '/', credit: '' },
  get large() {
    const v = (this.detail?.variants || []).filter((x) => x.purpose === 'w1024' || x.purpose === 'w1600' || x.purpose === 'w640');
    return v[0]?.url || this.detail?.thumb || null;
  },
  get portrait() { return (this.detail?.variants || []).find((x) => x.purpose === 'portrait')?.url || null; },
  get original() { return (this.detail?.variants || []).find((x) => x.purpose === 'original')?.url || null; },
  get poster() { return (this.detail?.variants || []).find((x) => x.purpose === 'poster')?.url || null; },
  async setFocal(e) {
    if (!this.$store.session.canContent || this.detail.kind !== 'image') return;
    const r = e.currentTarget.getBoundingClientRect();
    const focal_x = Math.round(((e.clientX - r.left) / r.width) * 100) / 100;
    const focal_y = Math.round(((e.clientY - r.top) / r.height) * 100) / 100;
    this.detail.focal_x = focal_x;
    this.detail.focal_y = focal_y;
    try {
      const updated = await patch(`/media/${this.detail.id}?wait=1`, { focal_x, focal_y });
      this.detail = { ...updated, references: this.detail.references };
      this.$store.toast.push('Point d’intérêt enregistré : recadrage portrait recalculé.');
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  async saveDetail() {
    this.saving = true;
    try {
      const s = this.$store.session;
      if (s.canContent) {
        const body = { credit: this.detailForm.credit || null };
        if (this.detailForm.folder && this.detailForm.folder !== this.detail.folder) body.folder = this.detailForm.folder.startsWith('/') ? this.detailForm.folder : `/${this.detailForm.folder}`;
        await patch(`/media/${this.detail.id}`, body);
      }
      if (this.detail.kind !== 'embed' || s.canContent) {
        for (const l of s.languages) {
          if (!s.canTranslate(l.code)) continue;
          const v = this.i18n[l.code];
          const before = this.detail.i18n[l.code] || {};
          if ((before.alt || '') === v.alt && (before.title || '') === v.title && (before.caption || '') === v.caption) continue;
          await put(`/media/${this.detail.id}/i18n/${l.code}`, { alt: v.alt || null, title: v.title || null, caption: v.caption || null });
        }
      }
      this.$store.toast.push('Média enregistré.');
      await this.open({ id: this.detail.id });
      await this.load();
    } catch (err) {
      this.$store.toast.error(err);
    } finally {
      this.saving = false;
    }
  },
  async remove() {
    const refs = this.detail.references || [];
    const ok = await this.$store.dialog.confirm({
      title: 'Mettre ce média à la corbeille ?',
      body: refs.length
        ? `Il est utilisé par : ${refs.slice(0, 6).join(', ')}${refs.length > 6 ? '…' : ''}.\nCes emplacements n’afficheront plus rien après la prochaine publication.`
        : 'Il sera effacé définitivement la nuit prochaine, sauf si une version du site conservée l’utilise encore.',
      confirmLabel: 'Mettre à la corbeille',
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`/media/${this.detail.id}${refs.length ? '?force=true' : ''}`);
      this.close();
      await this.load();
      this.$store.toast.push('Média mis à la corbeille.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) this.$store.toast.push(err.message, 'error');
      else this.$store.toast.error(err);
    }
  },
}));
