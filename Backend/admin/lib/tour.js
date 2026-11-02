/**
 * Visite guidée de l'admin (Aide → Prise en main) : une bulle désigne tour à tour les entrées du menu
 * et les boutons de l'en-tête. Seules les étapes dont l'élément est affiché pour ce compte sont gardées
 * (un traducteur ou l'éditeur Live Music ne voit pas tout le menu).
 */
import Alpine from '/admin/vendor/alpine.js';

const nav = (href) => `aside nav a[href="${href}"]`;

/** Étapes : sel = élément désigné (aucun : bulle au centre). */
export const STEPS = [
  { title: 'Bienvenue dans le back-office', text: 'Cette visite montre en deux minutes où se trouve chaque chose. Flèches du clavier ou boutons pour avancer ; Échap pour quitter. Elle se relance à tout moment depuis Aide → Prise en main.' },
  { sel: nav('#/'), title: 'Accueil', text: 'La version en ligne, la prévisualisation, les visites de la semaine, l’avancement des traductions et le rapport SEO, d’un coup d’œil.' },
  { sel: nav('#/pages'), title: 'Pages', text: 'Toutes les pages du site. Cliquer sur une page : onglet Textes pour ses textes et ses photos (« Changer l’image »), onglet Référencement (SEO) pour son title et sa description dans Google.' },
  { sel: nav('#/textes/global'), title: 'Textes communs', text: 'Les textes présents sur toutes les pages : en-tête, pied de page, chat, mentions légales du bas. Une modification ici change toutes les pages.' },
  { sel: nav('#/menus'), title: 'Menus et liens', text: 'Les liens du menu, du menu mobile et du pied de page : renommer, réordonner, ajouter, masquer.' },
  { sel: nav('#/cartes'), title: 'Cartes du restaurant', text: 'Les cartes de L’Horloge, du Moon Bar et de L’Aston Club : rubriques, plats, prix.' },
  { sel: nav('#/collections'), title: 'Fiches et listes', text: 'Les contenus répétés : chambres, services, offres, articles du blog, salles de séminaire, réponses du chat, concerts et artistes, et les bandeaux photo (HERO).' },
  { sel: nav('#/collections/gigs'), title: 'Programme des concerts', text: 'Ajouter un concert : date, lieu (selon la météo, Moon Bar ou L’Aston Club) et artiste.' },
  { sel: nav('#/avis-google'), title: 'Avis Google', text: 'Les avis de la fiche Google de l’hôtel : seuls ceux notés 4 ou 5 étoiles et cochés « Afficher » vont sur le site.' },
  { sel: nav('#/medias'), title: 'Médiathèque', text: 'Photos, vidéos et PDF. Glisser des fichiers sur l’écran pour les envoyer ; ouvrir une photo pour écrire son texte alternatif et choisir son sujet principal (recadrage mobile).' },
  { sel: nav('#/bandeaux'), title: 'Bandeaux', text: 'Un message en haut d’une page ou entre deux sections, qui s’affiche et disparaît seul aux dates choisies.' },
  { sel: nav('#/popups'), title: 'Popup', text: 'Une fenêtre qui s’ouvre sur le site (une au plus par page). Une offre peut aussi être promue en popup depuis sa fiche.' },
  { sel: nav('#/traductions'), title: 'Traductions', text: 'Ce qui reste à traduire, langue par langue. Pour traduire, choisir la langue dans les onglets en haut de chaque écran.' },
  { sel: nav('#/langues'), title: 'Langues du site', text: 'Mettre une langue en ligne : cliquer sur « Inactive » dans sa ligne, puis Publier.' },
  { sel: '[data-tour="preview"]', title: 'Prévisualiser', text: 'Ce qui est enregistré n’est pas encore sur le site. Ce bouton génère le site tel qu’il sera publié et l’ouvre dans un nouvel onglet, pour vérifier.' },
  { sel: '[data-tour="publish"]', title: 'Publier', text: 'Met le site à jour avec tout ce qui est enregistré. Rien n’est en ligne avant ce clic.' },
  { sel: nav('#/versions'), title: 'Publication et versions', text: 'L’historique des publications. « Restaurer » remet en ligne une des trois dernières versions si une publication a cassé quelque chose.' },
  { sel: nav('#/utilisateurs'), title: 'Utilisateurs', text: 'Créer un compte (administrateur, éditeur, traducteur) : le mot de passe généré n’est affiché qu’une fois.' },
  { sel: nav('#/reglages'), title: 'Réglages', text: 'Les paramètres communs : moteur de réservation D-Edge, seuil d’affichage de la note Google, données lues par Google.' },
  { sel: '[data-tour="account"]', title: 'Mon compte', text: 'Changer son mot de passe, et sur les ordinateurs de l’hôtel, cocher « Ne pas compter mes visites » pour des statistiques justes.' },
  { sel: nav('#/aide/manuel'), title: 'Manuel d’utilisation', text: 'Tout le détail, écran par écran, avec un tableau « Où trouver quoi » en tête. Bonne prise en main !' },
];

