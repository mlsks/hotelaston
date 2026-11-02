/**
 * Aide : prise en main (visite guidée et premiers pas) et manuel d'utilisation (docs/guide-utilisateur.html,
 * servi par /admin/manuel). L'avancement des premiers pas est retenu dans ce navigateur seulement.
 */
import Alpine from '/admin/vendor/alpine.js';
import { readLocal, writeLocal } from '../lib/stores.js';

const key = (name) => `aston.admin.${name}.${Alpine.store('session').user?.id || 0}`;

/** Premiers pas : la modification type, de la page au site en ligne. */
const FIRST_STEPS = [
  { id: 'ouvrir', title: 'Ouvrir une page', text: 'Dans le menu de gauche, rubrique CONTENU, cliquer sur Pages, puis sur la page à modifier (la première, « Hôtel Aston La Scala », est l’accueil).', href: '#/pages', link: 'Ouvrir Pages' },
  { id: 'modifier', title: 'Modifier un texte', text: 'Onglet Textes : taper un mot dans « Rechercher un texte… », corriger le texte, puis cliquer ailleurs. La mention « Enregistré ✓ » confirme. Pour une photo : « Changer l’image ».' },
  { id: 'previsualiser', title: 'Prévisualiser', text: 'Bouton Prévisualiser, en haut à droite : le site tel qu’il sera publié s’ouvre dans un nouvel onglet. Rien n’est encore visible des visiteurs.' },
  { id: 'publier', title: 'Publier', text: 'Bouton Publier, en haut à droite : le site en ligne est mis à jour et une fenêtre « Le site est en ligne » le confirme.', publish: true },
  { id: 'restaurer', title: 'Savoir revenir en arrière', text: 'Rubrique SITE → Publication et versions → Restaurer, sur la ligne d’une version précédente : le site redevient tel qu’il était.', href: '#/versions', link: 'Voir les versions', publish: true },
];

Alpine.data('onboardingView', () => ({
  done: {},
  init() {
    try { this.done = JSON.parse(readLocal(key('premiers-pas')) || '{}'); } catch { this.done = {}; }
  },
  get steps() {
    const canPublish = this.$store.session.canPublish;
    return FIRST_STEPS.map((s) => (s.publish && !canPublish
      ? { ...s, text: 'Votre rôle ne publie pas : une fois la traduction marquée « prête », un éditeur ou un administrateur publie le site.', href: null }
      : s));
  },
  get count() { return this.steps.filter((s) => this.done[s.id]).length; },
  toggle(id) {
    this.done = { ...this.done, [id]: !this.done[id] };
    writeLocal(key('premiers-pas'), JSON.stringify(this.done));
  },
  tour() { this.$store.tour.start(); },
}));

Alpine.data('manualView', () => ({
  src: '/admin/manuel',
  /** Section demandée (?section=ancre) : défilement dans le cadre seulement (une ancre dans l'adresse ferait aussi défiler l'admin). */
  loaded(frame) {
    const id = this.$store.route.query.section;
    const win = frame.contentWindow;
    const el = id && win?.document.getElementById(id);
    if (el) win.scrollTo(0, el.getBoundingClientRect().top + win.scrollY - 8);
  },
}));

/** Carte de bienvenue de l'accueil, jusqu'à ce qu'on la masque. */
Alpine.data('welcomeCard', () => ({
  hidden: true,
  init() { this.hidden = readLocal(key('bienvenue')) === 'masquee'; },
  hide() {
    this.hidden = true;
    writeLocal(key('bienvenue'), 'masquee');
  },
  tour() { this.$store.tour.start(); },
}));
