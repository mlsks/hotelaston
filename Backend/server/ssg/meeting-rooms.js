/**
 * Salles de séminaire : tableau des capacités de la page Séminaires et liste « Offre ou salle »
 * du formulaire de devis, construits depuis les fiches de la collection « meeting_rooms », dans
 * leur ordre ; une fiche masquée ou supprimée disparaît des deux.
 *
 * Dans un gabarit : <tbody data-cms-meeting-rooms> dont la première ligne sert de modèle, avec
 * des emplacements data-f (media, name, detail, quote, surface, theatre, classroom, ushape,
 * cabaret, banquet) ; <option data-cms-meeting-rooms="quote"> dans le formulaire de devis.
 * Champs de la fiche : media, surface (m²), theatre, classroom, ushape, cabaret, banquet
 * (nombre, « — » si la configuration n'existe pas, vide : « Sur demande », à confirmer) ;
 * traduits : name, detail.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { pictureHtml } from './media-render.js';
import { nowIso, sha } from '../lib/util.js';

export const MEETING_ROOMS = 'meeting_rooms';
export const CAPACITIES = ['theatre', 'classroom', 'ushape', 'cabaret', 'banquet'];
const SEEDED = 'meeting_rooms';
const SEED_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seeds', 'salles.json');
/** Textes du modèle de ligne, gardés : lien devis, intitulés des colonnes (mobile), « Sur demande », « À préciser ». */
export const KEEP = ['seminaires.027-a', 'seminaires.028-td@data-label', 'seminaires.030-td@data-label', 'seminaires.031-td@data-label',
  'seminaires.032-td@data-label', 'seminaires.033-td@data-label', 'seminaires.035-td@data-label', 'seminaires.034-span', 'seminaires.101-span'];
const ON_REQUEST = 'seminaires.034-span';
const TO_SPECIFY = 'seminaires.101-span';

const plain = (html) => cheerio.load(`<div>${String(html ?? '')}</div>`, null, false)('div').text().replace(/\s+/g, ' ').trim();

/**
 * Reprise, une fois, des salles du tableau (et de leurs traductions) dans des fiches ; les textes
 * repris sont retirés, sauf ceux du modèle de ligne. Sans effet tant que le site n'est pas importé.
 */
export function ensureMeetingRooms(db) {
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  if (!def || !fs.existsSync(SEED_FILE) || db.prepare('SELECT 1 FROM cms_settings WHERE key = ?').get(SEEDED)) return 0;
  if (!db.prepare('SELECT 1 FROM cms_collections WHERE key = ?').get(MEETING_ROOMS)) return 0;
  const { rooms } = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const entryId = db.prepare('SELECT id FROM cms_entries WHERE key = ?').pluck();
  if (!entryId.get(rooms[0].name)) return 0; // site pas encore importé
  const values = db.prepare('SELECT lang, value, media_id, status, source_hash FROM cms_entry_values WHERE entry_id = ?');
  const read = (key) => {
    const id = key && entryId.get(key);
    const rows = id ? values.all(id) : [];
    const fr = rows.find((r) => r.lang === def);
    return Object.fromEntries(rows.filter((r) => r.lang === def || r.value).map((r) => [r.lang, {
      value: r.value, media_id: r.media_id, ready: r.lang === def || r.status === 'ready',
      upToDate: r.lang === def || !r.source_hash || r.source_hash === sha(String(fr?.value ?? '')),
    }]));
  };
  const now = nowIso();
  let done = 0;
  db.transaction(() => {
    const exists = db.prepare('SELECT 1 FROM cms_items WHERE collection = ? AND key = ?');
    const insItem = db.prepare('INSERT INTO cms_items (collection, key, data, is_active, position, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)');
    const insI18n = db.prepare('INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)');
    const remove = [];
    let position = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) FROM cms_items WHERE collection = ?').pluck().get(MEETING_ROOMS);
    for (const seed of rooms) {
      remove.push(seed.photo, seed.name, seed.detail, seed.quote, seed.option, ...seed.oldKeys);
      if (exists.get(MEETING_ROOMS, seed.key)) continue;
      const texts = { name: read(seed.name), detail: read(seed.detail) };
      const media = read(seed.photo)[def]?.media_id || null;
      const base = {
        media, ...(media ? {} : { src: seed.photoUrl }), surface: seed.surface,
        ...Object.fromEntries(CAPACITIES.map((f) => [f, seed[f]])),
      };
      const build = (lang) => {
        const used = Object.values(texts).map((v) => v[lang]).filter(Boolean);
        const data = Object.fromEntries(Object.entries(texts).filter(([, v]) => v[lang]).map(([f, v]) => [f, plain(v[lang].value)]));
        return { data, used };
      };
      const fr = JSON.stringify(build(def).data);
      const id = insItem.run(MEETING_ROOMS, seed.key, JSON.stringify(base), position++, now, now).lastInsertRowid;
      insI18n.run(id, def, fr, 'ready', sha(fr), now);
      const langs = new Set(Object.values(texts).flatMap((v) => Object.keys(v)).filter((l) => l !== def));
      for (const lang of langs) {
        const tr = build(lang);
        const complete = tr.used.length >= build(def).used.length;
        const ready = complete && tr.used.every((v) => v.ready);
        insI18n.run(id, lang, JSON.stringify(tr.data), ready ? 'ready' : 'draft', tr.used.every((v) => v.upToDate) ? sha(fr) : '', now);
      }
      done += 1;
    }
    const del = db.prepare('DELETE FROM cms_entries WHERE key = ?');
    for (const key of new Set(remove.filter((k) => k && !KEEP.includes(k)))) del.run(key);
    db.prepare('INSERT INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)').run(SEEDED, 'true', now);
  })();
  return done;
}

