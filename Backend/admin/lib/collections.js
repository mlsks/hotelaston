/**
 * Collections : description des champs pour les formulaires de l'admin, et séparation
 * champs communs / champs traduits (même logique que server/ssg/collections.js).
 *
 * Types de champ : text, textarea, rich, number, date, time, month, select, checkbox,
 * list (liste de textes), pairs (liste de paires), objects (liste d'objets), tags (choix multiples),
 * image (photo de la médiathèque, identifiant du média), ref (fiche d'une autre collection, par sa clé), json.
 * onlyIfSet : champ montré seulement s'il a une valeur (données anciennes).
 * ctx (titres, sous-titres, clés) : { artists: Map clé → fiche } pour nommer l'artiste d'un concert.
 */

const FAMILIES = [['sejour', 'Séjour'], ['restaurant', 'Restaurant'], ['seminaires', 'Séminaires']];
const OFFER_ACTIONS = [['booking', 'Réserver (moteur, avec le code de l’offre)'], ['quote', 'Demander un devis'], ['link', 'Lien vers une page ou une adresse'], ['none', 'Pas de bouton']];
const VENUES = [['selon-meteo', 'Selon la météo'], ['moon-bar', 'Moon Bar (rooftop)'], ['aston-club', 'L’Aston Club (7e étage)']];
const TOPICS = [['sejour', 'Séjour'], ['chambres', 'Chambres'], ['rooftop', 'Rooftop'], ['petit-dejeuner', 'Petit-déjeuner'], ['restaurant', 'Restaurant'], ['seminaire', 'Séminaire']];

