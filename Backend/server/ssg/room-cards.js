/**
 * Chambres sur la page Chambres et dans le carrousel de l'accueil : construites depuis les fiches
 * de la collection « rooms », dans leur ordre ; une fiche masquée ou supprimée disparaît partout.
 *
 * Dans un gabarit : <… data-cms-rooms="index|home"> dont le premier enfant sert de modèle,
 * avec des emplacements data-f (link, cover, name, summary, title, facts, media, amenities, discover, book).
 * Champs de la fiche : cover (photo), onHome (false = pas sur l'accueil), indexName et summary
 * (ligne de la page Chambres), cardTitle et cardFacts[] { icon, text } (carte de l'accueil) ;
 * les 6 premiers pictogrammes de la fiche s'affichent sur la carte, avec leur libellé court (shortLabel).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pictureHtml } from './media-render.js';
import { nowIso, sha } from '../lib/util.js';

const SEEDED = 'room_cards';
const SEED_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seeds', 'chambres-cartes.json');
const HOME_AMENITIES = 6;

/**
 * Reprise, une fois, des cartes écrites dans les gabarits (page Chambres, accueil) dans les fiches :
 * photo, résumé, titre et infos de la carte, libellés courts des pictogrammes, traductions comprises.
 * Les textes repris sont retirés ; restent ceux des boutons, communs à toutes les cartes.
 */
