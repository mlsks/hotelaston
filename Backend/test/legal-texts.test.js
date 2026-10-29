/**
 * Mentions légales en bas du pied de page : trois textes communs créés après l'import, traduits
 * (libellés seulement), affichés dans chaque langue, jamais écrasés une fois modifiés.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-legal-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { runBuild } = await import('../server/ssg/build.js');
const { config } = await import('../server/config.js');
const { ensureLegalTexts } = await import('../server/ssg/legal-texts.js');

let db;
const KEYS = ['global.mentions-gds', 'global.mentions-societe', 'global.mentions-mediateur'];
const valueRow = (key, lang) => db.prepare('SELECT v.* FROM cms_entry_values v JOIN cms_entries e ON e.id = v.entry_id WHERE e.key = ? AND v.lang = ?').get(key, lang);
const company = (rel) => cheerio.load(fs.readFileSync(path.join(config.previewDir, rel, 'index.html'), 'utf8'))('footer .site-footer__company');
const seed = JSON.parse(fs.readFileSync(new URL('../server/db/seeds/mentions-legales.json', import.meta.url), 'utf8'));

before(async () => {
  db = getDb();
  importLegacy(db, { writeTemplates: false, log: () => {} });
  await seedSitePhotos(db);
});

after(() => {
  closeDb();
  fs.rmSync(VAR, { recursive: true, force: true });
});

test('le gabarit et les textes livrés en français sont identiques', () => {
  const $ = cheerio.load(fs.readFileSync(path.join(config.templatesDir, 'layout.html'), 'utf8'));
  for (const key of KEYS) assert.equal($(`[data-cms-html="${key}"]`).html(), seed[key].fr, key);
});

test('textes communs créés, traductions prêtes, numéros et adresse inchangés', () => {
  for (const key of KEYS) {
    assert.equal(valueRow(key, 'fr').value, seed[key].fr);
    for (const lang of ['en', 'it', 'de']) assert.equal(valueRow(key, lang).status, 'ready', `${key} ${lang}`);
  }
  for (const lang of Object.keys(seed[KEYS[0]])) {
    const text = KEYS.map((k) => seed[k][lang]).join(' ');
    for (const fact of ['IW NCE368', 'IW 52264', 'IW 11318', 'IW NCEAL', 'HOTEL ASTON LA SCALA', '798 563 003 00028', 'NICE 798 563 003 - APE 5510Z', 'FR93 798 563 003',
      'Médiation Tourisme et Voyage', 'Service dépôt des saisines', 'CS 30958', '75383 Paris Cedex 08', 'www.mtv.travel']) assert.ok(text.includes(fact), `${lang} : ${fact}`);
  }
  assert.equal(ensureLegalTexts(db), 0); // une seule fois
});

test('au-dessus de la ligne Clef Verte, dans la langue de la page', async () => {
  await runBuild({ kind: 'preview', log: () => {} });
  const fr = company('fr');
  assert.match(fr.text(), /Codes GDS : Amadeus : IW NCE368/);
  assert.match(fr.text(), /Médiateur de la consommation/);
  assert.ok(fr.next().hasClass('site-footer__bottom')); // juste au-dessus de la ligne Clef Verte
  const en = company('en');
  assert.match(en.text(), /GDS codes: Amadeus: IW NCE368/);
  assert.match(en.text(), /Consumer mediator/);
  assert.equal(en.find('a[href="https://www.mtv.travel/"]').length, 1);
});

test('une valeur modifiée n’est jamais remplacée ; français modifié : traduction livrée en brouillon', () => {
  const key = 'global.mentions-gds';
  db.prepare("UPDATE cms_entry_values SET value = 'Codes GDS : Amadeus : IW NCE369' WHERE lang = 'fr' AND entry_id = (SELECT id FROM cms_entries WHERE key = ?)").run(key);
  db.prepare("DELETE FROM cms_entry_values WHERE lang = 'de' AND entry_id = (SELECT id FROM cms_entries WHERE key = ?)").run(key);
  ensureLegalTexts(db);
  assert.equal(valueRow(key, 'fr').value, 'Codes GDS : Amadeus : IW NCE369');
  assert.equal(valueRow(key, 'de').status, 'draft');
});