export const SPECS = {
  gigs: {
    noun: 'concert', addLabel: 'Ajouter un concert',
    title: (d, fmt, ctx) => ctx?.artists?.get(d.artist)?.name || d.artist || 'Nouveau concert',
    subtitle: (d, fmt) => [d.date ? fmt.fmtDay(d.date) : '', d.time, VENUES.find((v) => v[0] === d.venue)?.[1]].filter(Boolean).join(' · '),
    sort: (a, b) => `${a.merged.date || ''}${a.merged.time || ''}`.localeCompare(`${b.merged.date || ''}${b.merged.time || ''}`),
    key: (d) => [d.date, d.artist].filter(Boolean).join(' '),
    blank: () => ({ date: '', time: '21:00', venue: 'selon-meteo', artist: '', description: '' }),
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true, half: true },
      { key: 'time', label: 'Heure', type: 'time', half: true },
      { key: 'venue', label: 'Lieu', type: 'select', options: VENUES, hint: '« Selon la météo » : au Moon Bar sur le toit quand le temps le permet, sinon à L’Aston Club.' },
      { key: 'artist', label: 'Artiste ou groupe', type: 'ref', source: 'artists', required: true, hint: 'Le style, la présentation, la photo et le site viennent de la fiche artiste.' },
      { key: 'style', label: 'Style de cette soirée', type: 'text', onlyIfSet: true, hint: 'Remplace le style de la fiche artiste pour ce concert. Videz-le pour reprendre celui de la fiche.' },
      { key: 'description', label: 'Précisions sur la soirée (facultatif)', type: 'textarea', hint: 'Vide : la présentation de la fiche artiste est affichée.' },
    ],
    help: 'Les concerts passés disparaissent du site d’eux-mêmes. Chaque concert à venir est aussi déclaré à Google (événement musical, avec l’artiste).',
  },
  artists: {
    noun: 'artiste', addLabel: 'Ajouter un artiste',
    title: (d) => d.name || 'Nouvel artiste',
    subtitle: (d) => [d.style, d.website ? d.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : ''].filter(Boolean).join(' · '),
    sort: (a, b) => String(a.merged.name || '').localeCompare(String(b.merged.name || ''), 'fr'),
    key: (d) => d.name,
    blank: () => ({ name: '', style: '', bio: '', website: '', media: null }),
    fields: [
      { key: 'name', label: 'Nom de l’artiste ou du groupe', type: 'text', required: true },
      { key: 'style', label: 'Style', type: 'text', placeholder: 'ex. soul, pop acoustique, bossa nova' },
      { key: 'bio', label: 'Présentation', type: 'textarea' },
      { key: 'website', label: 'Site internet (facultatif)', type: 'url', placeholder: 'https://…' },
      { key: 'media', label: 'Photo', type: 'image', hint: 'Choisie dans la médiathèque ; affichée en vignette ronde dans le programme.' },
    ],
    help: 'Chaque concert du programme désigne un artiste de cette liste. Masquer un artiste retire aussi ses concerts du site.',
  },
  rooms: {
    noun: 'chambre', addLabel: 'Ajouter une chambre',
    title: (d) => d.name,
    subtitle: (d) => [d.category, d.sizeM2 ? `${d.sizeM2} m²` : '', d.maxGuests ? `${d.maxGuests} pers.` : ''].filter(Boolean).join(' · '),
    fields: [
      { key: 'name', label: 'Nom', type: 'text' },
      { key: 'shortName', label: 'Nom dans une phrase', type: 'text', placeholder: 'ex. la Confort', half: true },
      { key: 'category', label: 'Catégorie', type: 'text', half: true },
      { key: 'h1', label: 'Titre de la page (H1)', type: 'text' },
      { key: 'title', label: 'Title (onglet et Google)', type: 'text', seo: [30, 60] },
      { key: 'metaDescription', label: 'Description pour Google', type: 'textarea', seo: [70, 160] },
      { key: 'sizeM2', label: 'Surface moyenne (m²)', type: 'number', half: true },
      { key: 'maxGuests', label: 'Personnes au plus', type: 'number', half: true },
      { key: 'facts', label: 'Points clés', type: 'list' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'amenities', label: 'Pictogrammes affichés', type: 'tags', source: 'amenities' },
      { key: 'amenitiesFull', label: 'Liste complète des équipements', type: 'list' },
      { key: 'variants', label: 'Variantes de la chambre', type: 'objects', fields: [{ key: 'title', label: 'Titre', type: 'text' }, { key: 'text', label: 'Texte', type: 'textarea' }] },
      { key: 'gallery', label: 'Photos', type: 'objects', fields: [
        { key: 'media', label: 'Photo', type: 'image' }, { key: 'alt', label: 'Texte alternatif', type: 'text' }, { key: 'kind', label: 'Légende courte', type: 'text' }] },
      { key: 'reviewTopic', label: 'Thème des avis affichés sur la fiche', type: 'select', options: TOPICS },
      { key: 'cover', label: 'Photo de couverture (page Chambres et accueil)', type: 'image', hint: 'Vide : la première photo de la fiche.' },
      { key: 'indexName', label: 'Nom sur la page Chambres', type: 'text', half: true, placeholder: 'ex. Confort' },
      { key: 'summary', label: 'Résumé sur la page Chambres', type: 'text', half: true, placeholder: 'ex. 17 à 23 m² · côté cour ou colline' },
      { key: 'onHome', label: 'Afficher dans le carrousel de l’accueil', type: 'checkbox' },
      { key: 'cardTitle', label: 'Titre sur l’accueil', type: 'text', placeholder: 'ex. Chambre Confort' },
      { key: 'cardFacts', label: 'Infos de la carte d’accueil', type: 'objects', fields: [{ key: 'icon', label: 'Pictogramme', type: 'icon' }, { key: 'text', label: 'Texte', type: 'text' }],
        hint: 'Trois infos courtes (surface, lits, vue). Sur la carte s’affichent aussi les 6 premiers pictogrammes ci-dessus, avec leur libellé court.' },
    ],
    help: 'L’ordre des chambres ici est celui de la page Chambres et du carrousel de l’accueil. Masquer une chambre la retire partout ; la supprimer redirige son ancienne adresse vers la page Chambres.',
    blank: () => ({ name: '', category: '', onHome: true, amenities: [], amenitiesFull: [], facts: [], gallery: [], cardFacts: [{ icon: 'i-area', text: '' }, { icon: 'i-bed', text: '' }, { icon: 'i-window', text: '' }] }),
  },
  services: {
    noun: 'service', addLabel: 'Ajouter un service',
    title: (d) => d.name,
    subtitle: (d) => d.lede,
    fields: [
      { key: 'name', label: 'Nom', type: 'text' },
      { key: 'h1', label: 'Titre de la page (H1)', type: 'text' },
      { key: 'title', label: 'Title (onglet et Google)', type: 'text', seo: [30, 60] },
      { key: 'metaDescription', label: 'Description pour Google', type: 'textarea', seo: [70, 160] },
      { key: 'lede', label: 'Chapeau', type: 'textarea' },
      { key: 'body', label: 'Texte', type: 'rich' },
      { key: 'facts', label: 'Informations pratiques', type: 'pairs', labels: ['Intitulé', 'Valeur'] },
      { key: 'faq', label: 'Questions fréquentes', type: 'pairs', labels: ['Question', 'Réponse'] },
      { key: 'photos', label: 'Photos', type: 'objects', fields: [
        { key: 'media', label: 'Photo', type: 'image' }, { key: 'alt', label: 'Texte alternatif', type: 'text' }] },
    ],
  },
  amenities: {
    noun: 'équipement', addLabel: 'Ajouter un équipement',
    title: (d) => d.label,
    subtitle: (d) => d.icon,
    fields: [
      { key: 'label', label: 'Libellé', type: 'text' },
      { key: 'shortLabel', label: 'Libellé court (cartes de l’accueil)', type: 'text', placeholder: 'ex. Clim' },
      { key: 'icon', label: 'Pictogramme', type: 'icon' },
    ],
  },
  offers: {
    noun: 'offre', addLabel: 'Ajouter une offre',
    title: (d) => d.title,
    subtitle: (d) => [Object.fromEntries(FAMILIES)[d.family], [d.price, d.priceNote].filter(Boolean).join(' '), d.onHome ? 'sur l’accueil' : ''].filter(Boolean).join(' · '),
    key: (d) => d.title,
    fields: [
      { key: 'family', label: 'Famille (filtre de la page Offres)', type: 'select', options: FAMILIES, half: true },
      { key: 'tag', label: 'Étiquette', type: 'text', half: true, placeholder: 'ex. Séjour' },
      { key: 'title', label: 'Titre', type: 'text', required: true },
      { key: 'media', label: 'Photo', type: 'image' },
      { key: 'src', label: 'Photo de l’ancien site (en attente d’import)', type: 'text', onlyIfSet: true, hint: 'Remplacée par la photo de la médiathèque au prochain « media:import-site », ou dès qu’une photo est choisie ci-dessus.' },
      { key: 'alt', label: 'Description de la photo (texte alternatif)', type: 'text' },
      { key: 'price', label: 'Prix', type: 'text', half: true, placeholder: 'ex. À partir de 239 €' },
      { key: 'priceNote', label: 'Précision du prix (en petit)', type: 'text', half: true, placeholder: 'ex. la nuit pour 2' },
      { key: 'includes', label: 'Ce qui est compris', type: 'list' },
      { key: 'saving', label: 'Économie', type: 'text', placeholder: 'ex. Économie : 38 € par rapport à la réservation séparée' },
      { key: 'conditions', label: 'Conditions', type: 'text', placeholder: 'ex. Valable toute l’année selon disponibilités · 1 nuit minimum' },
      { key: 'toConfirm', label: 'Prix et conditions à confirmer par l’hôtel', type: 'checkbox', hint: 'Cochée : ces informations ne sont pas reprises dans les données lues par Google et les assistants IA.' },
      { key: 'action', label: 'Bouton', type: 'select', options: OFFER_ACTIONS, half: true },
      { key: 'button', label: 'Texte du bouton', type: 'text', half: true, placeholder: 'ex. Réserver cette offre' },
      { key: 'link', label: 'Adresse du lien (bouton « Lien »)', type: 'text', placeholder: '#/restaurant-horloge?a=reserver-horloge ou https://…', hint: '#/ suivi du nom d’une page du site, ou une adresse complète.' },
      { key: 'checkin', label: 'Arrivée proposée (bouton « Réserver »)', type: 'date', half: true },
      { key: 'checkout', label: 'Départ proposé', type: 'date', half: true },
      { key: 'onHome', label: 'Afficher sur l’accueil', type: 'checkbox' },
      { key: 'teaserTitle', label: 'Titre sur l’accueil', type: 'text', half: true, placeholder: 'Vide : le titre de l’offre' },
      { key: 'teaserText', label: 'Phrase sur l’accueil', type: 'text', half: true, placeholder: 'ex. À L’Horloge, midi et soir' },
    ],
    help: 'L’ordre des offres ici est celui de la page Offres et de l’accueil. Une offre masquée, supprimée ou hors de ses dates d’affichage disparaît du site à la prochaine publication. « Réserver » ouvre le moteur avec le code de l’offre (Réglages, codes tarif).',
    blank: () => ({ family: 'sejour', tag: 'Séjour', title: '', includes: [], action: 'booking', button: 'Réserver cette offre', toConfirm: false, onHome: false }),
  },
  meeting_rooms: {
    noun: 'salle', addLabel: 'Ajouter une salle',
    title: (d) => d.name,
    subtitle: (d) => [d.surface ? `${d.surface} m²` : 'surface à préciser', d.theatre && d.theatre !== '—' ? `${d.theatre} en théâtre` : '', d.detail].filter(Boolean).join(' · '),
    key: (d) => d.name,
    fields: [
      { key: 'name', label: 'Nom de la salle', type: 'text', required: true, placeholder: 'ex. Salon Chagall' },
      { key: 'detail', label: 'Précisions (sous le nom)', type: 'text', placeholder: 'ex. 1er étage · lumière du jour · sonorisation' },
      { key: 'media', label: 'Photo', type: 'image' },
      { key: 'src', label: 'Photo de l’ancien site (en attente d’import)', type: 'text', onlyIfSet: true, hint: 'Remplacée par la photo de la médiathèque au prochain « media:import-site », ou dès qu’une photo est choisie ci-dessus.' },
      { key: 'surface', label: 'Surface (m²)', type: 'text', half: true, placeholder: 'ex. 133', hint: 'Vide : « À préciser ».' },
      { key: 'theatre', label: 'Théâtre (personnes)', type: 'text', half: true, placeholder: 'ex. 200' },
      { key: 'classroom', label: 'Classe', type: 'text', half: true },
      { key: 'ushape', label: 'En U', type: 'text', half: true },
      { key: 'cabaret', label: 'Cabaret', type: 'text', half: true },
      { key: 'banquet', label: 'Banquet', type: 'text', half: true },
    ],
    help: 'L’ordre des salles ici est celui du tableau de la page Séminaires et de la liste « Offre ou salle » du formulaire de devis. Capacités : un nombre, « — » si la configuration n’existe pas, vide pour « Sur demande » (repéré à confirmer). Une salle masquée ou supprimée disparaît des deux à la prochaine publication.',
    blank: () => ({ name: '', detail: '', surface: '', theatre: '', classroom: '', ushape: '', cabaret: '', banquet: '' }),
  },
  reviews: {
    noun: 'avis', addLabel: 'Ajouter un avis',
    title: (d) => `${d.author || 'Avis'} · ${'★'.repeat(Number(d.rating) || 0)}`,
    subtitle: (d) => [d.date, (d.text || '').slice(0, 90)].filter(Boolean).join(' · '),
    sort: (a, b) => String(b.merged.date || '').localeCompare(String(a.merged.date || '')),
    key: (d) => `avis ${d.author || ''} ${d.date || ''}`,
    blank: () => ({ author: '', date: '', rating: 5, topics: [], room: null, text: '', reply: '' }),
    fields: [
      { key: 'author', label: 'Auteur', type: 'text', half: true, placeholder: 'ex. Claire M.' },
      { key: 'date', label: 'Mois du séjour', type: 'month', half: true },
      { key: 'rating', label: 'Note', type: 'select', options: [[5, '5 / 5'], [4, '4 / 5'], [3, '3 / 5'], [2, '2 / 5'], [1, '1 / 5']], number: true, half: true },
      { key: 'room', label: 'Chambre concernée', type: 'select', source: 'rooms', options: [[null, 'Aucune']], half: true },
      { key: 'topics', label: 'Thèmes', type: 'tags', options: TOPICS },
      { key: 'text', label: 'Avis', type: 'textarea' },
      { key: 'reply', label: 'Réponse de l’hôtel', type: 'textarea' },
    ],
    help: 'Les avis restent dans leur langue d’origine : ils ne se traduisent pas.',
  },
  chat: {
    noun: 'réponse', addLabel: 'Ajouter une réponse',
    title: (d) => d.id,
    subtitle: (d, fmt) => fmt.plain(d.answer).slice(0, 100),
    key: (d) => d.id,
    blank: () => ({ id: '', keywords: [], answer: '' }),
    fields: [
      { key: 'id', label: 'Identifiant du sujet', type: 'text', placeholder: 'ex. parking' },
      { key: 'keywords', label: 'Mots déclencheurs', type: 'list', hint: 'Si la question du visiteur contient l’un de ces mots, le chat donne cette réponse.' },
      { key: 'answer', label: 'Réponse', type: 'rich' },
    ],
  },
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Copie par JSON : structuredClone refuse les objets réactifs d'Alpine (Proxy)
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Champ déduit de sa valeur, pour un champ que la description ne connaît pas. */
export function inferField(key, value) {
  let type = 'json';
  if (typeof value === 'string') type = value.length > 80 ? 'textarea' : 'text';
  else if (typeof value === 'number') type = 'number';
  else if (typeof value === 'boolean') type = 'checkbox';
  else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) type = 'list';
  return { key, label: key, type };
}

