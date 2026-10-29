/**
 * Connexion SQLite (better-sqlite3) et migrations numérotées.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config, fromVarPath, toVarPath } from '../config.js';
import { ensureUiStrings } from '../ssg/ui-strings.js';
import { migrateGigArtists } from './gig-artists.js';
import { ensureLinkLists } from '../ssg/link-lists.js';
import { ensureMenus } from '../ssg/menus.js';
import { ensureRoomCards } from '../ssg/room-cards.js';
import { ensureOffers } from '../ssg/offer-cards.js';
import { ensureBlockEntries } from '../ssg/page-blocks.js';
import { ensureMeetingRooms } from '../ssg/meeting-rooms.js';
import { ensureJsonLd } from '../ssg/jsonld-texts.js';
import { ensureLegalTexts } from '../ssg/legal-texts.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Ouvre une base. En écriture : WAL, écritures « NORMAL », clés étrangères actives. */
export function openDb(file = config.dbPath, { readonly = false } = {}) {
  if (!readonly) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, { readonly, fileMustExist: readonly });
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

let shared = null;

/** Connexion partagée du processus (serveur ou commande), migrations appliquées. */
export function getDb() {
  if (!shared) {
    shared = openDb();
    migrate(shared);
    allowDocumentMedia(shared);
    relativizeBuildPaths(shared);
    migrateGigArtists(shared);
    ensureUiStrings(shared);
    ensureLinkLists(shared);
    ensureMenus(shared);
    ensureRoomCards(shared);
    ensureOffers(shared);
    ensureMeetingRooms(shared);
    ensureBlockEntries(shared);
    ensureJsonLd(shared);
    ensureLegalTexts(shared);
  }
  return shared;
}

/** Ferme la connexion partagée (tests, arrêt du serveur). */
export function closeDb() {
  shared?.close();
  shared = null;
}

/** Applique les fichiers migrations/NNN_*.sql pas encore passés, chacun dans une transaction. */
export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS sys_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const done = new Set(db.prepare('SELECT name FROM sys_migrations').pluck().all());
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO sys_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    })();
    applied.push(file);
  }
  return applied;
}

/**
 * Médiathèque : type « document » (PDF des cartes du restaurant…) ajouté à la contrainte CHECK de cms_media.
 * SQLite ne sait pas modifier une contrainte : la définition de la table est réécrite en place, ce qui est
 * sans risque pour un CHECK élargi (le format des données ne change pas). Sans effet ensuite.
 */
export function allowDocumentMedia(db) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cms_media'").pluck().get();
  if (!sql || sql.includes("'document'")) return false;
  const next = sql.replace(/(kind\s+TEXT\s+NOT NULL\s+CHECK\s*\(kind IN \([^)]*'embed')\)/, "$1, 'document')");
  if (next === sql) throw new Error('cms_media : contrainte sur le type de média introuvable.');
  const version = db.pragma('schema_version', { simple: true });
  db.unsafeMode(true);
  try {
    db.pragma('writable_schema = ON');
    db.prepare("UPDATE sqlite_master SET sql = ? WHERE type = 'table' AND name = 'cms_media'").run(next);
    db.pragma(`schema_version = ${version + 1}`);
  } finally {
    db.pragma('writable_schema = OFF');
    db.unsafeMode(false);
  }
  if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('cms_media : base endommagée après la mise à jour.');
  return true;
}

/**
 * Bases créées avant le passage aux chemins relatifs : les chemins absolus de sys_builds
 * (souvent Windows, C:\dev\…) sont réécrits relativement à varDir. Sans effet ensuite.
 */
export function relativizeBuildPaths(db) {
  const rows = db.prepare(`SELECT id, snapshot_path, release_path FROM sys_builds
    WHERE snapshot_path GLOB '[/\\]*' OR snapshot_path GLOB '?:*' OR release_path GLOB '[/\\]*' OR release_path GLOB '?:*'`).all();
  if (!rows.length) return 0;
  const rel = (p) => {
    if (!p) return p;
    const abs = fromVarPath(p);
    const r = toVarPath(abs);
    return r.startsWith('..') || path.isAbsolute(r) ? p : r; // hors de varDir : laissé tel quel
  };
  const update = db.prepare('UPDATE sys_builds SET snapshot_path = ?, release_path = ? WHERE id = ?');
  db.transaction(() => {
    for (const r of rows) update.run(rel(r.snapshot_path), rel(r.release_path), r.id);
  })();
  return rows.length;
}
