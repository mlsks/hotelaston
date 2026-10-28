/**
 * Offres de la page Offres et des aperçus de l'accueil : construites depuis les fiches de la
 * collection « offers », dans leur ordre ; une fiche masquée, supprimée ou hors de ses dates
 * d'affichage disparaît partout.
 *
 * Dans un gabarit : <… data-cms-offers="page|home"> dont le premier enfant sert de modèle,
 * avec des emplacements data-f (card, media, tag, title, price, includes, saving, conditions,
 * button ; teaser, teaserTitle, teaserText sur l'accueil).
 * Champs de la fiche : family (sejour, restaurant, seminaires), media, toConfirm, action
 * (booking, quote, link, none), link, checkin, checkout, onHome ; traduits : tag, title, alt,
 * price, priceNote, includes[], saving, conditions, button, teaserTitle, teaserText.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { pictureHtml } from './media-render.js';
import { nowIso, sha } from '../lib/util.js';
import { COLLECTIONS, splitTranslatable } from './collections.js';

export const OFFERS = 'offers';
export const FAMILIES = ['sejour', 'restaurant', 'seminaires'];
export const ACTIONS = ['booking', 'quote', 'link', 'none'];
const SEEDED = 'offer_cards';
const SEED_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seeds', 'offres.json');

/** Texte d'un fragment HTML (balises retirées, entités décodées, espaces resserrés). */
const plain = (html) => cheerio.load(`<div>${String(html ?? '')}</div>`, null, false)('div').text().replace(/\s+/g, ' ').trim();

/**
 * Reprise, une fois, des offres écrites dans les gabarits (page Offres, accueil) dans des fiches,
 * traductions comprises ; les textes repris sont retirés. Sans effet tant que le site n'est pas importé.
 */
