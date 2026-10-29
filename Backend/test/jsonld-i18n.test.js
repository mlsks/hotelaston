/**
 * Données structurées dans toutes les langues : modèle unique (clés Schema.org fixes), textes traduits,
 * adresses de la langue de la page, inLanguage, repli anglais puis français, ancien format encore lu.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-jsonld-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';
process.env.SITE_URL = 'https://www.hotel-aston.com';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { runBuild } = await import('../server/ssg/build.js');
const { Source } = await import('../server/ssg/source.js');
const { config } = await import('../server/config.js');
const { globalGraph, resolveGraph } = await import('../server/ssg/jsonld.js');
const { ensureJsonLd } = await import('../server/ssg/jsonld-texts.js');

let db;
const SITE = 'https://www.hotel-aston.com';
const graphOf = (rel) => {
  const $ = cheerio.load(fs.readFileSync(path.join(config.previewDir, rel, 'index.html'), 'utf8'));
  return JSON.parse($('script[type="application/ld+json"]').text())['@graph'];
};
const node = (graph, frag) => graph.find((n) => n['@id'] === `${SITE}/#${frag}`);
const valueRow = (key, lang) => db.prepare('SELECT v.* FROM cms_entry_values v JOIN cms_entries e ON e.id = v.entry_id WHERE e.key = ? AND v.lang = ?').get(key, lang);

before(async () => {
  db = getDb();
  importLegacy(db, { writeTemplates: false, log: () => {} });
  await seedSitePhotos(db);
});

after(() => {
  closeDb();
  fs.rmSync(VAR, { recursive: true, force: true });
});

test('modèle : {{clé}}, {{url:page}} et {{inLanguage}} remplacés, page inconnue retirée', () => {
  const warnings = [];
  const out = resolveGraph([{ '@type': 'Restaurant', '@id': 'x#r', name: 'L’Horloge', description: '{{d}}', url: '{{url:resto}}', hasMenu: '{{url:absente}}', servesCuisine: ['{{c1}}', '{{vide}}'], inLanguage: '{{inLanguage}}' }], {
    text: (k) => ({ d: 'Brasserie.', c1: 'Mediterranean' }[k] ?? ''), url: (p) => (p === 'resto' ? 'https://e.fr/en/resto/' : null), locale: 'en-GB', warn: (w) => warnings.push(w),
  });
  assert.deepEqual(out, [{ '@type': 'Restaurant', '@id': 'x#r', name: 'L’Horloge', description: 'Brasserie.', url: 'https://e.fr/en/resto/', servesCuisine: ['Mediterranean'], inLanguage: 'en-GB' }]);
  assert.equal(warnings.length, 2);
});

test('l’ancien graphe français devient un modèle unique, textes jsonld.* traduits et prêts', () => {
  const setting = JSON.parse(db.prepare("SELECT value FROM cms_settings WHERE key = 'jsonld_graph'").pluck().get());
  assert.ok(Array.isArray(setting['@graph']));
  assert.equal(setting.fr, undefined);
  const hotel = setting['@graph'].find((n) => n['@type'] === 'Hotel');
  assert.equal(hotel.description, '{{jsonld.hotel.description}}');
  assert.equal(hotel.url, '{{url:accueil}}');
  assert.equal(hotel.telephone, '+33 4 92 17 53 00'); // structure et faits : inchangés
  assert.equal(hotel.amenityFeature[0].name, '{{jsonld.hotel.equipement-1}}');
  assert.match(valueRow('jsonld.hotel.description', 'fr').value, /^Hôtel 4 étoiles au cœur de Nice/);
  assert.equal(valueRow('jsonld.hotel.description', 'en').status, 'ready');
  assert.equal(valueRow('jsonld.hotel.description', 'de').status, 'ready');
  assert.equal(ensureJsonLd(db), 0); // une seule fois
});

test('chaque langue : textes traduits, adresses de la langue, mêmes @id, inLanguage', async () => {
  await runBuild({ kind: 'preview', log: () => {} });
  const fr = graphOf('fr');
  const en = graphOf('en');
  assert.match(node(fr, 'hotel').description, /^Hôtel 4 étoiles/);
  assert.match(node(en, 'hotel').description, /^4-star hotel in the heart of Nice/);
  assert.equal(node(en, 'hotel').name, 'Hôtel Aston La Scala'); // nom propre : jamais traduit
  assert.equal(node(en, 'website').inLanguage, 'en-GB');
  assert.equal(node(fr, 'website').inLanguage, 'fr-FR');
  assert.equal(node(en, 'website').url, `${SITE}/en/`);
  const horloge = node(en, 'horloge');
  assert.match(horloge.url, /^https:\/\/www\.hotel-aston\.com\/en\/.+\/$/);
  assert.match(horloge.hasMenu, /^https:\/\/www\.hotel-aston\.com\/en\/.+\/$/);
  assert.deepEqual(horloge.servesCuisine, ['Brasserie', 'Mediterranean']);
  assert.deepEqual(horloge.openingHoursSpecification[0].dayOfWeek.slice(0, 2), ['Monday', 'Tuesday']);
  assert.match(node(en, 'astonclub').description, /^Lounge bar on the 7th floor/);
  assert.doesNotMatch(JSON.stringify(en), /\{\{|\/fr\//);
  for (const g of [fr, en]) assert.deepEqual(g.filter((n) => n['@id']?.startsWith(`${SITE}/#`)).map((n) => n['@id']), [`${SITE}/#website`, `${SITE}/#hotel`, `${SITE}/#horloge`, `${SITE}/#moonbar`, `${SITE}/#astonclub`]);
  const llms = fs.readFileSync(path.join(config.previewDir, 'en', 'llms.txt'), 'utf8');
  assert.match(llms, /> 4-star hotel in the heart of Nice/);
});

test('sans traduction prête : anglais, sinon français', () => {
  db.prepare("DELETE FROM cms_entry_values WHERE lang = 'it' AND entry_id = (SELECT id FROM cms_entries WHERE key = 'jsonld.horloge.prix')").run();
  const source = new Source(db, { mode: 'production' });
  assert.equal(source.relayText('jsonld.horloge.prix', 'it'), 'Set menus from €15 to €34, taxes included');
  assert.equal(source.relayText('jsonld.horloge.description', 'it'), valueRow('jsonld.horloge.description', 'it').value);
  db.prepare("UPDATE cms_entry_values SET status = 'draft' WHERE lang = 'en' AND entry_id = (SELECT id FROM cms_entries WHERE key = 'jsonld.horloge.prix')").run();
  assert.equal(new Source(db, { mode: 'production' }).relayText('jsonld.horloge.prix', 'it'), 'Formules de 15 € à 34 € TTC');
});

test('français modifié avant la mise à jour : traduction livrée en brouillon', () => {
  const key = 'jsonld.moonbar.nom';
  db.prepare("UPDATE cms_entry_values SET value = 'Moon Bar' WHERE lang = 'fr' AND entry_id = (SELECT id FROM cms_entries WHERE key = ?)").run(key);
  db.prepare("DELETE FROM cms_entry_values WHERE lang = 'de' AND entry_id = (SELECT id FROM cms_entries WHERE key = ?)").run(key);
  ensureJsonLd(db);
  assert.equal(valueRow(key, 'de').status, 'draft');
});

test('ancien format (snapshot déjà publié) : graphe de la langue par défaut, accueil de la langue', () => {
  const source = { defaultLang: 'fr', settings: { jsonld_graph: { fr: { '@graph': [{ '@type': 'Hotel', url: `${SITE}/fr/` }] } } } };
  assert.deepEqual(globalGraph(source, 'en', null, `${SITE}/en/`), [{ '@type': 'Hotel', url: `${SITE}/en/` }]);
});
