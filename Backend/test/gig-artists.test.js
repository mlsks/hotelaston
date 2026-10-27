/**
 * Concerts saisis avec un nom d'artiste libre : convertis en fiches artistes sans perte
 * (style, présentation, traductions et leur état « à jour »).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, migrate } from '../server/db/connection.js';
import { migrateGigArtists } from '../server/db/gig-artists.js';
import { sha } from '../server/lib/util.js';

test('les concerts existants deviennent des fiches artistes, sans perte', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-artists-'));
  const db = openDb(path.join(dir, 'test.sqlite'));
  try {
    migrate(db);
    const now = new Date().toISOString();
    const addItem = db.prepare("INSERT INTO cms_items (collection, key, data, is_active, position, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)");
    const addRow = db.prepare("INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)");
    // Concert d'avant les fiches : nom, style et présentation dans les textes traduits
    const gig = (key, fr, en) => {
      const id = addItem.run('gigs', key, JSON.stringify({ date: '2026-11-06', time: '21:00', venue: 'selon-meteo' }), now, now).lastInsertRowid;
      const frData = JSON.stringify(fr);
      addRow.run(id, 'fr', frData, 'ready', sha(frData), now);
      if (en) addRow.run(id, 'en', JSON.stringify(en), 'ready', sha(frData), now);
      return id;
    };
    // Fiche déjà créée à la main : réutilisée, pas doublée
    addItem.run('artists', 'habanita', JSON.stringify({ name: 'Habanita', website: 'https://habanita.example', media: null }), now, now);

    const a = gig('moana-1', { artist: 'Moana Folks', style: 'Folk', description: 'Soirée de lancement' }, { artist: 'Moana Folks', style: 'Folk', description: 'Launch night' });
    const b = gig('moana-2', { artist: 'moana folks ', style: 'Folk acoustique', description: '' });
    const c = gig('habanita', { artist: 'Habanita', style: 'Latin jazz' });
    const d = gig('vide', { artist: '' });

    assert.equal(migrateGigArtists(db), 3);
    assert.equal(migrateGigArtists(db), 0, 'sans effet la seconde fois');

    const artists = db.prepare("SELECT * FROM cms_items WHERE collection = 'artists' ORDER BY key").all();
    assert.deepEqual(artists.map((x) => x.key), ['habanita', 'moana-folks']);
    const rows = (id) => Object.fromEntries(db.prepare('SELECT * FROM cms_item_i18n WHERE item_id = ?').all(id).map((r) => [r.lang, r]));
    const data = (id) => JSON.parse(db.prepare('SELECT data FROM cms_items WHERE id = ?').pluck().get(id));
    const moana = artists[1];
    assert.deepEqual(JSON.parse(moana.data), { name: 'Moana Folks', website: '', media: null });
    const moanaRows = rows(moana.id);
    assert.equal(JSON.parse(moanaRows.fr.data).style, 'Folk');
    assert.equal(JSON.parse(moanaRows.en.data).style, 'Folk');
    assert.equal(moanaRows.en.source_hash, sha(moanaRows.fr.data), 'traduction anglaise à jour');
    assert.equal(JSON.parse(rows(artists[0].id).fr.data).style, 'Latin jazz');
    assert.equal(JSON.parse(artists[0].data).website, 'https://habanita.example', 'fiche existante conservée');

    // Concerts : clé de l'artiste, nom retiré des textes, présentation gardée, style seulement s'il diffère
    assert.equal(data(a).artist, 'moana-folks');
    assert.deepEqual(JSON.parse(rows(a).fr.data), { description: 'Soirée de lancement' });
    assert.deepEqual(JSON.parse(rows(a).en.data), { description: 'Launch night' });
    assert.equal(rows(a).en.source_hash, sha(rows(a).fr.data), 'traduction du concert toujours à jour');
    assert.equal(data(b).artist, 'moana-folks');
    assert.equal(JSON.parse(rows(b).fr.data).style, 'Folk acoustique', 'style propre à la soirée gardé');
    assert.equal(data(c).artist, 'habanita');
    assert.equal(data(d).artist, undefined, 'concert sans nom laissé tel quel');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