export function ensureRoomCards(db) {
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  if (!def || !fs.existsSync(SEED_FILE) || db.prepare('SELECT 1 FROM cms_settings WHERE key = ?').get(SEEDED)) return 0;
  const itemOf = db.prepare("SELECT * FROM cms_items WHERE collection = 'rooms' AND key = ?");
  if (!db.prepare("SELECT 1 FROM cms_items WHERE collection = 'rooms'").get()) return 0; // site pas encore importé
  const { rooms } = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const entryId = db.prepare('SELECT id FROM cms_entries WHERE key = ?').pluck();
  const values = db.prepare('SELECT lang, value, media_id, status, source_hash FROM cms_entry_values WHERE entry_id = ?');
  const rowsOf = db.prepare('SELECT * FROM cms_item_i18n WHERE item_id = ?');
  const now = nowIso();
  let done = 0;

  /** Valeurs d'un texte par langue : { lang: { value, media_id, upToDate } } (traductions à jour du français ou non). */
  const read = (key) => {
    const id = key && entryId.get(key);
    const rows = id ? values.all(id) : [];
    const fr = rows.find((r) => r.lang === def);
    const out = {};
    for (const r of rows) {
      if (r.lang !== def && !r.value) continue;
      out[r.lang] = { value: r.value, media_id: r.media_id, upToDate: r.lang === def || !r.source_hash || r.source_hash === sha(String(fr?.value ?? '')) };
    }
    return out;
  };
  const plain = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  /** Ligne de la page Chambres : « <strong>Nom</strong> résumé ». */
  const splitIndex = (html) => {
    const m = /<strong>([\s\S]*?)<\/strong>([\s\S]*)/.exec(String(html || ''));
    return m ? { indexName: plain(m[1]), summary: plain(m[2]) } : { summary: plain(html) };
  };

  /**
   * Ajoute des champs à une fiche, langue par langue. Une traduction à jour avant la reprise le reste
   * si les textes repris l'étaient aussi ; sinon elle passe « à revoir ».
   */
  function addFields(item, base, perLang) {
    db.prepare('UPDATE cms_items SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(item.data), ...base }), now, item.id);
    const rows = Object.fromEntries(rowsOf.all(item.id).map((r) => [r.lang, r]));
    if (!rows[def]) return;
    const oldHash = sha(rows[def].data);
    const frData = JSON.stringify({ ...JSON.parse(rows[def].data), ...perLang(def).data });
    db.prepare('UPDATE cms_item_i18n SET data = ?, source_hash = ? WHERE item_id = ? AND lang = ?').run(frData, sha(frData), item.id, def);
    for (const [lang, row] of Object.entries(rows)) {
      if (lang === def) continue;
      const add = perLang(lang);
      const data = JSON.stringify({ ...JSON.parse(row.data), ...add.data });
      const upToDate = row.source_hash === oldHash && add.upToDate;
      db.prepare('UPDATE cms_item_i18n SET data = ?, source_hash = ? WHERE item_id = ? AND lang = ?').run(data, upToDate ? sha(frData) : row.source_hash, item.id, lang);
    }
  }

  db.transaction(() => {
    const amenityIcons = new Map(db.prepare("SELECT key, json_extract(data, '$.icon') AS icon FROM cms_items WHERE collection = 'amenities'").all().map((a) => [a.key, a.icon]));
    const shortLabels = new Map(); // amenity → texte de l'accueil
    const remove = [];
    rooms.forEach((seed, n) => {
      const item = itemOf.get(seed.key);
      const keys = [seed.index, seed.photo, seed.homePhoto, seed.title, ...seed.facts.map((f) => f.key), ...seed.amenities.map((a) => a.key)];
      if (n > 0) keys.push(seed.common.discover, seed.common.book, seed.common.best, seed.common.list?.slice(seed.common.list.indexOf(':') + 1));
      remove.push(...keys);
      if (!item) return;
      const index = read(seed.index);
      const title = read(seed.title);
      const facts = seed.facts.map((f) => read(f.key));
      const cover = read(seed.photo)[def]?.media_id || read(seed.homePhoto)[def]?.media_id || null;
      addFields(item, { cover, onHome: true, cardFacts: seed.facts.map((f) => ({ icon: f.icon })) }, (lang) => {
        const used = [index[lang], title[lang], ...facts.map((f) => f[lang])].filter(Boolean);
        return {
          upToDate: used.every((v) => v.upToDate),
          data: {
            ...(index[lang] ? splitIndex(index[lang].value) : {}),
            ...(title[lang] ? { cardTitle: plain(title[lang].value) } : {}),
            ...(facts.some((f) => f[lang]) ? { cardFacts: facts.map((f) => (f[lang] ? { text: plain(f[lang].value) } : {})) } : {}),
          },
        };
      });
      // Libellés courts des pictogrammes : chaque ligne de la carte correspond au pictogramme de même icône
      const own = [...(JSON.parse(item.data).amenities || [])];
      for (const li of seed.amenities) {
        const i = own.findIndex((k) => amenityIcons.get(k) === li.icon);
        if (i < 0) continue;
        const [key] = own.splice(i, 1);
        if (!shortLabels.has(key)) shortLabels.set(key, read(li.key));
      }
      done += 1;
    });
    for (const [key, labels] of shortLabels) {
      const item = db.prepare("SELECT * FROM cms_items WHERE collection = 'amenities' AND key = ?").get(key);
      if (item) addFields(item, {}, (lang) => ({ upToDate: labels[lang]?.upToDate ?? true, data: labels[lang] ? { shortLabel: plain(labels[lang].value) } : {} }));
    }
    const del = db.prepare('DELETE FROM cms_entries WHERE key = ?');
    for (const key of remove.filter(Boolean)) del.run(key);
    db.prepare('INSERT INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)').run(SEEDED, 'true', now);
  })();
  return done;
}

const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#${id}"></use></svg>`;

/** Remplit les listes de chambres d'une page (avant l'injection des textes : les boutons gardent leurs clés). */
export function renderRoomCards($, { source, lang, now }) {
  const lists = $('[data-cms-rooms]');
  if (!lists.length) return;
  const rooms = source.collectionItems('rooms', lang, now);
  const amenities = new Map(source.collectionItems('amenities', lang, now).map((a) => [a.key, a.data]));
  const parent = source.collections.get('rooms')?.parent_page;
  const base = source.pagesById.get(parent)?.key || 'chambres';
  lists.each((i, el) => {
    const list = $(el);
    const kind = list.attr('data-cms-rooms');
    list.removeAttr('data-cms-rooms');
    const model = list.children().first().clone();
    list.children().remove();
    for (const room of rooms) {
      const r = room.data;
      if (kind === 'home' && r.onHome === false) continue;
      const card = model.clone();
      const slot = (name) => card.find(`[data-f="${name}"]`).addBack(`[data-f="${name}"]`).removeAttr('data-f');
      const href = `#/${base}/${room.key}`;
      slot('link').attr('href', href);
      slot('media').attr('href', href);
      slot('discover').attr('href', href);
      slot('book').attr('data-room-type', room.key);
      const img = slot('cover');
      const info = source.mediaFor(r.cover, lang) || source.mediaFor(r.gallery?.find((g) => g.media)?.media, lang);
      if (info) img.replaceWith(pictureHtml({ ...info, alt: '' }, { sizes: img.attr('data-cms-sizes') || '100vw', loading: 'lazy', portrait: false }));
      else img.remove();
      slot('name').text(r.indexName || r.category || r.name || '');
      slot('summary').replaceWith($('<span>').text(r.summary || '').contents());
      slot('title').attr('href', href).text(r.cardTitle || r.name || '');
      slot('facts').empty().append((r.cardFacts || []).filter((f) => f.text).map((f) => $('<span>').append(icon(f.icon || 'i-check')).append($('<span>').text(f.text).contents())));
      slot('amenities').empty().append((r.amenities || []).slice(0, HOME_AMENITIES).map((key) => amenities.get(key)).filter(Boolean)
        .map((a) => $('<li>').append(icon(a.icon)).append($('<span>').text(a.shortLabel || a.label).contents())));
      list.append('\n', card);
    }
    list.append('\n');
  });
}
