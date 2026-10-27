/**
 * Collections : description des champs pour les formulaires de l'admin, et séparation
 * champs communs / champs traduits (même logique que server/ssg/collections.js).
 *
 * Types de champ : text, textarea, rich, number, date, time, month, select, checkbox,
 * list (liste de textes), pairs (liste de paires), objects (liste d'objets), tags (choix multiples), image, json.
 */

const VENUES = [['selon-meteo', 'Selon la météo'], ['moon-bar', 'Moon Bar (rooftop)'], ['aston-club', 'L’Aston Club (7e étage)']];
const TOPICS = [['sejour', 'Séjour'], ['chambres', 'Chambres'], ['rooftop', 'Rooftop'], ['petit-dejeuner', 'Petit-déjeuner'], ['restaurant', 'Restaurant'], ['seminaire', 'Séminaire']];

export const SPECS = {
  gigs: {
    noun: 'concert', addLabel: 'Ajouter un concert',
    title: (d) => d.artist || 'Nouveau concert',
    subtitle: (d, fmt) => [d.date ? fmt.fmtDay(d.date) : '', d.time, VENUES.find((v) => v[0] === d.venue)?.[1]].filter(Boolean).join(' · '),
    sort: (a, b) => `${a.merged.date || ''}${a.merged.time || ''}`.localeCompare(`${b.merged.date || ''}${b.merged.time || ''}`),
    key: (d) => [d.date, d.artist].filter(Boolean).join(' '),
    blank: () => ({ date: '', time: '21:00', venue: 'selon-meteo', artist: '', style: '', description: '' }),
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true, half: true },
      { key: 'time', label: 'Heure', type: 'time', half: true },
      { key: 'venue', label: 'Lieu', type: 'select', options: VENUES, hint: '« Selon la météo » : au Moon Bar sur le toit quand le temps le permet, sinon à L’Aston Club.' },
      { key: 'artist', label: 'Artiste ou groupe', type: 'text', required: true },
      { key: 'style', label: 'Style', type: 'text', placeholder: 'ex. soul, pop acoustique, bossa nova' },
      { key: 'description', label: 'Présentation (facultatif)', type: 'textarea' },
    ],
    help: 'Les concerts passés disparaissent du site d’eux-mêmes. Chaque concert à venir est aussi déclaré à Google (événement musical).',
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
        { key: 'src', label: 'Fichier', type: 'image' }, { key: 'alt', label: 'Texte alternatif', type: 'text' }, { key: 'kind', label: 'Légende courte', type: 'text' },
        { key: 'w', label: 'Largeur', type: 'number' }, { key: 'h', label: 'Hauteur', type: 'number' }] },
      { key: 'reviewTopic', label: 'Thème des avis affichés sur la fiche', type: 'select', options: TOPICS },
    ],
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
        { key: 'src', label: 'Fichier', type: 'image' }, { key: 'alt', label: 'Texte alternatif', type: 'text' },
        { key: 'w', label: 'Largeur', type: 'number' }, { key: 'h', label: 'Hauteur', type: 'number' }] },
    ],
  },
  amenities: {
    noun: 'équipement', addLabel: 'Ajouter un équipement',
    title: (d) => d.label,
    subtitle: (d) => d.icon,
    fields: [
      { key: 'label', label: 'Libellé', type: 'text' },
      { key: 'icon', label: 'Pictogramme', type: 'icon' },
    ],
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
      { key: 'room', label: 'Chambre concernée', type: 'select', options: [[null, 'Aucune'], ['confort', 'Confort'], ['deluxe', 'Deluxe'], ['premium', 'Premium'], ['privilege', 'Privilège'], ['exclusive', 'Exclusive'], ['suites', 'Suites']], half: true },
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
  const spec = SPECS[collection]?.fields || [];
  const known = new Set(spec.map((f) => f.key));
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
