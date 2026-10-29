/**
 * État partagé de l'admin : session et droits, langue de travail, notifications, fenêtres
 * de confirmation, sélecteur de médias, prévisualisation et publication.
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, post, session as apiSession, ApiError, qs, upload } from './api.js';

const readLocal = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writeLocal = (key, value) => {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* stockage indisponible */ }
};

/* ---------- Session et droits ---------- */
Alpine.store('session', {
  state: 'loading', // loading | anonymous | ready
  user: null,
  site: {},
  languages: [],
  scopedPages: [],

  get defaultLang() { return this.languages.find((l) => l.is_default)?.code || 'fr'; },
  get role() { return this.user?.role; },
  get isAdmin() { return this.role === 'admin'; },
  get isScoped() { return Boolean(this.user?.scopes?.length); },
  get canContent() { return ['admin', 'editor'].includes(this.role); },
  get canPublish() { return this.canContent; },
  get canStats() { return this.canContent && !this.isScoped; },
  /** Même règle que le serveur : la langue par défaut pour admin et éditeur, les autres selon le rôle. */
  canTranslate(lang) {
    if (!this.user) return false;
    if (lang === this.defaultLang) return this.canContent;
    return this.role !== 'translator' || this.user.langs.includes(lang);
  },
  get editableLangs() { return this.languages.filter((l) => this.canTranslate(l.code)); },
  get otherLangs() { return this.languages.filter((l) => !l.is_default); },
  langName(code) { return this.languages.find((l) => l.code === code)?.name || code; },
  roleLabel(user = this.user) {
    if (!user) return '';
    if (user.scopes?.length) return `Éditeur · ${user.scopes.map((s) => (s === 'live-music' ? 'Live Music' : s)).join(', ')}`;
    return { admin: 'Administrateur', editor: 'Éditeur', translator: 'Traducteur' }[user.role] || user.role;
  },

  async load() {
    try {
      const me = await get('/auth/me');
      await this.start(me);
    } catch {
      this.state = 'anonymous';
    }
  },
  async start({ user, csrf, site }) {
    apiSession.csrf = csrf;
    this.user = user;
    if (site) this.site = site;
    this.languages = await get('/languages');
    this.scopedPages = this.isScoped ? await get('/pages') : [];
    Alpine.store('ui').initLang();
    this.state = 'ready';
    window.dispatchEvent(new CustomEvent('admin:ready'));
  },
  async login(email, password) {
    const data = await post('/auth/login', { email, password });
    const me = await get('/auth/me');
    await this.start({ ...me, user: data.user });
  },
  async logout() {
    try { await post('/auth/logout'); } catch { /* session déjà fermée */ }
    this.reset();
  },
  reset() {
    apiSession.csrf = null;
    this.user = null;
    this.state = 'anonymous';
    Alpine.store('ui').dirty = false;
    document.getElementById('view').innerHTML = '';
  },
});

/* ---------- Interface ---------- */
Alpine.store('ui', {
  menuOpen: false,
  dirty: false,
  lang: 'fr',
  initLang() {
    const s = Alpine.store('session');
    const saved = readLocal('aston.admin.lang');
    // Langue retenue seulement si cette personne peut l'éditer (sinon : sa langue de traduction)
    const own = s.role === 'translator' ? s.user.langs[0] : null;
    this.lang = s.languages.some((l) => l.code === saved) && s.canTranslate(saved) ? saved : own || s.defaultLang;
  },
  setLang(code) {
    if (code === this.lang) return;
    if (this.dirty && !window.confirm('Des modifications ne sont pas enregistrées. Changer de langue quand même ?')) return;
    this.dirty = false;
    this.lang = code;
    writeLocal('aston.admin.lang', code);
  },
  /** Mesure d'audience désactivée sur ce poste (lu par track.js : même origine que le site). */
  get noStats() { return readLocal('aston.no-stats') === '1'; },
  set noStats(on) { writeLocal('aston.no-stats', on ? '1' : null); },
});

/* ---------- Notifications ---------- */
let toastId = 0;
Alpine.store('toast', {
  items: [],
  push(text, kind = 'ok', { action = null, ms = 4500 } = {}) {
    const id = ++toastId;
    this.items.push({ id, text, kind, action });
    if (ms) setTimeout(() => this.close(id), ms);
    return id;
  },
  error(err) {
    if (err instanceof ApiError && err.status === 401) return null;
    return this.push(err?.message || String(err), 'error', { ms: 8000 });
  },
  close(id) { this.items = this.items.filter((t) => t.id !== id); },
});