export function ensureOffers(db) {
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  if (!def || !fs.existsSync(SEED_FILE) || db.prepare('SELECT 1 FROM cms_settings WHERE key = ?').get(SEEDED)) return 0;
  if (!db.prepare('SELECT 1 FROM cms_collections WHERE key = ?').get(OFFERS)) return 0;
  const { offers } = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const entryId = db.prepare('SELECT id FROM cms_entries WHERE key = ?').pluck();
  if (!entryId.get(offers[0].title)) return 0; // site pas encore importé
  const values = db.prepare('SELECT lang, value, media_id, status, source_hash FROM cms_entry_values WHERE entry_id = ?');
  const now = nowIso();
  let done = 0;

  /** Valeurs d'un texte par langue : { lang: { value, media_id, ready, upToDate } }. */
  const read = (key) => {
    const id = key && entryId.get(key);
    const rows = id ? values.all(id) : [];
    const fr = rows.find((r) => r.lang === def);
    const out = {};
    for (const r of rows) {
      if (r.lang !== def && !r.value) continue;
      out[r.lang] = { value: r.value, media_id: r.media_id, ready: r.lang === def || r.status === 'ready', upToDate: r.lang === def || !r.source_hash || r.source_hash === sha(String(fr?.value ?? '')) };
    }
    return out;
  };

  db.transaction(() => {
    const exists = db.prepare('SELECT 1 FROM cms_items WHERE collection = ? AND key = ?');
    const insItem = db.prepare('INSERT INTO cms_items (collection, key, data, is_active, position, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)');
    const insI18n = db.prepare('INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)');
    const remove = [];
    let position = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) FROM cms_items WHERE collection = ?').pluck().get(OFFERS);
    for (const seed of offers) {
      const texts = {
        tag: read(seed.tag), title: read(seed.title), alt: read(seed.alt), saving: read(seed.saving), conditions: read(seed.conditions), button: read(seed.button),
        ...(seed.home ? { teaserTitle: read(seed.home.title), teaserText: read(seed.home.text) } : {}),
      };
      const includes = seed.includes.map(read);
      const priceParts = seed.price.map((p) => (p.key ? { ...p, values: read(p.key) } : p));
      const keys = [seed.photo, seed.tag, seed.title, seed.alt, seed.saving, seed.conditions, seed.button, ...seed.includes,
        ...seed.price.filter((p) => p.key).map((p) => p.key), ...(seed.home ? [seed.home.tag, seed.home.title, seed.home.text] : [])];
      remove.push(...keys);
      if (exists.get(OFFERS, seed.key)) continue;

      /** Données d'une langue : textes de cette langue seulement (ou rien). */
      const build = (lang) => {
        const used = [];
        const pick = (v) => {
          if (v?.[lang]) used.push(v[lang]);
          return v?.[lang] ? plain(v[lang].value) : undefined;
        };
        const data = {};
        for (const [field, v] of Object.entries(texts)) {
          const t = pick(v);
          if (t !== undefined) data[field] = t;
        }
        const inc = includes.map(pick);
        if (inc.some((t) => t !== undefined)) data.includes = inc.map((t) => t ?? '');
        // Prix : les montants en grand, les <small> (« la nuit pour 2 »…) en précision du prix
        const chunk = (parts, sep) => parts.map((p) => (p.key ? pick(p.values) ?? '' : p.text)).join(sep).replace(/\s+/g, ' ').trim();
        if (priceParts.some((p) => p.key && p.values[lang])) {
          data.price = chunk(priceParts.filter((p) => p.tag !== 'small'), '');
          const note = chunk(priceParts.filter((p) => p.tag === 'small'), ' · ');
          if (note) data.priceNote = note;
        }
        return { data, used };
      };

      const fr = build(def);
      const media = read(seed.photo)[def]?.media_id || null;
      const base = {
        family: seed.family, media, ...(media ? {} : { src: seed.photoUrl }), toConfirm: seed.toConfirm, action: seed.action,
        link: seed.link, checkin: seed.checkin, checkout: seed.checkout, onHome: Boolean(seed.home),
      };
      const frData = JSON.stringify(splitTranslatable(fr.data, COLLECTIONS[OFFERS].translatable).translated);
      const id = insItem.run(OFFERS, seed.key, JSON.stringify(base), position++, now, now).lastInsertRowid;
      insI18n.run(id, def, frData, 'ready', sha(frData), now);
      const frUsed = fr.used.length;
      const langs = new Set(Object.values(texts).flatMap((v) => Object.keys(v)).filter((l) => l !== def));
      for (const lang of langs) {
        const tr = build(lang);
        if (!tr.used.length) continue;
        // Traduction complète, prête et à jour : prête ; sinon brouillon (ou « à revoir » si dépassée)
        const complete = tr.used.length >= frUsed;
        const ready = complete && tr.used.every((v) => v.ready);
        const upToDate = tr.used.every((v) => v.upToDate);
        insI18n.run(id, lang, JSON.stringify(tr.data), ready ? 'ready' : 'draft', upToDate ? sha(frData) : '', now);
      }
      done += 1;
    }
    const del = db.prepare('DELETE FROM cms_entries WHERE key = ?');
    for (const key of remove.filter(Boolean)) del.run(key);
    db.prepare('INSERT INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)').run(SEEDED, 'true', now);
  })();
  return done;
}

/** Bouton d'une offre : moteur de réservation avec le code de l'offre, devis, lien ou rien. */
function fillButton($, btn, key, r) {
  btn.text(r.button || '');
  if (r.action === 'none' || !r.button) return btn.remove();
  if (r.action === 'quote') return btn.attr('href', `#/devis?offre=${key}`);
  if (r.action === 'link') {
    const href = String(r.link || '').trim();
    if (!href) return btn.remove();
    btn.attr('href', href);
    if (/^https?:/.test(href)) btn.attr({ target: '_blank', rel: 'noopener' });
    return btn;
  }
  btn.attr({ href: '#/reserver', 'data-book': '', 'data-offer-id': key });
  if (r.checkin) btn.attr('data-checkin', r.checkin);
  if (r.checkout) btn.attr('data-checkout', r.checkout);
  return btn;
}