const GAP = 12;
const isNav = (sel) => Boolean(sel?.startsWith('aside'));
const narrow = () => !matchMedia('(min-width: 1024px)').matches;

Alpine.store('tour', {
  open: false,
  steps: [],
  index: 0,
  box: null, // rectangle éclairé
  pos: { top: 0, left: 0 }, // bulle
  get step() { return this.steps[this.index] || null; },
  start() {
    this.steps = STEPS.filter((s) => !s.sel || document.querySelector(s.sel));
    this.index = 0;
    this.open = true;
    this.place();
  },
  close() {
    this.open = false;
    this.box = null;
    if (narrow()) Alpine.store('ui').menuOpen = false;
  },
  next() { if (this.index < this.steps.length - 1) { this.index += 1; this.place(); } else this.close(); },
  prev() { if (this.index > 0) { this.index -= 1; this.place(); } },
  /** Ouvre le menu (petit écran) si l'étape y est, fait défiler l'élément en vue, puis place la bulle. */
  place() {
    const s = this.step;
    if (!s) return;
    if (narrow()) Alpine.store('ui').menuOpen = isNav(s.sel);
    const el = s.sel && document.querySelector(s.sel);
    el?.scrollIntoView({ block: 'nearest' });
    // Laisse au menu le temps de glisser avant de mesurer
    setTimeout(() => { this.measure(); requestAnimationFrame(() => this.measure()); }, narrow() ? 260 : 30);
  },
  measure() {
    if (!this.open) return;
    const s = this.step;
    const el = s?.sel && document.querySelector(s.sel);
    const bubble = document.getElementById('tour-bubble');
    const bw = bubble?.offsetWidth || 320;
    const bh = bubble?.offsetHeight || 180;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!el) {
      this.box = null;
      this.pos = { top: Math.max(GAP, (vh - bh) / 2), left: Math.max(GAP, (vw - bw) / 2) };
      return;
    }
    const r = el.getBoundingClientRect();
    this.box = { top: r.top - 4, left: r.left - 4, width: r.width + 8, height: r.height + 8 };
    let top;
    let left;
    if (r.right + GAP + bw <= vw - GAP) { // à droite (entrées du menu)
      left = r.right + GAP;
      top = r.top + r.height / 2 - bh / 2;
    } else { // dessous (boutons de l'en-tête), sinon au-dessus
      left = r.right - bw;
      top = r.bottom + GAP + bh <= vh - GAP ? r.bottom + GAP : r.top - GAP - bh;
    }
    this.pos = { top: Math.min(Math.max(GAP, top), vh - bh - GAP), left: Math.min(Math.max(GAP, left), vw - bw - GAP) };
  },
  key(e) {
    if (!this.open) return;
    if (e.key === 'Escape') this.close();
    else if (e.key === 'ArrowRight') this.next();
    else if (e.key === 'ArrowLeft') this.prev();
  },
});

window.addEventListener('resize', () => Alpine.store('tour').measure());
window.addEventListener('keydown', (e) => Alpine.store('tour').key(e));
