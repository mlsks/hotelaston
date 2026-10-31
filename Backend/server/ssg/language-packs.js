/**
 * Langues livrées toutes traduites (seeds/langues/<code>.json) : finnois, polonais, thaï, indonésien.
 *
 * Un paquet contient la langue (nom, locale, langue du moteur de réservation), l'adresse traduite
 * des pages et des fiches, et un dictionnaire « texte français → traduction ». Au démarrage, chaque
 * paquet pas encore appliqué à cette base :
 *   - crée la langue si elle n'existe pas, désactivée comme depuis l'écran Langues : l'activer, puis Publier ;
 *   - traduit, à partir du français de CETTE base, les textes, pages, fiches, médias, bandeaux et
 *     popups qui n'ont pas encore de traduction dans cette langue. Un texte dont le français a été
 *     modifié depuis n'est pas dans le dictionnaire : il reste à traduire (le site affiche alors
 *     l'anglais ou le français, voir source.js) ;
 *   - ne remplace jamais une traduction existante.
 * Une fiche ou une page dont un seul champ manque arrive en brouillon, avec le français à sa place.
 * Le paquet est noté comme appliqué (réglage language_pack.<code>) : une traduction supprimée
 * ensuite dans l'admin ne revient pas au redémarrage. Pour réappliquer un paquet :
 * supprimer ce réglage, puis relancer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha, nowIso, collapse, hasLetter, isPlainObject } from '../lib/util.js';
import { pageSourceHash, valueHash } from '../routes/helpers.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seeds', 'langues');
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Version des paquets : l'augmenter pour compléter une base où une version précédente est déjà passée. */
export const PACK_VERSION = 1;

export function readLanguagePacks(dir = DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .sort((a, b) => (a.language?.order ?? 99) - (b.language?.order ?? 99)); // ordre du sélecteur de langues
}

/** Traducteur d'un paquet : texte exact, sinon texte aux espaces normalisés ; undefined si inconnu. */
function translator(texts) {
  const loose = new Map(Object.entries(texts).map(([fr, t]) => [collapse(fr).trim(), t]));
  return (fr) => {
    if (typeof fr !== 'string') return fr;
    const t = texts[fr] ?? loose.get(collapse(fr).trim());
    if (t !== undefined) return t;
    // sans mot à traduire (numéro, adresse e-mail, lien) : repris tel quel
    if (!hasLetter(fr.replace(/<[^>]+>/g, '').replace(/https?:\S+|\S+@\S+/g, ''))) return fr;
    return undefined;
  };
}

/** Traduit toutes les chaînes d'une structure ; missing compte celles qui restent en français. */
function translateDeep(value, tr, stats) {
  if (typeof value === 'string') {
    const t = tr(value);
    if (t === undefined) { stats.missing += 1; return value; }
    return t;
  }
  if (Array.isArray(value)) return value.map((v) => translateDeep(v, tr, stats));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, translateDeep(v, tr, stats)]));
  return value;
}

/**
 * Textes alternatifs des photos absents dans la langue : repris à chaque démarrage, car les photos du
 * site s'importent souvent après la première mise en route (node server/cli.js media:import-site).
 */
function translateMedia(db, code, tr, def, count) {
  const insMedia = db.prepare(`INSERT INTO cms_media_i18n (media_id, lang, alt, title, caption, status) VALUES (?, ?, ?, ?, ?, 'ready')
    ON CONFLICT (media_id, lang) DO NOTHING`);
  for (const r of db.prepare(`SELECT t.* FROM cms_media_i18n t JOIN cms_media m ON m.id = t.media_id
      WHERE t.lang = ? AND m.deleted_at IS NULL AND (COALESCE(t.alt, '') <> '' OR COALESCE(t.title, '') <> '' OR COALESCE(t.caption, '') <> '')
        AND NOT EXISTS (SELECT 1 FROM cms_media_i18n x WHERE x.media_id = t.media_id AND x.lang = ?)`).all(def, code)) {
    const stats = { missing: 0 };
    const [alt, title, caption] = [r.alt, r.title, r.caption].map((v) => (v ? translateDeep(v, tr, stats) : v));
    if (stats.missing) { count.manquants += 1; continue; }
    count.medias += insMedia.run(r.media_id, code, alt, title, caption).changes;
  }
}