/** Remplit les listes d'offres d'une page (avant l'injection des textes). */
export function renderOfferCards($, { source, lang, now, cdn = '' }) {
  const lists = $('[data-cms-offers]');
  const quote = $('select[data-quote-offer]');
  if (!lists.length && !quote.length) return;
  const offers = source.collectionItems(OFFERS, lang, now);
  // Formulaire de devis : une offre « Demander un devis » ajoutée figure dans la liste des demandes
  quote.each((i, el) => {
    const select = $(el);
    const quoteKeys = offers.filter((o) => o.data.action === 'quote').map((o) => o.key);
    const known = new Set(select.find('option').map((j, o) => o.attribs.value).get());
    let after = select.find('option').filter((j, o) => quoteKeys.includes(o.attribs.value)).last();
    if (!after.length) after = select.find('option').first();
    for (const o of offers.filter((x) => x.data.action === 'quote' && !known.has(x.key))) {
      const option = $('<option>').attr('value', o.key).text(o.data.title || o.key);
      if (after.length) after.after(option);
      else select.append(option);
      after = option;
    }
  });
  lists.each((i, el) => {
    const list = $(el);
    const kind = list.attr('data-cms-offers');
    list.removeAttr('data-cms-offers');
    const model = list.children().first().clone();
    list.children().remove();
    const shown = offers.filter((o) => kind !== 'home' || o.data.onHome);
    for (const offer of shown) {
      const r = offer.data;
      const card = model.clone();
      const slot = (name) => card.find(`[data-f="${name}"]`).addBack(`[data-f="${name}"]`).removeAttr('data-f');
      const family = FAMILIES.includes(r.family) ? r.family : 'sejour';
      slot('card').attr('data-family', family);
      slot('teaser').attr('href', `#/offres?famille=${family}`);
      const img = slot('media');
      const info = source.mediaFor(r.media, lang);
      if (info) img.replaceWith(pictureHtml({ ...info, alt: r.alt ?? info.alt }, { sizes: img.attr('data-cms-sizes') || '100vw', loading: 'lazy', portrait: false }));
      else if (r.src) img.removeAttr('data-cms-sizes').attr({ src: /^https?:/.test(r.src) ? r.src : cdn + r.src, alt: r.alt || '' });
      else img.remove();
      slot('tag').text(r.tag || '');
      slot('title').text(r.title || '');
      slot('teaserTitle').text(r.teaserTitle || r.title || '');
      slot('teaserText').text(r.teaserText || '');
      // Prix, économie et conditions encore à confirmer par l'hôtel : marqués .verify (pas de données structurées)
      const esc = (text) => $('<i>').text(text).html();
      const mark = (text) => (r.toConfirm ? `<span class="verify">${esc(text)}</span>` : esc(text));
      const price = slot('price');
      if (r.price || r.priceNote) price.html([r.price ? mark(r.price) : '', r.priceNote ? `<small>${esc(r.priceNote)}</small>` : ''].filter(Boolean).join(' '));
      else price.remove();
      const includes = slot('includes').empty().append((r.includes || []).filter(Boolean).map((t) => $('<li>').text(t)));
      if (!includes.children().length) includes.remove();
      for (const field of ['saving', 'conditions']) {
        const p = slot(field);
        if (r[field]) p.html(mark(r[field]));
        else p.remove();
      }
      fillButton($, slot('button'), offer.key, r);
      list.append('\n', card);
    }
    list.append('\n');
    if (kind === 'home' && !shown.length) list.closest('section').remove();
    if (kind === 'page') {
      // Filtres sans offre : retirés
      const families = new Set(shown.map((o) => o.data.family));
      list.parent().find('[data-filter]').each((j, b) => {
        if (b.attribs['data-filter'] !== 'all' && !families.has(b.attribs['data-filter'])) $(b).remove();
      });
    }
  });
}
