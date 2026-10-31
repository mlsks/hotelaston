/**
 * Langues livrées toutes traduites (seeds/langues : finnois, polonais, thaï, indonésien) :
 * créées et traduites au démarrage à partir du français de la base, sans jamais remplacer une
 * traduction existante ; un français modifié depuis reste à traduire.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-language-packs-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { runBuild } = await import('../server/ssg/build.js');
const { config } = await import('../server/config.js');
const { ensureLanguagePacks, readLanguagePacks } = await import('../server/ssg/language-packs.js');

const CODES = ['fi', 'pl', 'th', 'id'];
const packs = readLanguagePacks();
let db;
const quiet = { log: () => {} };
const page$ = (rel) => cheerio.load(fs.readFileSync(path.join(config.previewDir, rel, 'index.html'), 'utf8'));
const entryValue = (key, lang) => db.prepare('SELECT v.* FROM cms_entry_values v JOIN cms_entries e ON e.id = v.entry_id WHERE e.key = ? AND v.lang = ?').get(key, lang);
const pageRow = (key, lang) => db.prepare('SELECT t.* FROM cms_page_i18n t JOIN cms_pages p ON p.id = t.page_id WHERE p.key = ? AND t.lang = ?').get(key, lang);
const reapply = (code) => {
  db.prepare('DELETE FROM cms_settings WHERE key = ?').run(`language_pack.${code}`);
  return ensureLanguagePacks(db, { packs: packs.filter((p) => p.language.code === code), ...quiet })[0];
};

before(async () => {
  db = getDb();
  importLegacy(db, { writeTemplates: false, log: () => {} });
  await seedSitePhotos(db);
  ensureLanguagePacks(db, quiet); // textes des photos importées après la langue
});

after(() => {
  closeDb();
  fs.rmSync(VAR, { recursive: true, force: true });
});

test('paquets : 4 langues, adresses valides et uniques, balises et liens identiques au français', () => {
  assert.deepEqual(packs.map((p) => p.language.code), CODES);
  const tags = (s) => [...String(s).matchAll(/<\/?([a-z0-9]+)([^>]*)>/gi)].map((m) => `${m[1].toLowerCase()}${(m[2].match(/href="[^"]*"/) || [''])[0]}`).sort().join(' ');
  for (const p of packs) {
    const slugs = Object.values(p.pages);
    assert.ok(slugs.every((s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)), p.language.code);
    assert.equal(new Set(slugs).size, slugs.length, `${p.language.code} : deux pages à la même adresse`);
    for (const [fr, t] of Object.entries(p.texts)) assert.equal(tags(t), tags(fr), `${p.language.code} : ${fr}`);
  }
});

test('base neuve : les 4 langues existent, désactivées, avec tout le site traduit et prêt', () => {
  const langs = db.prepare('SELECT code, native_name, locale, booking_lang, is_active FROM cms_languages ORDER BY position').all();
  assert.deepEqual(langs.slice(-4).map((l) => [l.code, l.native_name, l.locale, l.is_active]),
    [['fi', 'Suomi', 'fi-FI', 0], ['pl', 'Polski', 'pl-PL', 0], ['th', 'ไทย', 'th-TH', 0], ['id', 'Bahasa Indonesia', 'id-ID', 0]]);
  for (const code of CODES) {
    const missing = db.prepare(`SELECT e.key FROM cms_entries e JOIN cms_entry_values f ON f.entry_id = e.id AND f.lang = 'fr'
      WHERE e.translatable = 1 AND e.type IN ('text', 'richtext') AND f.value <> ''
        AND NOT EXISTS (SELECT 1 FROM cms_entry_values v WHERE v.entry_id = e.id AND v.lang = ? AND v.status = 'ready')`).pluck().all(code);
    assert.deepEqual(missing, [], `${code} : textes sans traduction`);
    const notReady = (table, id) => db.prepare(`SELECT COUNT(*) FROM ${table} f WHERE f.lang = 'fr'
      AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.${id} = f.${id} AND t.lang = ? AND t.status = 'ready')`).pluck().get(code);
    assert.equal(notReady('cms_page_i18n', 'page_id'), 0, `${code} : pages`);
    assert.equal(notReady('cms_item_i18n', 'item_id'), 0, `${code} : fiches`);
    assert.equal(notReady('cms_banner_i18n', 'banner_id'), 0, `${code} : bandeaux`);
    assert.ok(db.prepare("SELECT COUNT(*) FROM cms_media_i18n WHERE lang = ? AND alt <> ''").pluck().get(code) > 0, `${code} : photos`);
  }
  assert.equal(pageRow('chambres', 'th').path, '/th/rooms/');
  assert.equal(pageRow('chambres', 'pl').path, '/pl/pokoje/');
  assert.equal(pageRow('politique-de-confidentialite', 'fi').path, '/fi/tietosuojakaytanto/');
  assert.match(entryValue('global.chat-pastille-animaux', 'id')?.value ?? '', /\p{L}/u);
});

test('activées : pages publiées en thaï et en polonais, sélecteur et hreflang, police thaïe', async () => {
  db.prepare("UPDATE cms_languages SET is_active = 1 WHERE code IN ('th', 'pl')").run();
  const build = await runBuild({ kind: 'preview', log: () => {} });
  assert.equal(build.status, 'success', build.error);
  assert.ok(['fr', 'pl', 'th'].every((l) => JSON.parse(build.langs).includes(l)), build.langs);
  const rooms = page$('th/rooms');
  assert.equal(rooms('html').attr('lang'), 'th');
  assert.match(rooms('title').text(), /[฀-๿]/);
  const hreflangs = rooms('link[rel="alternate"][hreflang]').map((i, l) => [[l.attribs.hreflang, l.attribs.href]]).get();
  for (const [l, href] of [['fr', '/fr/chambres/'], ['pl', '/pl/pokoje/'], ['th', '/th/rooms/']]) {
    assert.ok(hreflangs.some(([h, u]) => h === l && u.endsWith(href)), `${l} ${JSON.stringify(hreflangs)}`);
  }
  assert.equal(page$('fr/chambres')('.mobile-menu .lang-switch a[lang="th"]').text(), 'ไทย');
  assert.ok(fs.existsSync(path.join(config.previewDir, 'pl', 'karta-moon-bar', 'index.html')));
  const warnings = JSON.parse(build.warnings).filter((w) => /^\/(th|pl)\//.test(w) && !/caractères/.test(w));
  assert.deepEqual(warnings, []);
  const css = fs.readFileSync(new URL('../templates-src/assets/styles.css', import.meta.url), 'utf8');
  assert.match(css, /:lang\(th\) \{\s*--font-serif:[^}]*Thai/);
  db.prepare("UPDATE cms_languages SET is_active = 0 WHERE code IN ('th', 'pl')").run();
});

test('une traduction existante n’est jamais remplacée ; un paquet déjà passé ne repasse pas', () => {
  const id = db.prepare("SELECT id FROM cms_entries WHERE key = 'aston-club.006-p'").pluck().get();
  db.prepare("UPDATE cms_entry_values SET value = 'Oma käännös', status = 'draft' WHERE entry_id = ? AND lang = 'fi'").run(id);
  db.prepare("DELETE FROM cms_entry_values WHERE entry_id = ? AND lang = 'pl'").run(id);
  assert.deepEqual(ensureLanguagePacks(db, quiet), []); // déjà appliqués : la traduction supprimée ne revient pas
  assert.equal(entryValue('aston-club.006-p', 'pl'), undefined);
  const count = reapply('fi');
  assert.equal(count.textes, 0);
  assert.equal(entryValue('aston-club.006-p', 'fi').value, 'Oma käännös');
});

test('français modifié depuis : les titles raccourcis sont connus, un texte inconnu reste à traduire', () => {
  const pack = packs.find((p) => p.language.code === 'id');
  const short = 'Restaurant et bars à Nice | Hôtel Aston La Scala'; // docs/seo-geo.md
  db.prepare("UPDATE cms_page_i18n SET title = ? WHERE lang = 'fr' AND page_id = (SELECT id FROM cms_pages WHERE key = 'restaurant-bar')").run(short);
  db.prepare("UPDATE cms_entry_values SET value = 'Un texte réécrit dans l’admin' WHERE lang = 'fr' AND entry_id = (SELECT id FROM cms_entries WHERE key = 'aston-club.006-p')").run();
  const room = db.prepare("SELECT i.id, t.data FROM cms_items i JOIN cms_item_i18n t ON t.item_id = i.id AND t.lang = 'fr' WHERE i.collection = 'rooms' AND i.key = 'confort'").get();
  const data = { ...JSON.parse(room.data), title: 'Chambre Confort à Nice | Hôtel Aston La Scala ★★★★' };
  db.prepare("UPDATE cms_item_i18n SET data = ? WHERE item_id = ? AND lang = 'fr'").run(JSON.stringify(data), room.id);
  db.prepare("DELETE FROM cms_page_i18n WHERE lang = 'id'").run();
  db.prepare("DELETE FROM cms_item_i18n WHERE lang = 'id'").run();
  db.prepare("DELETE FROM cms_entry_values WHERE lang = 'id'").run();
  const count = reapply('id');
  assert.equal(count.manquants, 1);
  assert.equal(entryValue('aston-club.006-p', 'id'), undefined);
  const page = pageRow('restaurant-bar', 'id');
  assert.equal(page.status, 'ready');
  assert.equal(page.title, pack.texts[short]);
  assert.equal(page.path, '/id/restoran-bar/');
  const roomId = db.prepare("SELECT status, data FROM cms_item_i18n WHERE item_id = ? AND lang = 'id'").get(room.id);
  assert.equal(roomId.status, 'ready');
  assert.equal(JSON.parse(roomId.data).title, 'Kamar Confort di Nice | Hotel Aston La Scala ★★★★');
});
