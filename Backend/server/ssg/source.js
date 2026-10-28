/**
 * Lecture du contenu à générer, depuis la base de travail (prévisualisation)
 * ou depuis un snapshot publié (production).
 *
 * Règle des langues :
 *  - langue par défaut : toute valeur enregistrée compte ;
 *  - autres langues : seules les valeurs au statut « ready » comptent en production ;
 *    en prévisualisation, les brouillons s'affichent aussi et les manques
 *    retombent sur la langue par défaut (repérés à l'écran) ;
 *  - bandeaux et popups : jamais masqués faute de traduction, repli sur l'anglais
 *    s'il est prêt, sinon sur la langue par défaut (voir translated).
 */
import { mergeTranslation } from './collections.js';

/** Langue de repli des bandeaux et popups non traduits, avant la langue par défaut. */
const RELAY_LANG = 'en';

const groupBy2 = (rows, k1, k2) => {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r[k1])) map.set(r[k1], {});
    map.get(r[k1])[r[k2]] = r;
  }
  return map;
};

export class Source {
  constructor(db, { mode }) {
    const all = (sql) => db.prepare(sql).all();
    this.mode = mode;
    this.languages = all('SELECT * FROM cms_languages ORDER BY position');
    this.defaultLang = (this.languages.find((l) => l.is_default) || this.languages[0]).code;
    this.activeLangs = this.languages.filter((l) => l.is_active);
    this.settings = Object.fromEntries(all('SELECT key, value FROM cms_settings').map((r) => [r.key, JSON.parse(r.value)]));
    this.pages = all('SELECT * FROM cms_pages WHERE is_active = 1 ORDER BY position, id');
    this.pagesByKey = new Map(this.pages.map((p) => [p.key, p]));
    this.pagesById = new Map(this.pages.map((p) => [p.id, p]));
    this.pageI18n = groupBy2(all('SELECT * FROM cms_page_i18n'), 'page_id', 'lang');
    this.entries = new Map(all('SELECT id, key, type, required FROM cms_entries').map((e) => [e.key, e]));
    this.values = groupBy2(all('SELECT entry_id, lang, value, media_id, status FROM cms_entry_values'), 'entry_id', 'lang');
    this.collections = new Map(all('SELECT * FROM cms_collections').map((c) => [c.key, { ...c, schema: JSON.parse(c.schema) }]));
    this.items = all('SELECT * FROM cms_items WHERE is_active = 1 ORDER BY collection, position, id');
    this.itemI18n = groupBy2(all('SELECT * FROM cms_item_i18n'), 'item_id', 'lang');

    this.media = new Map(all('SELECT * FROM cms_media WHERE deleted_at IS NULL').map((m) => [m.id, m]));
    this.variants = new Map();
    for (const v of all('SELECT * FROM cms_media_variants ORDER BY width')) {
      if (!this.variants.has(v.media_id)) this.variants.set(v.media_id, []);
      this.variants.get(v.media_id).push(v);
    }
    this.mediaI18n = groupBy2(all('SELECT * FROM cms_media_i18n'), 'media_id', 'lang');

    this.zones = new Map(all('SELECT * FROM cms_zones').map((z) => [z.key, z]));
    this.banners = all('SELECT * FROM cms_banners WHERE is_active = 1 ORDER BY priority DESC, id');
    this.bannerI18n = groupBy2(all('SELECT * FROM cms_banner_i18n'), 'banner_id', 'lang');
    this.placements = all('SELECT * FROM cms_banner_placements');
    this.popups = all('SELECT * FROM cms_popups WHERE is_active = 1 ORDER BY priority DESC, id');
    this.popupI18n = groupBy2(all('SELECT * FROM cms_popup_i18n'), 'popup_id', 'lang');
    this.popupPages = all('SELECT * FROM cms_popup_pages');
    this.redirects = all('SELECT * FROM cms_redirects ORDER BY from_path');
  }

  /** Textes d'interface du JavaScript (ui.*) dans une langue, repli sur la langue par défaut. */
  uiStrings(lang) {
    const out = {};
    for (const key of this.entries.keys()) if (key.startsWith('ui.')) out[key] = this.text(key, lang).value;
    return out;
  }

  /** Média prêt à afficher : fiche, variantes, textes alternatifs dans la langue. */
  mediaFor(id, lang) {
    const media = id ? this.media.get(id) : null;
    if (!media || media.status !== 'ready') return null;
    const rows = this.mediaI18n.get(id) || {};
    const row = this.usable(rows[lang], lang) && rows[lang].alt ? rows[lang] : rows[this.defaultLang];
    return { media, variants: this.variants.get(id) || [], alt: row?.alt || '', title: row?.title || '' };
  }

