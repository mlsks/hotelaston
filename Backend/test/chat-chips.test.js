/**
 * Pastilles du chat Restaurant, Bars, Séminaire, Animaux : textes communs créés avec leurs
 * traductions, présents dans le gabarit et reliés à une réponse du chat existante.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-chips-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { ensureChatChips } = await import('../server/ssg/chat-chips.js');

let db;
before(() => { db = getDb(); importLegacy(db, { writeTemplates: false, log: () => {} }); });
after(() => { closeDb(); fs.rmSync(VAR, { recursive: true, force: true }); });

const CHIPS = { restaurant: 'restaurant', bars: 'moonbar', seminaire: 'devis', animaux: 'animaux' };

test('les quatre pastilles existent, traduites et prêtes, dans la section du chat', () => {
  const section = db.prepare("SELECT section FROM cms_entries WHERE key = 'global.095-button'").pluck().get();
  for (const name of Object.keys(CHIPS)) {
    const key = `global.chat-pastille-${name}`;
    const entry = db.prepare('SELECT * FROM cms_entries WHERE key = ?').get(key);
    assert.ok(entry, key);
    assert.equal(entry.section, section);
    const en = db.prepare("SELECT value, status FROM cms_entry_values WHERE entry_id = ? AND lang = 'en'").get(entry.id);
    assert.equal(en.status, 'ready', key);
  }
  assert.equal(ensureChatChips(db), 0);
});

test('chaque pastille du gabarit pose la question d’une réponse du chat existante', () => {
  const layout = fs.readFileSync(new URL('../templates-src/layout.html', import.meta.url), 'utf8');
  const intents = new Set(db.prepare("SELECT key FROM cms_items WHERE collection = 'chat' AND is_active = 1").pluck().all());
  for (const [name, intent] of Object.entries(CHIPS)) {
    assert.match(layout, new RegExp(`data-ask="${intent}" data-cms-key="global.chat-pastille-${name}"`));
    assert.ok(intents.has(intent), intent);
  }
});
