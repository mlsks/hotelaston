/**
 * L'import (pose des data-cms-*) et le build (injection) doivent voir les mêmes textes :
 * réinjecter les valeurs extraites redonne exactement le HTML de départ.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { Extractor } from '../server/db/import-legacy.js';
import { injectTexts } from '../server/ssg/annotations.js';

const SAMPLE = `<section class="view" data-route="test">
  <nav class="breadcrumb" aria-label="Fil d'Ariane"><a href="#/">Accueil</a><span aria-hidden="true">›</span><span aria-current="page">Test</span></nav>
  <h1>Titre <em>riche</em> &amp; accents</h1>
  <p>Du <a href="#/moon-bar">Moon Bar</a>, sur le toit.</p>
  <p>Texte puis <a href="#/reserver" data-book>Réserver</a> en ligne</p>
  <ul class="extras"><li><svg class="icon" aria-hidden="true"><use href="#i-sun"/></svg>Plage partenaire à 500 m</li></ul>
  <img src="x.jpg" alt="Une photo">
  <strong data-count-to="360">360°</strong>
  <svg viewBox="0 0 10 10"><title>Plan</title><text x="1" y="1">Vieille Ville</text></svg>
</section>`;

function extract(html) {
  const $ = cheerio.load(html, null, false);
  const ex = new Extractor();
  ex.walk($, $.root().children()[0], 'test');
  return { $, entries: ex.entries };
}

const visible = ($) => $.root().text().replace(/\s+/g, ' ').trim();

test("l'extraction couvre textes, textes riches, nœuds mêlés aux icônes et attributs", () => {
  const { entries } = extract(SAMPLE);
  const values = entries.map((e) => e.value.trim());
  assert.ok(values.includes('Accueil'));
  assert.ok(values.includes('Titre <em>riche</em> &amp; accents'), 'texte riche conservé en HTML');
  assert.ok(values.includes('Plage partenaire à 500 m'), 'texte à côté d\'une icône SVG');
  assert.ok(values.includes('Une photo'), 'attribut alt');
  assert.ok(values.includes('Vieille Ville'), 'texte d\'un plan SVG');
  assert.ok(values.includes('Réserver'), 'lien porteur de data-book traité à part');
  assert.ok(!values.includes('360°') && !values.includes('›'), 'sans lettre : non éditable');
});

test('réinjecter les valeurs extraites redonne le même texte visible', () => {
  const original = cheerio.load(SAMPLE, null, false);
  const { $, entries } = extract(SAMPLE);
  const byKey = new Map(entries.map((e) => [e.key, e.value]));
  injectTexts($, (key) => ({ value: byKey.get(key), missing: false }));
  assert.equal(visible($), visible(original));
  assert.equal($('img').attr('alt'), 'Une photo');
});

test('une valeur modifiée remplace le bon texte, et seulement lui', () => {
  const { $, entries } = extract(SAMPLE);
  const target = entries.find((e) => e.value.includes('Plage partenaire'));
  const byKey = new Map(entries.map((e) => [e.key, e.key === target.key ? 'Partner beach 500 m away' : e.value]));
  injectTexts($, (key) => ({ value: byKey.get(key), missing: false }));
  assert.match($('.extras li').text(), /Partner beach 500 m away/);
  assert.equal($('.extras li svg').length, 1, "l'icône est conservée");
  assert.match($('h1').html(), /<em>riche<\/em>/);
});
