/**
 * Connexion SQLite (better-sqlite3) et migrations numérotées.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { ensureUiStrings } from '../ssg/ui-strings.js';

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
    ensureUiStrings(shared);
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