/** Champs du formulaire : ceux de la description, puis ceux trouvés dans les données. */
export function fieldsFor(collection, data) {
  const all = SPECS[collection]?.fields || [];
  const known = new Set(all.map((f) => f.key));
  const spec = all.filter((f) => !f.onlyIfSet || String(data?.[f.key] ?? '').trim());
  return [...spec, ...Object.keys(data || {}).filter((k) => !known.has(k)).map((k) => inferField(k, data[k]))];
}

/** Un champ (ou un sous-champ d'une liste d'objets) est-il traduisible ? */
export const fieldTranslatable = (paths, key, sub = null) => (sub
  ? paths.includes(`${key}[].${sub}`) || paths.includes(key) || paths.includes(`${key}[]`)
  : paths.includes(key) || paths.includes(`${key}[]`) || paths.some((p) => p.startsWith(`${key}[].`)));

function move(src, dst, segs) {
  if (!isObj(src)) return;
  const [head, ...rest] = segs;
  const isArray = head.endsWith('[]');
  const key = isArray ? head.slice(0, -2) : head;
  if (!(key in src)) return;
  if (!rest.length) {
    dst[key] = src[key];
    delete src[key];
    return;
  }
  if (isArray) {
    if (!Array.isArray(src[key])) return;
    dst[key] ??= src[key].map(() => ({}));
    src[key].forEach((item, i) => move(item, dst[key][i], rest));
  } else {
    dst[key] ??= {};
    move(src[key], dst[key], rest);
  }
}

