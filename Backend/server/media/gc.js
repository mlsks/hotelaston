/**
 * Nettoyage des médias supprimés : un fichier n'est effacé que si ni la base de travail
 * ni aucun des snapshots conservés (versions restaurables) ne l'utilise encore.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { openDb } from '../db/connection.js';

export function collectGarbage(db, { log = () => {} } = {}) {
  const kept = new Set();
  const snapshots = db.prepare('SELECT DISTINCT snapshot_path FROM sys_builds WHERE release_path IS NOT NULL AND snapshot_path IS NOT NULL').pluck().all();
  for (const file of snapshots) {
    if (!fs.existsSync(file)) continue;
    const snap = openDb(file, { readonly: true });
    try {
      for (const id of snap.prepare('SELECT id FROM cms_media WHERE deleted_at IS NULL').pluck().all()) kept.add(id);
    } finally {
      snap.close();
    }
  }
  const deleted = db.prepare('SELECT * FROM cms_media WHERE deleted_at IS NOT NULL').all().filter((m) => !kept.has(m.id));
  for (const m of deleted) {
    for (const v of db.prepare('SELECT path FROM cms_media_variants WHERE media_id = ?').pluck().all(m.id)) {
      fs.rmSync(path.join(config.mediaDir, ...v.split('/')), { force: true });
    }
    if (m.storage_key) fs.rmSync(path.join(config.uploadsDir, m.storage_key), { force: true });
    db.transaction(() => {
      // Références laissées par une suppression forcée
      db.prepare('UPDATE cms_entry_values SET media_id = NULL WHERE media_id = ?').run(m.id);
      db.prepare('UPDATE cms_page_i18n SET og_image_id = NULL WHERE og_image_id = ?').run(m.id);
      db.prepare('UPDATE cms_popups SET media_id = NULL WHERE media_id = ?').run(m.id);
      db.prepare('UPDATE cms_media SET poster_id = NULL WHERE poster_id = ?').run(m.id);
      db.prepare('DELETE FROM cms_item_media WHERE media_id = ?').run(m.id);
      db.prepare('DELETE FROM cms_media WHERE id = ?').run(m.id);
    })();
  }
  if (deleted.length) log(`Médias : ${deleted.length} fichier(s) supprimé(s) définitivement.`);
  return deleted.length;
}