export function applyLanguagePack(db, pack, { def }) {
  const code = pack.language.code;
  const tr = translator(pack.texts);
  const now = nowIso();
  const count = { textes: 0, pages: 0, fiches: 0, medias: 0, bandeaux: 0, popups: 0, brouillons: 0, manquants: 0 };

  if (!db.prepare('SELECT 1 FROM cms_languages WHERE code = ?').get(code)) {
    const position = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 FROM cms_languages').pluck().get();
    const { name, native_name, locale, booking_lang } = pack.language;
    db.prepare(`INSERT INTO cms_languages (code, name, native_name, locale, booking_lang, is_default, is_active, position)
      VALUES (?, ?, ?, ?, ?, 0, 0, ?)`).run(code, name, native_name, locale, booking_lang, position);
  }

  // Textes (entrées) : seulement ceux dont le français est connu du paquet
  const insValue = db.prepare(`INSERT INTO cms_entry_values (entry_id, lang, value, status, source_hash, updated_at)
    VALUES (?, ?, ?, 'ready', ?, ?) ON CONFLICT (entry_id, lang) DO NOTHING`);
  for (const r of db.prepare(`SELECT e.id, v.value FROM cms_entries e JOIN cms_entry_values v ON v.entry_id = e.id AND v.lang = ?
      WHERE e.translatable = 1 AND e.type IN ('text', 'richtext') AND v.value IS NOT NULL AND v.value <> ''`).all(def)) {
    const t = tr(r.value);
    if (t === undefined) { count.manquants += 1; continue; }
    count.textes += insValue.run(r.id, code, t, valueHash(r.value), now).changes;
  }

  // Pages : adresse traduite, title et description
  const pathTaken = db.prepare('SELECT 1 FROM cms_page_i18n WHERE lang = ? AND path = ?');
  const hasPage = db.prepare('SELECT 1 FROM cms_page_i18n WHERE page_id = ? AND lang = ?');
  const insPage = db.prepare(`INSERT INTO cms_page_i18n (page_id, lang, slug, path, nav_label, title, meta_description, og_title, og_description,
      og_image_id, noindex, focus_keyword, status, source_hash, updated_at)
    VALUES (@page_id, @lang, @slug, @path, @nav_label, @title, @meta_description, @og_title, @og_description,
      @og_image_id, @noindex, @focus_keyword, @status, @source_hash, @updated_at)`);
  for (const r of db.prepare(`SELECT p.key, t.* FROM cms_pages p JOIN cms_page_i18n t ON t.page_id = p.id AND t.lang = ?`).all(def)) {
    if (hasPage.get(r.page_id, code)) continue;
    const stats = { missing: 0 };
    const field = (v) => (v === null || v === '' ? v : translateDeep(v, tr, stats));
    const row = {
      page_id: r.page_id, lang: code, nav_label: field(r.nav_label), title: field(r.title), meta_description: field(r.meta_description) ?? '',
      og_title: field(r.og_title), og_description: field(r.og_description), og_image_id: r.og_image_id, noindex: r.noindex,
      focus_keyword: field(r.focus_keyword), source_hash: pageSourceHash(r), updated_at: now,
    };
    let slug = r.key === 'accueil' ? '' : (pack.pages[r.key] ?? (SLUG.test(r.slug ?? '') ? r.slug : r.key));
    let p = slug ? `/${code}/${slug}/` : `/${code}/`;
    for (let n = 2; pathTaken.get(code, p); n += 1) { slug = `${pack.pages[r.key] ?? r.key}-${n}`; p = `/${code}/${slug}/`; }
    if (!slug && r.key !== 'accueil') continue;
    row.slug = slug;
    row.path = p;
    row.status = stats.missing ? 'draft' : 'ready';
    if (stats.missing) count.brouillons += 1;
    count.pages += insPage.run(row).changes;
  }

  // Fiches (chambres, services, offres, cartes, chat…) : les champs traduits, chaîne par chaîne
  const insItem = db.prepare(`INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (item_id, lang) DO NOTHING`);
  for (const r of db.prepare(`SELECT i.id, i.collection, i.key, c.item_template, t.slug, t.data FROM cms_items i
      JOIN cms_collections c ON c.key = i.collection JOIN cms_item_i18n t ON t.item_id = i.id AND t.lang = ?`).all(def)) {
    const stats = { missing: 0 };
    const data = translateDeep(JSON.parse(r.data), tr, stats);
    const wanted = pack.items[`${r.collection}/${r.key}`];
    const slug = r.item_template ? (wanted && SLUG.test(wanted) ? wanted : r.slug || r.key) : null;
    const changes = insItem.run(r.id, code, slug, JSON.stringify(data), stats.missing ? 'draft' : 'ready', sha(r.data), now).changes;
    count.fiches += changes;
    if (changes && stats.missing) count.brouillons += 1;
  }

  translateMedia(db, code, tr, def, count);

  // Bandeaux et popups
  const insBanner = db.prepare(`INSERT INTO cms_banner_i18n (banner_id, lang, text, cta_label, cta_url, status, source_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (banner_id, lang) DO NOTHING`);
  for (const r of db.prepare('SELECT * FROM cms_banner_i18n WHERE lang = ?').all(def)) {
    const stats = { missing: 0 };
    const text = translateDeep(r.text, tr, stats);
    const cta = r.cta_label ? translateDeep(r.cta_label, tr, stats) : r.cta_label;
    if (stats.missing) { count.manquants += 1; continue; }
    count.bandeaux += insBanner.run(r.banner_id, code, text, cta, r.cta_url, 'ready', sha(`${r.text}\n${r.cta_label ?? ''}`)).changes;
  }
  const insPopup = db.prepare(`INSERT INTO cms_popup_i18n (popup_id, lang, title, body, cta_label, cta_kind, cta_target, status, source_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (popup_id, lang) DO NOTHING`);
  for (const r of db.prepare('SELECT * FROM cms_popup_i18n WHERE lang = ?').all(def)) {
    if (!r.title && !r.body && !r.cta_kind) continue; // popup d'une offre : il reprend les textes de l'offre
    const stats = { missing: 0 };
    const [title, body, cta] = [r.title, r.body, r.cta_label].map((v) => (v ? translateDeep(v, tr, stats) : v));
    if (stats.missing) { count.manquants += 1; continue; }
    count.popups += insPopup.run(r.popup_id, code, title, body, cta, r.cta_kind, r.cta_target, 'ready',
      sha(`${r.title}\n${r.body ?? ''}\n${r.cta_label ?? ''}`)).changes;
  }
  return count;
}