export function splitTranslatable(item, paths) {
  const base = copy(item);
  const translated = {};
  for (const p of paths) move(base, translated, p.split('.'));
  return { base, translated };
}

export function mergeTranslation(base, tr) {
  if (tr === undefined) return base;
  if (Array.isArray(tr)) {
    if (Array.isArray(base) && tr.length && tr.every(isObj) && base.every(isObj)) return base.map((b, i) => mergeTranslation(b, tr[i]));
    return tr;
  }
  if (isObj(tr) && isObj(base)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(tr)) out[k] = mergeTranslation(base[k], v);
    return out;
  }
  return tr;
}

/**
 * Formulaire de traduction : champs communs + traduction existante ; les champs traduisibles
 * encore absents sont vides (jamais préremplis avec le texte d'origine).
 */
export function translationForm(base, translated, paths, source) {
  const empty = (v) => (Array.isArray(v) ? v.map(empty) : typeof v === 'number' ? null : '');
  const form = mergeTranslation(copy(base), translated ? copy(translated) : undefined);
  for (const p of paths) {
    const [head, sub] = p.split('.');
    const key = head.replace(/\[\]$/, '');
    if (sub) {
      const list = Array.isArray(form[key]) ? form[key] : (source[key] || []).map(() => ({}));
      form[key] = list.map((it, i) => ({ ...it, [sub]: it?.[sub] ?? empty(source[key]?.[i]?.[sub]) }));
    } else if (!(key in form)) {
      form[key] = empty(source[key]);
    }
  }
  return form;
}

/** Champs traduisibles laissés vides alors que le texte d'origine existe (traduction incomplète). */
export function missingTranslations(form, source, fields, paths) {
  const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.some(blank));
  const out = [];
  for (const f of fields) {
    if (f.type === 'objects') {
      for (const sub of f.fields || []) {
        if (!fieldTranslatable(paths, f.key, sub.key)) continue;
        const gap = (source[f.key] || []).some((it, i) => !blank(it?.[sub.key]) && blank(form[f.key]?.[i]?.[sub.key]));
        if (gap) out.push(`${f.label} › ${sub.label}`);
      }
    } else if (fieldTranslatable(paths, f.key) && !blank(source[f.key]) && (blank(form[f.key]) || (Array.isArray(source[f.key]) && form[f.key].length < source[f.key].length))) {
      out.push(f.label);
    }
  }
  return out;
}
