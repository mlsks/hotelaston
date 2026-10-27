/**
 * Snapshots du contenu : copie des seules tables cms_* dans un fichier SQLite à part.
 * La production est toujours générée depuis un snapshot, jamais depuis les brouillons.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { SCOPES } from '../auth/scopes.js';

const cmsTables = (db, schema = 'main') => db
  .prepare(`SELECT name, sql FROM ${schema}.sqlite_master WHERE type = 'table' AND substr(name, 1, 4) = 'cms_' ORDER BY name`)
  .all();

/** Copie cohérente (une transaction de lecture) des tables cms_* → storage/snapshots/cms-<id>.sqlite */
export function createSnapshot(db, buildId) {
  fs.mkdirSync(config.snapshotsDir, { recursive: true });
  const file = path.join(config.snapshotsDir, `cms-${buildId}.sqlite`);
  fs.rmSync(file, { force: true });
  const tables = cmsTables(db);
  // Copie à l'identique de données déjà cohérentes : pas de contrôle des clés étrangères pendant la copie
  db.pragma('foreign_keys = OFF');
  db.prepare('ATTACH DATABASE ? AS snap').run(file);
  try {
    db.transaction(() => {
      for (const t of tables) db.exec(t.sql.replace(/^CREATE TABLE\s+("?)(\w+)\1/i, 'CREATE TABLE snap.$2'));
      for (const t of tables) db.exec(`INSERT INTO snap.${t.name} SELECT * FROM main.${t.name}`);
    })();
  } finally {
    db.prepare('DETACH DATABASE snap').run();
    db.pragma('foreign_keys = ON');
  }
  return file;
}

/** Tables et colonnes de la base de travail absentes d'un snapshot plus ancien : ajoutées. */
function syncSchema(db) {
  const inSnap = new Set(cmsTables(db, 'snap').map((t) => t.name));
  for (const t of cmsTables(db)) {
    if (!inSnap.has(t.name)) {
      db.exec(t.sql.replace(/^CREATE TABLE\s+("?)(\w+)\1/i, 'CREATE TABLE snap.$2'));
      continue;
    }
    const snapCols = new Set(db.prepare(`PRAGMA snap.table_info(${t.name})`).all().map((c) => c.name));
    for (const c of db.prepare(`PRAGMA main.table_info(${t.name})`).all()) {
      if (!snapCols.has(c.name)) db.exec(`ALTER TABLE snap.${t.name} ADD COLUMN "${c.name}" ${c.type || ''}`);
    }
  }
}

/**
 * Snapshot limité à un périmètre : copie du snapshot en ligne, dans laquelle seules les données
 * du périmètre sont remplacées par celles de la base de travail. Le reste du site garde
 * exactement son contenu publié (les brouillons des autres éditeurs ne partent pas).
 */
export function createScopedSnapshot(db, buildId, scopes, baseSnapshot) {
  if (!baseSnapshot || !fs.existsSync(baseSnapshot)) {
    throw new Error('Une première publication complète doit être faite par un éditeur sans périmètre.');
  }
  const pages = [...new Set(scopes.flatMap((s) => SCOPES[s].pages))];
  const collections = [...new Set(scopes.flatMap((s) => SCOPES[s].collections))];
  const folders = scopes.map((s) => SCOPES[s].mediaFolder);
  const list = (values) => values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(',') || 'NULL';
  const inFolders = (side) => `(${folders.map((f) => `${side}.cms_media.folder = '${f}' OR ${side}.cms_media.folder LIKE '${f}/%'`).join(' OR ')})`;

  // [table, condition (side = 'main' ou 'snap')] — parents avant enfants
  const sets = [
    ['cms_collections', () => `key IN (${list(collections)})`],
    ['cms_entries', (s) => `page_id IN (SELECT id FROM ${s}.cms_pages WHERE key IN (${list(pages)}))`],
    ['cms_entry_values', (s) => `entry_id IN (SELECT e.id FROM ${s}.cms_entries e JOIN ${s}.cms_pages p ON p.id = e.page_id WHERE p.key IN (${list(pages)}))`],
    ['cms_page_i18n', (s) => `page_id IN (SELECT id FROM ${s}.cms_pages WHERE key IN (${list(pages)}))`],
    ['cms_media', (s) => inFolders(s).replaceAll(`${s}.cms_media.`, '')],
    ['cms_media_variants', (s) => `media_id IN (SELECT id FROM ${s}.cms_media WHERE ${inFolders(s)})`],
    ['cms_media_i18n', (s) => `media_id IN (SELECT id FROM ${s}.cms_media WHERE ${inFolders(s)})`],
    ['cms_items', () => `collection IN (${list(collections)})`],
    ['cms_item_i18n', (s) => `item_id IN (SELECT id FROM ${s}.cms_items WHERE collection IN (${list(collections)}))`],
    ['cms_item_media', (s) => `item_id IN (SELECT id FROM ${s}.cms_items WHERE collection IN (${list(collections)}))`],
    ['cms_banners', () => `scope IN (${list(scopes)})`],
    ['cms_banner_i18n', (s) => `banner_id IN (SELECT id FROM ${s}.cms_banners WHERE scope IN (${list(scopes)}))`],
    ['cms_banner_placements', (s) => `banner_id IN (SELECT id FROM ${s}.cms_banners WHERE scope IN (${list(scopes)}))`],
  ];

  fs.mkdirSync(config.snapshotsDir, { recursive: true });
  const file = path.join(config.snapshotsDir, `cms-${buildId}.sqlite`);
  fs.copyFileSync(baseSnapshot, file);
  db.pragma('foreign_keys = OFF');
  db.prepare('ATTACH DATABASE ? AS snap').run(file);
  try {
    syncSchema(db);
    db.transaction(() => {
      for (const [table, cond] of [...sets].reverse()) db.exec(`DELETE FROM snap.${table} WHERE ${cond('snap')}`);
      for (const [table, cond] of sets) {
        const cols = db.prepare(`PRAGMA main.table_info(${table})`).all().map((c) => `"${c.name}"`).join(', ');
        db.exec(`INSERT OR REPLACE INTO snap.${table} (${cols}) SELECT ${cols} FROM main.${table} WHERE ${cond('main')}`);
      }
    })();
  } finally {
    db.prepare('DETACH DATABASE snap').run();
    db.pragma('foreign_keys = ON');
  }
  return file;
}

/** Recopie un snapshot dans la base de travail, après une sauvegarde complète de celle-ci. */
export async function restoreContent(db, snapshotFile) {
  if (!snapshotFile || !fs.existsSync(snapshotFile)) throw new Error('Snapshot introuvable pour cette version.');
  fs.mkdirSync(config.backupsDir, { recursive: true });
  const backup = path.join(config.backupsDir, `avant-restauration-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  await db.backup(backup);
  db.pragma('foreign_keys = OFF');
  db.prepare('ATTACH DATABASE ? AS snap').run(snapshotFile);
  try {
    db.transaction(() => {
      for (const t of cmsTables(db, 'snap')) {
        // Colonnes communes : un snapshot plus ancien que la dernière migration reste restaurable
        const cols = (schema) => db.prepare(`PRAGMA ${schema}.table_info(${t.name})`).all().map((c) => c.name);
        const keep = cols('snap').filter((c) => cols('main').includes(c)).join(', ');
        db.exec(`DELETE FROM main.${t.name}`);
        db.exec(`INSERT INTO main.${t.name} (${keep}) SELECT ${keep} FROM snap.${t.name}`);
      }
    })();
  } finally {
    db.prepare('DETACH DATABASE snap').run();
    db.pragma('foreign_keys = ON');
  }
  return backup;
}
