/**
 * Changements de texte livrés (seeds/text-renames.json) : appliqués à une base qui a encore
 * l'ancien français, jamais à un texte déjà modifié dans l'admin.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-renames-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { applyTextRenames } = await import('../server/ssg/ui-strings.js');
const { sha } = await import('../server/lib/util.js');

let db;
const KEY = 'accueil.133-a';
const value = (lang) => db.prepare('SELECT v.* FROM cms_entry_values v JOIN cms_entries e ON e.id = v.entry_id WHERE e.key = ? AND v.lang = ?').get(KEY, lang);
const setFr = (text) => db.prepare(`UPDATE cms_entry_values SET value = ? WHERE lang = 'fr' AND entry_id = (SELECT id FROM cms_entries WHERE key = ?)`).run(text, KEY);

before(() => {
  db = getDb();
  importLegacy(db, { writeTemplates: false, log: () => {} });
});

after(() => {
  closeDb();
  fs.rmSync(VAR, { recursive: true, force: true });
});

test('une base neuve a déjà le nouveau texte « Tous les avis »', () => {
  assert.equal(value('fr').value, 'Tous les avis');
  assert.equal(applyTextRenames(db), 0);
});

test('l’ancien texte est remplacé, traductions comprises, et marqué prêt', () => {
  setFr('Tous les avis et nos réponses');
  assert.equal(applyTextRenames(db), 1);
  assert.equal(value('fr').value, 'Tous les avis');
  assert.equal(value('en').value, 'All reviews');
  assert.equal(value('en').status, 'ready');
  assert.equal(value('en').source_hash, sha('Tous les avis'));
});

test('un texte modifié dans l’admin n’est jamais écrasé', () => {
  setFr('Lire tous nos avis');
  assert.equal(applyTextRenames(db), 0);
  assert.equal(value('fr').value, 'Lire tous nos avis');
});

test('chat : la réponse par défaut ne propose plus de rappel, dans toutes les langues', () => {
  const key = 'global.chat-sans-reponse';
  const get = (lang) => db.prepare('SELECT v.* FROM cms_entry_values v JOIN cms_entries e ON e.id = v.entry_id WHERE e.key = ? AND v.lang = ?').get(key, lang);
  const fresh = get('fr').value;
  assert.doesNotMatch(fresh, /rappeler/);
  const old = fresh.replace(/\.$/, ', ou je peux vous faire rappeler.');
  db.prepare(`UPDATE cms_entry_values SET value = ? WHERE lang = 'fr' AND entry_id = (SELECT id FROM cms_entries WHERE key = ?)`).run(old, key);
  assert.equal(applyTextRenames(db), 1);
  assert.equal(get('fr').value, fresh);
  assert.match(get('en').value, /^I don't have a precise answer.*tel:\+33492175300/);
  assert.equal(get('en').status, 'ready');
});