/** Applique au démarrage les paquets de langue pas encore passés sur cette base. */
export function ensureLanguagePacks(db, { packs = readLanguagePacks(), log = console.log } = {}) {
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  if (!def) return [];
  // Base encore vide (avant l'import du contenu) : rien à traduire, on repassera au prochain démarrage
  if (!db.prepare('SELECT 1 FROM cms_page_i18n WHERE lang = ? LIMIT 1').get(def)) return [];
  const getSetting = db.prepare('SELECT value FROM cms_settings WHERE key = ?').pluck();
  const setSetting = db.prepare(`INSERT INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
  const done = [];
  for (const pack of packs) {
    const code = pack.language?.code;
    if (!code || code === def) continue;
    const key = `language_pack.${code}`;
    const seen = getSetting.get(key);
    if (seen && JSON.parse(seen).version >= PACK_VERSION) {
      if (db.prepare('SELECT 1 FROM cms_languages WHERE code = ?').get(code)) {
        const c = { medias: 0, manquants: 0 };
        translateMedia(db, code, translator(pack.texts), def, c);
        if (c.medias) log?.(`Langue ${code} : ${c.medias} textes de photos traduits`);
      }
      continue;
    }
    const count = db.transaction(() => {
      const c = applyLanguagePack(db, pack, { def });
      setSetting.run(key, JSON.stringify({ version: PACK_VERSION, applied_at: nowIso(), ...c }), nowIso());
      return c;
    })();
    done.push({ code, ...count });
    log?.(`Langue ${code} (${pack.language.native_name}) : ${count.textes} textes, ${count.pages} pages, ${count.fiches} fiches, `
      + `${count.medias} photos, ${count.bandeaux} bandeaux, ${count.popups} popups traduits`
      + (count.brouillons ? ` ; ${count.brouillons} en brouillon` : '')
      + (count.manquants ? ` ; ${count.manquants} textes modifiés depuis, à traduire dans l'admin` : ''));
  }
  return done;
}
