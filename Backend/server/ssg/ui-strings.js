/**
 * Textes d'interface écrits par le JavaScript du site (module de réservation, avis, formulaires,
 * chat, bouton du bas d'écran, bandeaux, popup). Ils deviennent des entrées traduisibles
 * « ui.* » ; le build les passe au navigateur dans #site-config.i18n.
 * Le français ci-dessous reste aussi écrit dans le code comme valeur de repli.
 */
import { sha, nowIso } from '../lib/util.js';

const SECTION = 'Interface (JavaScript)';

export const UI_STRINGS = {
  'ui.room.confort': ['Chambre Confort', 'Nom affiché dans le module de réservation'],
  'ui.room.privilege': ['Chambre Privilège', 'Nom affiché dans le module de réservation'],
  'ui.room.premium': ['Chambre Premium', 'Nom affiché dans le module de réservation'],
  'ui.room.exclusive': ['Chambre Exclusive', 'Nom affiché dans le module de réservation'],
  'ui.room.deluxe': ['Chambre Deluxe Terrasse', 'Nom affiché dans le module de réservation'],
  'ui.room.suites': ['Suite familiale', 'Nom affiché dans le module de réservation'],
  'ui.offer.escapade-gourmande': ['Escapade gourmande', "Nom de l'offre dans le module de réservation"],
  'ui.offer.nouvel-an': ['Nouvel An à Nice', "Nom de l'offre dans le module de réservation"],
  'ui.offer.carnaval': ['Magie du Carnaval', "Nom de l'offre dans le module de réservation"],
  'ui.booking.past': ["La date d'arrivée ne peut pas être passée.", 'Erreur : arrivée dans le passé'],
  'ui.booking.order': ['Choisissez une date de départ postérieure à la date d’arrivée.', 'Erreur : départ avant l’arrivée'],
  'ui.booking.offer': ['Offre : {name}', '{name} = nom de l’offre'],
  'ui.booking.context': ['{label} · choisissez vos dates, vous arriverez directement sur les tarifs.', '{label} = chambre ou offre choisie'],
  'ui.cta.room': ['Réserver une chambre', 'Bouton du bas d’écran'],
  'ui.cta.table': ['Réserver une table', 'Bouton du bas d’écran (pages restaurant)'],
  'ui.cta.quote': ['Demander un devis', 'Bouton du bas d’écran (pages séminaire)'],
  'ui.reviews.stars': ['{n} sur 5', 'Note lue par les lecteurs d’écran'],
  'ui.reviews.google': ['Note moyenne Google', 'Lien vers la fiche Google'],
  'ui.reviews.distribution': ['Répartition des avis affichés', 'Libellé du graphique des notes'],
  'ui.reviews.demo': ['Exemple', 'Étiquette des avis de démonstration'],
  'ui.reviews.reply': ["Réponse de l'hôtel", 'Titre de la réponse à un avis'],
  'ui.reviews.empty': ['Aucun avis récent sur ce thème pour le moment.', 'Aucun avis'],
  'ui.reviews.demo-note': ['Avis de démonstration : à remplacer par le flux vérifié de la fiche Google Business Profile.', 'Note sous les avis de démonstration'],
  'ui.topic.sejour': ['Séjour', 'Thème d’avis'],
  'ui.topic.chambres': ['Chambres', 'Thème d’avis'],
  'ui.topic.petit-dejeuner': ['Petit-déjeuner', 'Thème d’avis'],
  'ui.topic.rooftop': ['Rooftop', 'Thème d’avis'],
  'ui.topic.restaurant': ['Restaurant', 'Thème d’avis'],
  'ui.topic.seminaire': ['Séminaire', 'Thème d’avis'],
  'ui.form.invalid': ['Merci de compléter les champs indiqués.', 'Formulaire incomplet'],
  'ui.form.sent': ['Merci, votre demande est bien envoyée.', 'Formulaire envoyé'],
  'ui.form.failed': ["L'envoi a échoué. Écrivez-nous à {email}.", '{email} = adresse de secours'],
  'ui.form.subject': ['Demande de devis', 'Objet de l’e-mail de devis'],
  'ui.form.mailto': ['Votre messagerie s’ouvre avec la demande pré-remplie : il ne reste qu’à l’envoyer.', 'Envoi par la messagerie'],
  'ui.map.title': ['Carte Google : hôtel Aston La Scala, 12 avenue Félix Faure, Nice', 'Titre de la carte chargée à la demande'],
  'ui.gigs.line': ['Live Music · blues & soul · Moon Bar ou Aston Club selon la météo', 'Ligne de chaque soirée Live Music'],
  'ui.gigs.artist': ['Artiste annoncé prochainement', 'Artiste à venir'],
  'ui.gigs.website': ['Site de l’artiste', 'Lien vers le site d’un artiste (programme Live Music)'],
  'ui.chat.name': ['Nom', 'Chat : champ'],
  'ui.chat.name-placeholder': ['Nom et société', 'Chat : exemple dans le champ'],
  'ui.chat.email': ['E-mail', 'Chat : champ'],
  'ui.chat.people': ['Participants', 'Chat : champ'],
  'ui.chat.people-placeholder': ['Nombre de participants', 'Chat : exemple dans le champ'],
  'ui.chat.firstname': ['Prénom', 'Chat : champ'],
  'ui.chat.phone': ['Téléphone', 'Chat : champ'],
  'ui.chat.slot': ['Créneau', 'Chat : champ'],
  'ui.chat.slot-morning': ['Le matin', 'Chat : créneau'],
  'ui.chat.slot-afternoon': ["L'après-midi", 'Chat : créneau'],
  'ui.chat.slot-evening': ['En soirée', 'Chat : créneau'],
  'ui.chat.submit-quote': ['Recevoir ma proposition', 'Chat : bouton'],
  'ui.chat.submit-callback': ['Être rappelé', 'Chat : bouton'],
  'ui.chat.subject-quote': ['Demande de devis (chat du site)', 'Chat : objet de l’e-mail'],
  'ui.chat.subject-callback': ['Demande de rappel (chat du site)', 'Chat : objet de l’e-mail'],
  'ui.chat.prepared': ['Demande préparée.', 'Chat : confirmation'],
  'ui.chat.thanks-quote': ["Merci ! Votre messagerie s'ouvre avec la demande prête à envoyer. Pour aller plus loin : <a href=\"{devis}\">formulaire de devis complet</a>.", 'Chat : remerciement ({devis} = lien du formulaire)'],
  'ui.chat.thanks-callback': ["Merci ! Votre messagerie s'ouvre avec la demande prête à envoyer ; la réception vous rappelle sur le créneau choisi.", 'Chat : remerciement'],
  'ui.banner.close': ['Fermer le bandeau', 'Bouton de fermeture des bandeaux'],
  'ui.popup.close': ['Fermer', 'Bouton de fermeture du popup'],
};