  /**
   * Ligne traduite d'un bandeau / popup. Sans traduction prête dans la langue, le bandeau ou
   * le popup s'affiche quand même : en anglais si l'anglais est prêt, sinon dans la langue par
   * défaut (même règle en production et en prévisualisation, où le repli est signalé).
   */
  translated(map, id, lang) {
    const rows = map.get(id) || {};
    if (this.usable(rows[lang], lang)) return { ...rows[lang], missing: false };
    const relay = this.relay(rows, lang);
    if (relay) return { ...relay, missing: true };
    if (rows[this.defaultLang]) return { ...rows[this.defaultLang], missing: true };
    return null;
  }

  /** Bandeaux d'une zone pour une page, actifs pendant [now, horizon[. */
  bannersFor(zone, pageId, lang, now, horizon) {
    const from = now.toISOString();
    const to = horizon.toISOString();
    return this.banners
      .filter((b) => this.placements.some((p) => p.banner_id === b.id && p.zone === zone && (p.page_id === null || p.page_id === pageId)))
      .filter((b) => (!b.end_at || b.end_at > from) && (!b.start_at || b.start_at < to))
      .map((b) => ({ ...b, i18n: this.translated(this.bannerI18n, b.id, lang) }))
      .filter((b) => b.i18n?.text);
  }

  /** Popup de la page (le plus prioritaire), actif pendant [now, horizon[. */
  popupFor(pageId, lang, now, horizon) {
    const from = now.toISOString();
    const to = horizon.toISOString();
    return this.popups
      .filter((p) => (!p.end_at || p.end_at > from) && (!p.start_at || p.start_at < to))
      .filter((p) => {
        const rules = this.popupPages.filter((r) => r.popup_id === p.id);
        const includes = rules.filter((r) => r.mode === 'include');
        if (rules.some((r) => r.mode === 'exclude' && r.page_id === pageId)) return false;
        return !includes.length || includes.some((r) => r.page_id === null || r.page_id === pageId);
      })
      .map((p) => ({ ...p, i18n: this.translated(this.popupI18n, p.id, lang) }))
      .find((p) => p.i18n?.title);
  }

  lang(code) {
    return this.languages.find((l) => l.code === code);
  }

  /** Traduction de relais d'une langue sans la sienne : l'anglais, s'il est prêt (sinon la langue par défaut). */
  relay(rows, lang) {
    const row = rows[RELAY_LANG];
    return lang !== RELAY_LANG && lang !== this.defaultLang && row?.status === 'ready' && this.lang(RELAY_LANG) ? row : null;
  }

  /** Une valeur traduite compte-t-elle pour cette langue ? */
  usable(row, lang) {
    if (!row) return false;
    if (lang === this.defaultLang || this.mode === 'preview') return true;
    return row.status === 'ready';
  }

  /** Texte d'une clé data-cms-* : { value, missing, unknown }. */
  text(key, lang) {
    const entry = this.entries.get(key);
    if (!entry) return { value: '', unknown: true, missing: true };
    const rows = this.values.get(entry.id) || {};
    const row = rows[lang];
    if (this.usable(row, lang) && row.value !== null && row.value !== '') return { value: row.value, missing: false };
    const fallback = rows[this.defaultLang];
    return { value: fallback?.value ?? '', missing: true };
  }

  /** Données SEO d'une page dans une langue (repli sur la langue par défaut en prévisualisation). */
  pageMeta(page, lang) {
    const rows = this.pageI18n.get(page.id) || {};
    const row = rows[lang];
    if (this.usable(row, lang) && row.slug !== null) return { ...row, missing: false };
    const def = rows[this.defaultLang];
    if (!def) return null;
    return { ...def, lang, path: def.slug ? `/${lang}/${def.slug}/` : `/${lang}/`, missing: true };
  }

  /**
   * Éléments actifs d'une collection, fusionnés dans la langue (dates de début / fin respectées).
   * Sans traduction utilisable, l'élément s'affiche en anglais s'il y est prêt, sinon dans la langue par défaut.
   */
  collectionItems(collection, lang, now = new Date()) {
    const iso = now.toISOString();
    return this.items
      .filter((it) => it.collection === collection)
      .filter((it) => (!it.start_at || it.start_at <= iso) && (!it.end_at || it.end_at > iso))
      .map((it) => {
        const rows = this.itemI18n.get(it.id) || {};
        const own = this.usable(rows[lang], lang) ? rows[lang] : null;
        const def = rows[this.defaultLang];
        const relay = own ? null : this.relay(rows, lang);
        const tr = own || def;
        let data = mergeTranslation(JSON.parse(it.data), tr ? JSON.parse(tr.data) : undefined);
        if (relay) data = mergeTranslation(data, JSON.parse(relay.data));
        return { id: it.id, key: it.key, slug: tr?.slug || it.key, missing: !own, data };
      });
  }
}