/** Remplit le tableau des salles et la liste du formulaire de devis (avant l'injection des textes). */
export function renderMeetingRooms($, { source, lang, now, cdn = '' }) {
  const tables = $('[data-cms-meeting-rooms]');
  if (!tables.length) return;
  const rooms = source.collectionItems(MEETING_ROOMS, lang, now);
  tables.each((i, el) => {
    const host = $(el);
    const kind = host.attr('data-cms-meeting-rooms');
    host.removeAttr('data-cms-meeting-rooms');
    if (kind === 'quote') {
      // Formulaire de devis : une option par salle, à la place du repère
      host.replaceWith(rooms.map((r) => $('<option>').attr('value', r.key).text(r.data.name || r.key)));
      return;
    }
    const model = host.children().first().clone();
    host.children().remove();
    for (const room of rooms) {
      const r = room.data;
      const row = model.clone();
      const slot = (name) => row.find(`[data-f="${name}"]`).removeAttr('data-f');
      const img = slot('media');
      const info = source.mediaFor(r.media, lang);
      if (info) img.replaceWith(pictureHtml({ ...info, alt: '' }, { sizes: img.attr('data-cms-sizes') || '100vw', loading: 'lazy', portrait: false }));
      else if (r.src) img.removeAttr('data-cms-sizes').attr({ src: /^https?:/.test(r.src) ? r.src : cdn + r.src, alt: '' });
      else img.remove();
      slot('name').text(r.name || '');
      const detail = slot('detail');
      if (r.detail) detail.text(r.detail);
      else detail.remove();
      slot('quote').attr('href', `#/devis?salle=${room.key}`);
      // Valeur vide : à confirmer (« Sur demande », « À préciser » pour la surface), traduite avec les textes de la page
      const unknown = (key) => `<span class="verify" data-cms-key="${key}"></span>`;
      const surface = String(r.surface ?? '').trim();
      slot('surface').html(surface ? $('<i>').text(/^\d+$/.test(surface) ? `${surface} m²` : surface).html() : unknown(TO_SPECIFY));
      for (const f of CAPACITIES) {
        const v = String(r[f] ?? '').trim();
        slot(f).html(v ? $('<i>').text(v === '-' ? '—' : v).html() : unknown(ON_REQUEST));
      }
      host.append('\n', row);
    }
    host.append('\n');
  });
}