export const isUiKey = (key) => key.startsWith('ui.');

/** Textes écrits par le build sur une page donnée (programme Live Music). */
export const PAGE_STRINGS = {
  'live-music': {
    'live-music.lieu-selon-meteo': ['Moon Bar ou Aston Club selon la météo', 'Lieu d’un concert : selon la météo'],
    'live-music.lieu-moon-bar': ['Moon Bar, sur le toit', 'Lieu d’un concert : Moon Bar'],
    'live-music.lieu-aston-club': ["L'Aston Club, 7e étage", 'Lieu d’un concert : Aston Club'],
  },
};

/** Ajoute les entrées absentes (ui.* et textes de pages), sans toucher à celles qui existent. */
export function ensureUiStrings(db) {
  const lang = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  if (!lang) return 0;
  const exists = db.prepare('SELECT 1 FROM cms_entries WHERE key = ?');
  const insEntry = db.prepare(`INSERT INTO cms_entries (key, page_id, section, type, label, translatable, required, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`);
  const insValue = db.prepare(`INSERT INTO cms_entry_values (entry_id, lang, value, status, source_hash, updated_at) VALUES (?, ?, ?, 'ready', ?, ?)`);
  const pageId = db.prepare('SELECT id FROM cms_pages WHERE key = ?').pluck();
  const now = nowIso();
  let added = 0;
  const add = (key, value, label, page, section, position) => {
    if (exists.get(key)) return;
    const type = /<[a-z]/i.test(value) ? 'richtext' : 'text';
    const id = insEntry.run(key, page, section, type, label, position, now, now).lastInsertRowid;
    insValue.run(id, lang, value, sha(value), now);
    added += 1;
  };
  db.transaction(() => {
    Object.entries(UI_STRINGS).forEach(([key, [value, label]], i) => add(key, value, label, null, SECTION, 10000 + i));
    for (const [page, strings] of Object.entries(PAGE_STRINGS)) {
      const id = pageId.get(page);
      if (!id) continue; // page pas encore importée
      Object.entries(strings).forEach(([key, [value, label]], i) => add(key, value, label, id, 'Programme', 9000 + i));
    }
  })();
  return added;
}
