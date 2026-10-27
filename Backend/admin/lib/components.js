/**
 * Composants réutilisables : éditeur de texte riche, compteur SEO, aperçu Google.
 */
import Alpine from '/admin/vendor/alpine.js';

/**
 * Texte riche : gras, italique, liens, listes. Le serveur nettoie le HTML (liste blanche) ;
 * le collage arrive en texte brut pour ne pas importer la mise en forme de Word.
 * Usage : <div x-data="richtext" x-modelable="html" x-model="champ" @rich-change="enregistrer()"></div>
 */
Alpine.data('richtext', (opts = {}) => ({
  html: '',
  // Déclarés ici : sinon Alpine écrirait ces propriétés dans le composant parent
  editorEl: null,
  sourceEl: null,
  init() {
    const root = this.$el;
    root.classList.add('block');
    const bar = document.createElement('div');
    bar.className = 'rich-bar';
    const editor = document.createElement('div');
    editor.className = 'input rich-editor prose-lite';
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    const source = document.createElement('textarea');
    source.className = 'input rich-editor font-mono text-xs';
    source.rows = 6;
    source.hidden = true;
    const tools = [
      ['B', 'Gras', () => this.exec('bold')],
      ['I', 'Italique', () => this.exec('italic')],
      ['Lien', 'Ajouter un lien', () => this.link()],
      ['Sans lien', 'Retirer le lien', () => this.exec('unlink')],
      ...(opts.inline ? [] : [['• Liste', 'Liste à puces', () => this.exec('insertUnorderedList')]]),
      ['Effacer', 'Retirer la mise en forme', () => this.exec('removeFormat')],
      ['HTML', 'Voir le code HTML', () => this.toggleSource()],
    ];
    for (const [label, title, run] of tools) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault()); // garde la sélection
      b.addEventListener('click', run);
      if (label === 'HTML') b.dataset.source = '';
      bar.append(b);
    }
    root.replaceChildren(bar, editor, source);
    this.editorEl = editor;
    this.sourceEl = source;
    editor.innerHTML = this.html || '';
    let atFocus = null;
    editor.addEventListener('focus', () => { atFocus = this.html; });
    editor.addEventListener('input', () => this.sync());
    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    editor.addEventListener('blur', () => {
      if (atFocus !== null && atFocus !== this.html) root.dispatchEvent(new CustomEvent('rich-change', { bubbles: true }));
      atFocus = null;
    });
    source.addEventListener('input', () => { this.html = source.value; });
    source.addEventListener('change', () => root.dispatchEvent(new CustomEvent('rich-change', { bubbles: true })));
    this.$watch('html', (v) => {
      if (document.activeElement !== editor && editor.innerHTML !== (v || '')) editor.innerHTML = v || '';
      if (document.activeElement !== source) source.value = v || '';
    });
    if (opts.disabled) {
      editor.contentEditable = 'false';
      bar.hidden = true;
      editor.classList.add('rounded-t-lg', 'bg-slate-50');
    }
  },
  sync() {
    const v = this.editorEl.innerHTML;
    this.html = v === '<br>' ? '' : v;
  },
  exec(cmd, value = null) {
    this.editorEl.focus();
    document.execCommand(cmd, false, value);
    this.sync();
  },
  async link() {
    const sel = window.getSelection();
    const range = sel.rangeCount && this.editorEl.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    if (!range || range.collapsed) {
      Alpine.store('toast').push('Sélectionnez d’abord le texte à transformer en lien.', 'error');
      return;
    }
    const url = await Alpine.store('dialog').prompt({
      title: 'Ajouter un lien',
      inputLabel: 'Adresse : https://…, #/page du site (ex. #/chambres), mailto:… ou tel:…',
      input: 'https://',
    });
    if (!url || url === 'https://') return;
    if (!/^(https?:\/\/|#\/|\/|mailto:|tel:)/.test(url)) {
      Alpine.store('toast').push('Adresse non reconnue : commencez par https://, #/, mailto: ou tel:.', 'error');
      return;
    }
    sel.removeAllRanges();
    sel.addRange(range);
    this.exec('createLink', url);
    this.$el.dispatchEvent(new CustomEvent('rich-change', { bubbles: true }));
  },
  toggleSource() {
    const show = this.sourceEl.hidden;
    this.sourceEl.hidden = !show;
    this.editorEl.hidden = show;
    this.$el.querySelector('[data-source]')?.classList.toggle('on', show);
    if (show) this.sourceEl.value = this.html || '';
    else this.editorEl.innerHTML = this.html || '';
  },
}));

/** Couleur d'un compteur de caractères (title, description). */
export function counterClass(length, [min, max]) {
  if (!length) return 'text-slate-400';
  if (length > max) return 'text-rose-700';
  if (length < min) return 'text-amber-700';
  return 'text-emerald-700';
}

/** Aperçu d'un résultat Google : coupe comme Google (environ 60 et 160 caractères). */
export function snippet({ url, title, description }) {
  const cut = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s || '');
  let display = url;
  try {
    const u = new URL(url);
    display = `${u.hostname}${u.pathname.replace(/\/$/, '').split('/').filter(Boolean).map((p) => ` › ${p}`).join('')}`;
  } catch { /* adresse relative */ }
  return { display, title: cut(title, 60), description: cut(description, 160) };
}
