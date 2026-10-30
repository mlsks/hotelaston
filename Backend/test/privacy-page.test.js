/**
 * Page Politique de confidentialité : créée après l'import avec ses textes dans toutes les langues livrées,
 * date de mise à jour à remplir (ligne masquée tant qu'elle est vide), liens de l'ancien site
 * (pied de page, formulaire de devis) redirigés vers la nouvelle page, bouton de refus de la mesure d'audience.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-privacy-page-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { runBuild } = await import('../server/ssg/build.js');
const { config } = await import('../server/config.js');
const { ensurePrivacyPage } = await import('../server/ssg/legal-page.js');
const { sha } = await import('../server/lib/util.js');

let db;
const seed = JSON.parse(fs.readFileSync(new URL('../server/db/seeds/politique-de-confidentialite-page.json', import.meta.url), 'utf8'));
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
  const $ = cheerio.load(fs.readFileSync(path.join(config.templatesDir, 'pages', 'politique-de-confidentialite.html'), 'utf8'), null, false);
  for (const [key, e] of Object.entries(seed.entries)) {
    const el = $(`[data-cms-key="${key}"], [data-cms-html="${key}"]`).first();
    const fr = el.length ? (e.type === 'richtext' ? el.html() : el.text()) : $(`[data-cms-attr*=":${key}"]`).attr('aria-label');
    assert.equal(fr, e.values.fr, key);
    assert.equal(Object.keys(e.values).length, e.translatable ? 13 : 1, key);
    // Les adresses e-mail et les liens sont les mêmes dans toutes les langues
    const links = (html) => [...String(html).matchAll(/href="([^"]+)"/g)].map((m) => m[1]).join(' ');
    for (const [lang, v] of Object.entries(e.values)) assert.equal(links(v), links(e.values.fr), `${key} ${lang}`);
  }
  assert.equal(Object.keys(seed.page.i18n).length, 13);
  for (const [lang, p] of Object.entries(seed.page.i18n)) {
    assert.ok(p.title.length <= 60 && p.description.length <= 160, lang);
    assert.match(p.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, lang);
  }
});

test('page créée une fois, sous l’accueil, adresse traduite ; ancien lien du devis redirigé, traductions toujours à jour', () => {
  const page = db.prepare("SELECT * FROM cms_pages WHERE key = 'politique-de-confidentialite'").get();
  assert.equal(page.template, 'pages/politique-de-confidentialite.html');
  assert.equal(page.parent_id, db.prepare("SELECT id FROM cms_pages WHERE key = 'accueil'").pluck().get());
  const meta = (lang) => db.prepare('SELECT * FROM cms_page_i18n WHERE page_id = ? AND lang = ?').get(page.id, lang);
  assert.equal(meta('fr').path, '/fr/politique-de-confidentialite/');
  assert.equal(meta('en').path, '/en/privacy-policy/');
  assert.equal(meta('de').path, '/de/datenschutz/');
  assert.equal(valueRow('confidentialite.audience', 'it').status, 'ready');
  assert.equal(valueRow('confidentialite.maj-date', 'fr').value, '');
  assert.equal(valueRow('confidentialite.maj-date', 'en'), undefined);
  assert.equal(ensurePrivacyPage(db), 0); // une seule fois

  // Le texte du formulaire de devis pointait vers l'ancien site, en français comme dans ses traductions
  const fr = valueRow('devis.039-p', 'fr');
  assert.match(fr.value, /href="#\/politique-de-confidentialite"/);
  assert.doesNotMatch(fr.value, /hotel-aston\.com/);
  const entry = db.prepare("SELECT id FROM cms_entries WHERE key = 'devis.039-p'").pluck().get();
  const old = 'Vos données… <a href="https://www.hotel-aston.com/fr/politique-de-confidentialite">Politique</a>.';
  const oldEn = 'Your data… <a href="https://www.hotel-aston.com/privacy-policy">Privacy policy</a>.';
  db.prepare("UPDATE cms_entry_values SET value = ?, source_hash = ? WHERE entry_id = ? AND lang = 'fr'").run(old, sha(old), entry);
  db.prepare(`INSERT INTO cms_entry_values (entry_id, lang, value, status, source_hash, updated_at) VALUES (?, 'en', ?, 'ready', ?, '')
    ON CONFLICT (entry_id, lang) DO UPDATE SET value = excluded.value, source_hash = excluded.source_hash`).run(entry, oldEn, sha(old));
  ensurePrivacyPage(db);
  const frNow = valueRow('devis.039-p', 'fr');
  const enNow = valueRow('devis.039-p', 'en');
  assert.equal(frNow.value, 'Vos données… <a href="#/politique-de-confidentialite">Politique</a>.');
  assert.equal(enNow.value, 'Your data… <a href="#/politique-de-confidentialite">Privacy policy</a>.');
  assert.equal(enNow.source_hash, sha(frNow.value)); // la traduction suit toujours le français
});

test('page dans chaque langue : date masquée tant qu’elle est vide, bouton de refus, liens du pied de page et du devis', async () => {
  const warnings = await build();
  assert.ok(warnings.some((w) => /Date de mise à jour.*vide : bloc masqué/.test(w)), warnings.join('\n'));
  assert.ok(!warnings.some((w) => /politique-de-confidentialite/.test(w) && /lien/i.test(w)), warnings.join('\n'));
  const fr = page$('fr/politique-de-confidentialite');
  assert.equal(fr('main h1').text(), 'Politique de confidentialité');
  assert.match(fr('main').text(), /13 mois/);
  assert.match(fr('main').text(), /aston@3ahotels\.com/);
  assert.doesNotMatch(fr('main').text(), /Dernière mise à jour/);
  assert.equal(fr('main [data-no-stats] [data-no-stats-toggle]').length, 1);
  assert.equal(fr('.site-footer__legal a').eq(1).attr('href'), '/preview/fr/politique-de-confidentialite/');
  assert.equal(page$('fr/devis')('main a[href*="confidentialite"]').attr('href'), '/preview/fr/politique-de-confidentialite/');
  const en = page$('en/privacy-policy');
  assert.equal(en('main h1').text(), 'Privacy policy');
  assert.match(en('main').text(), /Stop counting my visits/);
  assert.equal(en('.site-footer__legal a').eq(1).attr('href'), '/preview/en/privacy-policy/');

  setFr('confidentialite.maj-date', '30/10/2026');
  await build();
  assert.match(page$('fr/politique-de-confidentialite')('main').text(), /Dernière mise à jour : 30\/10\/2026/);
  assert.match(page$('en/privacy-policy')('main').text(), /Last updated: 30\/10\/2026/);
});

test('page supprimée : non recréée', () => {
  db.prepare("DELETE FROM cms_pages WHERE key = 'politique-de-confidentialite'").run();
  assert.equal(ensurePrivacyPage(db), 0);
  assert.equal(db.prepare("SELECT 1 FROM cms_pages WHERE key = 'politique-de-confidentialite'").get(), undefined);
});
