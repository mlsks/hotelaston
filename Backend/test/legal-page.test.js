/**
 * Page Mentions légales : créée après l'import avec ses textes dans toutes les langues livrées,
 * hébergeur et directeur de la publication à remplir (lignes masquées tant qu'ils sont vides),
 * identité de la société reprise du pied de page, lien du pied de page vers la page.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-legal-page-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { runBuild } = await import('../server/ssg/build.js');
const { config } = await import('../server/config.js');
const { ensureLegalPage } = await import('../server/ssg/legal-page.js');

let db;
const seed = JSON.parse(fs.readFileSync(new URL('../server/db/seeds/mentions-legales-page.json', import.meta.url), 'utf8'));
const page$ = (rel) => cheerio.load(fs.readFileSync(path.join(config.previewDir, rel, 'index.html'), 'utf8'));
const valueRow = (key, lang) => db.prepare('SELECT v.* FROM cms_entry_values v JOIN cms_entries e ON e.id = v.entry_id WHERE e.key = ? AND v.lang = ?').get(key, lang);
const setFr = (key, value) => db.prepare("UPDATE cms_entry_values SET value = ? WHERE lang = 'fr' AND entry_id = (SELECT id FROM cms_entries WHERE key = ?)").run(value, key);
const build = async () => JSON.parse((await runBuild({ kind: 'preview', log: () => {} })).warnings);

before(async () => {
  db = getDb();
  importLegacy(db, { writeTemplates: false, log: () => {} });
  await seedSitePhotos(db);
  db.prepare("UPDATE cms_languages SET is_active = 1 WHERE code = 'en'").run();
});

after(() => {
  closeDb();
  fs.rmSync(VAR, { recursive: true, force: true });
});

test('le gabarit et le français livré sont identiques ; 13 langues pour chaque texte traduisible', () => {
  const $ = cheerio.load(fs.readFileSync(path.join(config.templatesDir, 'pages', 'mentions-legales.html'), 'utf8'), null, false);
  for (const [key, e] of Object.entries(seed.entries)) {
    const el = $(`[data-cms-key="${key}"], [data-cms-html="${key}"]`).first();
    const fr = el.length ? (e.type === 'richtext' ? el.html() : el.text()) : $(`[data-cms-attr*=":${key}"]`).attr('aria-label');
    assert.equal(fr, e.values.fr, key);
    assert.equal(Object.keys(e.values).length, e.translatable ? 13 : 1, key);
  }
  assert.equal(Object.keys(seed.page.i18n).length, 13);
  for (const [lang, p] of Object.entries(seed.page.i18n)) {
    assert.ok(p.title.length <= 60 && p.description.length <= 160, lang);
    assert.match(p.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, lang);
  }
});

test('page créée une fois, sous l’accueil, adresse traduite, textes prêts ; hébergeur vide et non traduit', () => {
  const page = db.prepare("SELECT * FROM cms_pages WHERE key = 'mentions-legales'").get();
  assert.equal(page.template, 'pages/mentions-legales.html');
  assert.equal(page.parent_id, db.prepare("SELECT id FROM cms_pages WHERE key = 'accueil'").pluck().get());
  const meta = (lang) => db.prepare('SELECT * FROM cms_page_i18n WHERE page_id = ? AND lang = ?').get(page.id, lang);
  assert.equal(meta('fr').path, '/fr/mentions-legales/');
  assert.equal(meta('en').path, '/en/legal-notice/');
  assert.equal(meta('de').path, '/de/impressum/');
  assert.equal(meta('en').status, 'ready');
  assert.equal(valueRow('mentions-legales.propriete-1', 'it').status, 'ready');
  const host = db.prepare("SELECT * FROM cms_entries WHERE key = 'mentions-legales.hebergeur-nom'").get();
  assert.equal(host.page_id, page.id);
  assert.equal(host.translatable, 0);
  assert.equal(host.required, 0);
  assert.equal(valueRow('mentions-legales.hebergeur-nom', 'fr').value, '');
  assert.equal(valueRow('mentions-legales.hebergeur-nom', 'en'), undefined);
  assert.equal(ensureLegalPage(db), 0); // une seule fois
});

test('page dans chaque langue : société du pied de page, hébergeur masqué tant qu’il est vide, lien du pied de page', async () => {
  const warnings = await build();
  assert.ok(warnings.some((w) => /Hébergeur du site.*vide : bloc masqué/.test(w)), warnings.join('\n'));
  const fr = page$('fr/mentions-legales');
  assert.equal(fr('main h1').text(), 'Mentions légales');
  assert.match(fr('main').text(), /798 563 003 00028/);
  assert.match(fr('main').text(), /Médiateur du Tourisme et du Voyage/);
  assert.doesNotMatch(fr('main').text(), /Hébergeur|Directeur de la publication/);
  assert.equal(fr('main [data-cms-optional]').length, 0);
  assert.equal(fr('.site-footer__legal a').first().attr('href'), '/preview/fr/mentions-legales/');
  const en = page$('en/legal-notice');
  assert.equal(en('main h1').text(), 'Legal notice');
  assert.match(en('main').text(), /EU VAT no\.:/); // texte commun du pied de page, en anglais
  assert.equal(en('.site-footer__legal a').first().attr('href'), '/preview/en/legal-notice/');
});

test('hébergeur rempli en français : affiché dans toutes les langues, lignes vides toujours masquées', async () => {
  setFr('mentions-legales.hebergeur-nom', 'Hébergeur Exemple SAS');
  setFr('mentions-legales.hebergeur-site', 'https://hebergeur.example/');
  const warnings = await build();
  assert.ok(!warnings.some((w) => /Hébergeur du site/.test(w)));
  for (const [rel, heading] of [['fr/mentions-legales', 'Hébergeur'], ['en/legal-notice', 'Hosting']]) {
    const $ = page$(rel);
    const facts = $('main .legal__section').filter((i, el) => $(el).find('h2').text() === heading).find('.legal__facts');
    assert.equal(facts.children('p').length, 2, rel); // nom et site ; adresse et téléphone vides
    assert.match(facts.text(), /Hébergeur Exemple SAS/);
    assert.equal(facts.find('a').attr('href'), 'https://hebergeur.example/');
    assert.equal(facts.find('a').text(), 'https://hebergeur.example/');
  }
  setFr('mentions-legales.directeur-nom', 'Prénom Nom');
  await build();
  assert.match(page$('fr/mentions-legales')('main').text(), /Directeur de la publication : Prénom Nom/);
});

test('langue ajoutée plus tard : adresse et traductions complétées ; page supprimée non recréée', () => {
  db.prepare("INSERT INTO cms_languages (code, name, native_name, locale, booking_lang, is_default, is_active, position) VALUES ('nb', 'Norvégien', 'Norsk', 'nb-NO', 'en', 0, 0, 9)").run();
  setFr('mentions-legales.litiges', 'Texte modifié.');
  ensureLegalPage(db);
  const page = db.prepare("SELECT id FROM cms_pages WHERE key = 'mentions-legales'").pluck().get();
  assert.equal(db.prepare("SELECT path FROM cms_page_i18n WHERE page_id = ? AND lang = 'nb'").pluck().get(page), '/nb/juridisk-informasjon/');
  assert.equal(valueRow('mentions-legales.titre', 'nb').value, 'Juridisk informasjon');
  assert.equal(valueRow('mentions-legales.titre', 'nb').status, 'ready');
  assert.equal(valueRow('mentions-legales.litiges', 'nb').status, 'draft'); // français modifié : à relire
  db.prepare('DELETE FROM cms_pages WHERE id = ?').run(page);
  assert.equal(ensureLegalPage(db), 0);
  assert.equal(db.prepare("SELECT 1 FROM cms_pages WHERE key = 'mentions-legales'").get(), undefined);
});
