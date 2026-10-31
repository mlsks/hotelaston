/**
 * Mise en forme : dates à l'heure de Paris, tailles, états de traduction, libellés des textes.
 */
const TZ = 'Europe/Paris';

const dateTime = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const number = new Intl.NumberFormat('fr-FR');

export const fmtDateTime = (iso) => (iso ? dateTime.format(new Date(iso)) : '—');
export const fmtDay = (ymd) => (ymd ? dayFmt.format(new Date(`${ymd}T12:00:00Z`)) : '—');
export const fmtNumber = (n) => (n === null || n === undefined ? '—' : number.format(n));
export const fmtPercent = (n) => (n === null || n === undefined ? '—' : `${number.format(n)} %`);

export function fmtBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${number.format(Math.round(bytes / 102.4) / 10)} Ko`;
  return `${number.format(Math.round(bytes / 1024 ** 2 * 10) / 10)} Mo`;
}

export function fmtDuration(ms) {
  if (!ms) return '0 s';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
}

/** Date UTC stockée → valeur d'un champ datetime-local à l'heure de Paris (« AAAA-MM-JJTHH:MM »). */
export function toParisInput(iso) {
  if (!iso) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('fr-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Aujourd'hui à Paris, « AAAA-MM-JJ ». */
export const todayParis = () => toParisInput(new Date().toISOString()).slice(0, 10);

/** Période d'un élément programmé : active, programmée, terminée ou désactivée. */
export function scheduleState({ is_active: active, start_at: start, end_at: end }) {
  const now = new Date().toISOString();
  if (!active) return { key: 'off', label: 'Désactivé', cls: 'bg-slate-100 text-slate-600' };
  if (end && end <= now) return { key: 'ended', label: 'Terminé', cls: 'bg-slate-100 text-slate-500' };
  if (start && start > now) return { key: 'scheduled', label: `Programmé le ${fmtDateTime(start)}`, cls: 'bg-sky-50 text-sky-800' };
  return { key: 'live', label: end ? `En ligne jusqu'au ${fmtDateTime(end)}` : 'En ligne', cls: 'bg-emerald-50 text-emerald-800' };
}

export const STATES = {
  ready: { label: 'Prêt', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  draft: { label: 'Brouillon', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  outdated: { label: 'À revoir', cls: 'bg-orange-50 text-orange-800 ring-orange-200' },
  missing: { label: 'À traduire', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
};
export const stateLabel = (s) => STATES[s]?.label || s;
export const stateClass = (s) => STATES[s]?.cls || 'bg-slate-50 text-slate-600 ring-slate-200';

/** Nature d'un texte d'après sa clé (« accueil.003-h1 », « accueil.001-img@alt »). */
const TAGS = {
  h1: 'Titre principal (H1)', h2: 'Titre de section (H2)', h3: 'Sous-titre (H3)', h4: 'Petit titre (H4)', h5: 'Petit titre', h6: 'Petit titre',
  p: 'Paragraphe', a: 'Lien', li: 'Élément de liste', button: 'Bouton', span: 'Texte', strong: 'Texte en gras', em: 'Texte en italique',
  label: 'Libellé de champ', option: 'Choix dans une liste', summary: 'Question', dt: 'Intitulé', dd: 'Valeur', td: 'Cellule de tableau',
  th: 'En-tête de tableau', figcaption: 'Légende', blockquote: 'Citation', small: 'Petit texte', cite: 'Source', caption: 'Titre de tableau',
  title: 'Titre', div: 'Bloc de texte', legend: 'Titre de groupe de champs', b: 'Texte en gras', i: 'Texte en italique', time: 'Date ou horaire',
};
const ATTRS = {
  alt: "Texte alternatif d'une image", placeholder: 'Texte indicatif d’un champ', 'aria-label': "Libellé lu par les lecteurs d'écran",
  title: 'Infobulle', content: 'Valeur', value: 'Valeur', 'data-label': 'Libellé',
};
export function entryKind(entry) {
  if (entry.type === 'media') return entry.label || 'Photo'; // « Photo : … », dit où elle s'affiche
  if (entry.key.startsWith('ui.')) return 'Texte du site (JavaScript)';
  const part = entry.key.split('.').slice(1).join('.').replace(/^\d+-/, '');
  const [tag, attr] = part.split('@');
  if (attr) return ATTRS[attr] || `Attribut ${attr}`;
  return TAGS[tag] || entry.label || 'Texte';
}

export function slugify(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Texte sans balises (aperçus, compteurs). */
export function plain(html) {
  const div = document.createElement('div');
  div.innerHTML = String(html ?? '');
  return div.textContent || '';
}

/** Mot de passe aléatoire lisible (même forme que ceux générés par le serveur). */
export function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