/* ---------- Fenêtres : confirmation, saisie, secret affiché une fois ---------- */
Alpine.store('dialog', {
  open: false,
  mode: 'confirm', // confirm | prompt | secret | choice
  title: '',
  body: '',
  confirmLabel: 'Confirmer',
  danger: false,
  checkbox: null,
  input: '',
  inputLabel: '',
  secret: '',
  copied: false,
  choices: [],
  cancelLabel: 'Annuler',
  resolve: null,
  show(opts) {
    Object.assign(this, { mode: 'confirm', title: '', body: '', confirmLabel: 'Confirmer', danger: false, checkbox: null, input: '', inputLabel: '', secret: '', copied: false, choices: [], cancelLabel: 'Annuler' }, opts);
    this.open = true;
    return new Promise((resolve) => { this.resolve = resolve; });
  },
  confirm(opts) { return this.show({ ...opts, mode: 'confirm' }); },
  prompt(opts) { return this.show({ confirmLabel: 'Valider', ...opts, mode: 'prompt' }); },
  showSecret(opts) { return this.show({ confirmLabel: 'J’ai noté', ...opts, mode: 'secret' }); },
  /** Choix entre plusieurs boutons ({ value, label }) : la valeur choisie, ou null si annulé. */
  choose(opts) { return this.show({ ...opts, mode: 'choice' }); },
  pick(value) {
    this.open = false;
    this.resolve?.(value);
    this.resolve = null;
  },
  finish(ok) {
    this.open = false;
    const value = this.mode === 'prompt' || this.mode === 'choice' ? (ok && this.mode === 'prompt' ? this.input : null) : this.checkbox ? { ok, checked: this.checkbox.checked } : ok;
    this.resolve?.(value);
    this.resolve = null;
  },
  async copy() {
    try {
      await navigator.clipboard.writeText(this.secret);
      this.copied = true;
    } catch {
      this.copied = false;
    }
  },
});

/* ---------- Sélecteur de médias ---------- */
Alpine.store('picker', {
  open: false,
  kinds: ['image'],
  items: [],
  total: 0,
  q: '',
  loading: false,
  uploading: null,
  resolve: null,
  async show({ kinds = ['image'] } = {}) {
    Object.assign(this, { kinds, q: '', items: [], open: true });
    this.load();
    return new Promise((resolve) => { this.resolve = resolve; });
  },
  async load() {
    this.loading = true;
    try {
      const kind = this.kinds.length === 1 ? this.kinds[0] : undefined;
      const res = await get(`/media${qs({ kind, q: this.q, limit: 120 })}`);
      this.items = res.items.filter((m) => this.kinds.includes(m.kind));
      this.total = res.total;
    } catch (err) {
      Alpine.store('toast').error(err);
    } finally {
      this.loading = false;
    }
  },
  async upload(files) {
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      this.uploading = { name: file.name, progress: 0 };
      try {
        const res = await upload('/media?wait=1', fd, (p) => { this.uploading.progress = p; });
        if (res.media.status === 'error') Alpine.store('toast').push(`${file.name} : ${res.media.error || 'traitement impossible'}`, 'error');
      } catch (err) {
        Alpine.store('toast').error(err);
      }
    }
    this.uploading = null;
    this.load();
  },
  choose(media) {
    this.open = false;
    this.resolve?.(media);
    this.resolve = null;
  },
  cancel() { this.choose(null); },
});

/* ---------- Prévisualisation et publication ---------- */
Alpine.store('build', {
  busy: null, // 'preview' | 'publish'
  result: null,
  /** Génère la prévisualisation et l'ouvre dans un onglet (ouvert tout de suite, sinon le navigateur le bloque). */
  async preview(path = null) {
    const lang = Alpine.store('ui').lang;
    const target = path || Alpine.store('route').previewPath || `/${lang}/`;
    const win = window.open('about:blank', '_blank');
    this.busy = 'preview';
    try {
      const build = await post('/builds/preview', {});
      if (build.status === 'failed') throw new Error(`Prévisualisation impossible : ${build.error}`);
      if (win) win.location.href = `/preview${target}`;
      else Alpine.store('toast').push('Prévisualisation prête.', 'ok', { action: { label: 'Ouvrir', href: `/preview${target}` } });
    } catch (err) {
      win?.close();
      Alpine.store('toast').error(err);
    } finally {
      this.busy = null;
    }
  },
  async publish() {
    const s = Alpine.store('session');
    const ok = await Alpine.store('dialog').confirm({
      title: 'Publier le site ?',
      body: s.isScoped
        ? 'Les modifications enregistrées dans la partie Live Music partent en ligne. Le reste du site garde sa version actuelle.'
        : 'Toutes les modifications enregistrées partent en ligne. Une page n’est publiée dans une langue que si elle y est entièrement traduite. La version actuelle reste disponible pour une restauration.',
      confirmLabel: 'Publier',
    });
    if (!ok) return null;
    this.busy = 'publish';
    try {
      this.result = await post('/builds/publish');
      window.dispatchEvent(new CustomEvent('admin:published', { detail: this.result }));
      return this.result;
    } catch (err) {
      Alpine.store('toast').error(err);
      return null;
    } finally {
      this.busy = null;
    }
  },
});

/* ---------- Pictogrammes du site (sprite du layout) ---------- */
Alpine.store('icons', {
  list: [],
  loaded: false,
  async load() {
    if (this.loaded) return this.list;
    this.loaded = true;
    try {
      this.list = await get('/icons');
      const ns = 'http://www.w3.org/2000/svg';
      const sprite = document.createElementNS(ns, 'svg');
      sprite.setAttribute('aria-hidden', 'true');
      sprite.style.display = 'none';
      sprite.innerHTML = this.list.map((i) => `<symbol id="${i.id}" viewBox="${i.viewBox}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${i.body}</symbol>`).join('');
      document.body.prepend(sprite);
    } catch {
      this.loaded = false;
    }
    return this.list;
  },
});

Alpine.store('route', { view: null, params: {}, query: {}, path: '/', title: '', previewPath: null });
