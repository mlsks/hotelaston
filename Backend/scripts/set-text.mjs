/**
 * Outil de développement (en attendant l'admin, brique 4) : modifie un texte dans la base de travail.
 *   node scripts/set-text.mjs <clé> <lang> "<nouveau texte>"
 *   node scripts/set-text.mjs <clé> <lang>            → affiche la valeur actuelle
 */
import { getDb } from '../server/db/connection.js';
import { sha, nowIso } from '../server/lib/util.js';

const [key, lang = 'fr', value] = process.argv.slice(2);
if (!key) {
  console.log('Usage : node scripts/set-text.mjs <clé> <lang> ["nouveau texte"]');
  process.exit(1);
}
const db = getDb();
const entry = db.prepare('SELECT id FROM cms_entries WHERE key = ?').get(key);
if (!entry) {
  console.error(`Clé inconnue : ${key}`);
  process.exit(1);
}
if (value === undefined) {
  console.log(db.prepare('SELECT value, status FROM cms_entry_values WHERE entry_id = ? AND lang = ?').get(entry.id, lang) ?? '(vide)');
} else {
  db.prepare(`INSERT INTO cms_entry_values (entry_id, lang, value, status, source_hash, updated_at) VALUES (?, ?, ?, 'ready', ?, ?)
    ON CONFLICT (entry_id, lang) DO UPDATE SET value = excluded.value, status = 'ready', source_hash = excluded.source_hash, updated_at = excluded.updated_at`)
    .run(entry.id, lang, value, sha(value), nowIso());
  console.log(`${key} [${lang}] = ${value}`);
}
