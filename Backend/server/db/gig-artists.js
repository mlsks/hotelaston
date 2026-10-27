/**
 * Concerts saisis avant les fiches artistes : le nom libre (champ traduit « artist ») devient
 * une fiche de la collection « artists », et le concert la désigne par sa clé (champ commun).
 * Le style passe sur la fiche ; il reste sur le concert seulement s'il diffère de celui de la fiche.
 * La présentation du concert est gardée telle quelle (précisions sur la soirée).
 * Sans effet une fois les concerts convertis.
 */
import { sha, nowIso, isPlainObject } from '../lib/util.js';

export const slugifyKey = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const norm = (s) => String(s ?? '').trim().toLowerCase();
const parse = (s) => {
  try {
    const v = JSON.parse(s || '{}');
    return isPlainObject(v) ? v : {};
  } catch {
    return {};
  }
};

export function migrateGigArtists(db) {
  const hasArtists = db.prepare("SELECT 1 FROM cms_collections WHERE key = 'artists'").get();
  if (!hasArtists) return 0;
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get() || 'fr';
  const gigs = db.prepare("SELECT * FROM cms_items WHERE collection = 'gigs'").all();
  const rowsOf = (id) => Object.fromEntries(db.prepare('SELECT * FROM cms_item_i18n WHERE item_id = ?').all(id).map((r) => [r.lang, r]));
  const todo = gigs.filter((g) => {
    const base = parse(g.data);
    return !base.artist || Object.values(rowsOf(g.id)).some((r) => 'artist' in parse(r.data));
  });
  if (!todo.length) return 0;

  const now = nowIso();
  const writeRow = db.prepare(`INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)
    ON CONFLICT (item_id, lang) DO UPDATE SET data = excluded.data, status = excluded.status, source_hash = excluded.source_hash`);
  /**
   * Réécrit les traductions d'un élément ; une traduction à jour le reste (empreinte de la nouvelle source).
   * oldDefData : texte de la langue par défaut avant modification.
   */
  const saveRows = (itemId, rows, oldDefData) => {
    const oldHash = oldDefData ? sha(oldDefData) : null;
    const defData = JSON.stringify(rows[def] ? parse(rows[def].data) : {});
    const newHash = sha(defData);
    for (const [lang, r] of Object.entries(rows)) {
      const data = lang === def ? defData : r.data;
      const hash = lang === def ? newHash : (r.fresh || (r.source_hash && r.source_hash === oldHash) ? newHash : r.source_hash);
      writeRow.run(itemId, lang, data, r.status || 'ready', hash, r.updated_at || now);
    }
  };

  const artists = () => db.prepare("SELECT * FROM cms_items WHERE collection = 'artists'").all();
  const insItem = db.prepare(`INSERT INTO cms_items (collection, key, data, is_active, position, created_at, updated_at)
    VALUES ('artists', ?, ?, 1, (SELECT COALESCE(MAX(position), -1) + 1 FROM cms_items WHERE collection = 'artists'), ?, ?)`);

  let migrated = 0;
  db.transaction(() => {
    for (const gig of todo) {
      const base = parse(gig.data);
      const rows = rowsOf(gig.id);
      const tr = Object.fromEntries(Object.entries(rows).map(([l, r]) => [l, parse(r.data)]));
      const name = String(tr[def]?.artist ?? base.artist ?? Object.values(tr).find((t) => t.artist)?.artist ?? '').trim();
      if (!name) continue;

      // Fiche existante du même nom (ou désignée par sa clé), sinon nouvelle fiche
      let artist = artists().find((a) => a.key === base.artist || norm(parse(a.data).name) === norm(name));
      if (!artist) {
        const taken = new Set(artists().map((a) => a.key));
        const stem = slugifyKey(name) || 'artiste';
        let key = stem;
        for (let i = 2; taken.has(key); i++) key = `${stem}-${i}`;
        const id = insItem.run(key, JSON.stringify({ name, website: '', media: null }), now, now).lastInsertRowid;
        artist = db.prepare('SELECT * FROM cms_items WHERE id = ?').get(id);
      }

      // Style du concert → fiche artiste quand elle n'en a pas encore, langue par langue
      const artistRows = rowsOf(artist.id);
      const artistDefBefore = artistRows[def]?.data;
      let artistChanged = false;
      for (const [lang, t] of Object.entries(tr)) {
        const style = String(t.style ?? '').trim();
        const current = artistRows[lang] ? parse(artistRows[lang].data) : null;
        if (style && !String(current?.style ?? '').trim()) {
          artistRows[lang] = { ...(artistRows[lang] || { status: rows[lang].status, fresh: true }), data: JSON.stringify({ bio: '', ...current, style }) };
          artistChanged = true;
        }
      }
      if (!artistRows[def]) {
        artistRows[def] = { status: 'ready', data: JSON.stringify({ style: '', bio: '' }) };
        artistChanged = true;
      }
      if (artistChanged) saveRows(artist.id, artistRows, artistDefBefore);

      // Concert : clé de l'artiste en champ commun, nom retiré des traductions, style gardé s'il diffère
      const gigDefBefore = rows[def]?.data;
      const finalArtist = Object.fromEntries(Object.entries(rowsOf(artist.id)).map(([l, r]) => [l, parse(r.data)]));
      for (const [lang, t] of Object.entries(tr)) {
        delete t.artist;
        if ('style' in t && (!String(t.style ?? '').trim() || norm(t.style) === norm(finalArtist[lang]?.style))) delete t.style;
        rows[lang] = { ...rows[lang], data: JSON.stringify(t) };
      }
      saveRows(gig.id, rows, gigDefBefore);
      db.prepare('UPDATE cms_items SET data = ? WHERE id = ?').run(JSON.stringify({ ...base, artist: artist.key }), gig.id);
      migrated++;
    }
  })();
  return migrated;
}
