/**
 * Menus et liens : menu principal, menu mobile, pied de page, cartes du restaurant et du bar.
 * Chaque liste vient d'un gabarit (data-cms-links) ; ses liens sont des éléments de la collection « links ».
 * Libellé dans la langue de travail ; cible, ordre, sous-menu et visibilité dans la langue par défaut.
 */
import Alpine from '/admin/vendor/alpine.js';
import { get, post, patch, put, del } from '../lib/api.js';
import { setTitle } from '../lib/router.js';
import { pageLabel } from './pages.js';

const KINDS = [['page', 'Une page du site'], ['media', 'Un document (PDF)'], ['url', 'Une adresse internet']];

Alpine.data('linksView', () => ({
  lists: [],
  items: [],
  pages: [],
  media: {},
  loading: true,
  kinds: KINDS,
  async init() {
    setTitle('Menus et liens');
    try {
      [this.lists, this.items, this.pages] = await Promise.all([get('/link-lists'), get('/collections/links/items'), get('/pages')]);
      await this.loadMedia();
    } catch (err) {
      this.$store.toast.error(err);
    }
    this.prepare();
    this.loading = false;
    this.$watch('$store.ui.lang', () => this.prepare());
  },
  get lang() { return this.$store.ui.lang; },
  get def() { return this.$store.session.defaultLang; },
  get translating() { return this.lang !== this.def; },
  get canEdit() { return this.$store.session.canContent && !this.translating; },
  get canTranslate() { return this.$store.session.canTranslate(this.lang); },
  /** Listes communes à toutes les pages d'abord, puis celles d'une page. */
  get groups() {
    const common = this.lists.filter((l) => !l.page);
    const own = this.lists.filter((l) => l.page);
    return [{ name: 'Sur toutes les pages', lists: common }, { name: 'Dans une page', lists: own }].filter((g) => g.lists.length);
  },
  prepare() {
    for (const it of this.items) {
      it.draft = it.i18n[this.lang]?.data?.label ?? '';
      it.saveState = null;
    }
  },
  async loadMedia() {
    const ids = [...new Set(this.items.filter((it) => it.data.kind === 'media' && it.data.media).map((it) => it.data.media))];
    const rows = await Promise.all(ids.filter((id) => !this.media[id]).map((id) => get(`/media/${id}`).catch(() => null)));
    for (const m of rows.filter(Boolean)) this.media[m.id] = m;
  },
  pageName(key) {
    const p = this.pages.find((x) => x.key === key);
    return p ? pageLabel(p, this.def) : key;
  },
  get pageOptions() {
    return this.pages.filter((p) => p.key !== '404').map((p) => ({ key: p.key, name: pageLabel(p, this.def) })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  },
  listPlace(list) { return list.page ? `Page « ${this.pageName(list.page)} »` : 'Toutes les pages'; },
  /** Liens d'une liste dans l'ordre du site : chaque lien principal suivi de ses sous-liens. */
  rows(list) {
    const own = this.items.filter((it) => it.data.list === list.key).sort((a, b) => a.position - b.position || a.id - b.id);
    const out = [];
    for (const top of own.filter((it) => !it.data.parent)) {
      out.push(top);
      out.push(...own.filter((it) => it.data.parent === top.key));
    }
    return out;
  },
  source(it) { return it.i18n[this.def]?.data?.label ?? ''; },
  state(it) { return it.i18n[this.lang]?.state || 'missing'; },
  todo(list) { return this.translating ? this.rows(list).filter((it) => this.state(it) !== 'ready').length : 0; },
  mediaName(it) {
    const m = this.media[it.data.media];
    return m ? m.original_name || `document ${m.id}` : 'Aucun document choisi';
  },
  mediaUrl(it) {
    const m = this.media[it.data.media];
    return m?.variants?.find((v) => v.purpose === 'original')?.url || '';
  },
  replace(updated) {
    const i = this.items.findIndex((x) => x.id === updated.id);
    const draft = this.items[i]?.draft;
    this.items[i] = { ...updated, draft: updated.i18n[this.lang]?.data?.label ?? draft ?? '', saveState: null };
  },
  flash(it, state) {
    it.saveState = state;
    if (state === 'saved') setTimeout(() => { if (it.saveState === 'saved') it.saveState = null; }, 2500);
  },
  async saveLabel(it, { status = null } = {}) {
    if (!this.canTranslate) return;
    const value = String(it.draft || '').trim();
    if (!value && !this.translating) {
      this.$store.toast.push('Le libellé ne peut pas être vide.', 'error');
      it.draft = this.source(it);
      return;
    }
    it.saveState = 'saving';
    try {
      const updated = this.translating
        ? await put(`/items/${it.id}/i18n/${this.lang}`, { data: { label: value }, status: status || 'ready' })
        : await patch(`/items/${it.id}`, { data: { label: value } });
      this.replace(updated);
      this.flash(this.items.find((x) => x.id === it.id), 'saved');
    } catch (err) {
      this.flash(it, 'error');
      this.$store.toast.error(err);
    }
  },
  async saveTarget(it, data) {
    if (!this.canEdit) return;
    it.saveState = 'saving';
    try {
      this.replace(await patch(`/items/${it.id}`, { data }));
      await this.loadMedia();
      this.flash(this.items.find((x) => x.id === it.id), 'saved');
    } catch (err) {
      this.flash(it, 'error');
      this.$store.toast.error(err);
      this.items = await get('/collections/links/items');
      this.prepare();
    }
  },
  setKind(it, kind) {
    if (kind === 'page') return this.saveTarget(it, { kind, page: it.data.page || 'accueil' });
    if (kind === 'url') {
      it.data = { ...it.data, kind };
      return undefined; // enregistré quand l'adresse est saisie
    }
    return this.pickDocument(it);
  },
  async pickDocument(it) {
    const m = await this.$store.picker.show({ kinds: ['document'] });
    if (!m) return;
    this.media[m.id] = m;
    await this.saveTarget(it, { kind: 'media', media: m.id });
  },
  saveUrl(it, value) {
    const url = String(value || '').trim();
    if (url) this.saveTarget(it, { kind: 'url', url });
  },
  async toggle(it) {
    try {
      this.replace(await patch(`/items/${it.id}`, { is_active: !it.is_active }));
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  /** Enregistre l'ordre affiché (liens principaux et sous-liens). */
  async saveOrder(list, ordered) {
    ordered.forEach((it, i) => { it.position = i; });
    try {
      await put(`/link-lists/${encodeURIComponent(list.key)}/order`, ordered.map((it) => it.id));
    } catch (err) {
      this.$store.toast.error(err);
      this.items = await get('/collections/links/items');
      this.prepare();
    }
  },
  /** Blocs de la liste : un lien principal et ses sous-liens. */
  blocks(list) {
    const rows = this.rows(list);
    return rows.filter((it) => !it.data.parent).map((top) => [top, ...rows.filter((it) => it.data.parent === top.key)]);
  },
  canMove(list, it, dir) {
    const siblings = this.rows(list).filter((x) => (x.data.parent || null) === (it.data.parent || null));
    const i = siblings.indexOf(it);
    return dir < 0 ? i > 0 : i < siblings.length - 1;
  },
  move(list, it, dir) {
    let blocks = this.blocks(list);
    if (!it.data.parent) {
      const i = blocks.findIndex((b) => b[0] === it);
      const j = i + dir;
      if (j < 0 || j >= blocks.length) return;
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    } else {
      blocks = blocks.map((b) => {
        if (b[0].key !== it.data.parent) return b;
        const kids = b.slice(1);
        const i = kids.indexOf(it);
        const j = i + dir;
        if (j < 0 || j >= kids.length) return b;
        [kids[i], kids[j]] = [kids[j], kids[i]];
        return [b[0], ...kids];
      });
    }
    this.saveOrder(list, blocks.flat());
  },
  /** Sous-menu : le lien passe sous le lien principal qui le précède (ou en ressort). */
  canIndent(list, it) {
    if (!list.nested || it.data.parent) return false;
    const blocks = this.blocks(list);
    const i = blocks.findIndex((b) => b[0] === it);
    return i > 0 && blocks[i].length === 1;
  },
  async indent(list, it) {
    const blocks = this.blocks(list);
    const i = blocks.findIndex((b) => b[0] === it);
    const parent = blocks[i - 1][0];
    await this.saveTarget(it, { parent: parent.key });
    await this.saveOrder(list, this.blocks(list).flat());
  },
  async outdent(list, it) {
    const parentKey = it.data.parent;
    await this.saveTarget(it, { parent: null });
    const blocks = this.blocks(list);
    const moved = this.items.find((x) => x.id === it.id);
    const rest = blocks.filter((b) => b[0] !== moved);
    const at = rest.findIndex((b) => b[0].key === parentKey);
    rest.splice(at + 1, 0, [moved]);
    await this.saveOrder(list, rest.flat());
  },
  async add(list) {
    const key = `${list.key}-${Date.now().toString(36)}`;
    try {
      const created = await post('/collections/links/items', {
        key, data: { list: list.key, parent: null, kind: 'page', page: 'accueil', label: 'Nouveau lien' },
        position: Math.max(-1, ...this.rows(list).map((it) => it.position)) + 1,
      });
      this.items.push({ ...created, draft: created.i18n[this.lang]?.data?.label ?? '', saveState: null });
      this.$nextTick(() => document.getElementById(`link-${created.id}`)?.select());
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
  async remove(it) {
    const kids = this.items.filter((x) => x.data.list === it.data.list && x.data.parent === it.key);
    const ok = await this.$store.dialog.confirm({
      title: `Supprimer le lien « ${this.source(it)} » ?`,
      body: kids.length ? `Ses ${kids.length} sous-lien(s) seront supprimés aussi. Pour le retirer seulement un temps, utilisez plutôt « Masquer ».` : 'Pour le retirer seulement un temps, utilisez plutôt « Masquer ».',
      confirmLabel: 'Supprimer', danger: true,
    });
    if (!ok) return;
    try {
      await del(`/items/${it.id}`);
      this.items = this.items.filter((x) => x.id !== it.id && !kids.includes(x));
    } catch (err) {
      this.$store.toast.error(err);
    }
  },
}));
