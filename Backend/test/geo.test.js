/**
 * GEO : robots.txt ouvert aux robots IA, llms.txt tiré des données, données structurées de la page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { robotsTxt, AI_BOTS } from '../server/ssg/sitemap.js';
import { llmsTxt } from '../server/ssg/llms.js';
import { faqFromDom, webPageNode } from '../server/ssg/jsonld.js';

test('robots.txt : chaque robot IA a les mêmes interdictions que « * »', () => {
  const txt = robotsTxt('https://exemple.fr');
  for (const bot of ['GPTBot', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot', 'Google-Extended']) assert.ok(AI_BOTS.includes(bot));
  const groups = txt.split(/\n\n/).filter((g) => g.includes('User-agent'));
  assert.equal(groups.length, 2);
  for (const g of groups) {
    assert.match(g, /Disallow: \/admin\//);
    assert.match(g, /Disallow: \/preview\//);
    assert.doesNotMatch(g, /Disallow: \/\n/);
  }
  assert.match(txt, /Sitemap: https:\/\/exemple\.fr\/sitemap\.xml/);
});

test('llms.txt : faits de l’hôtel et pages publiées de la langue', () => {
  const graph = [
    { '@type': 'Hotel', '@id': 'h', name: 'Hôtel Test', description: 'Un hôtel.', telephone: '+33 1', address: { streetAddress: '1 rue A', postalCode: '06000', addressLocality: 'Nice', addressCountry: 'FR' } },
    { '@type': 'Restaurant', '@id': 'r', name: 'Le Resto', description: 'Brasserie.', openingHoursSpecification: [{ dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '07:30', closes: '22:00' }] },
  ];
  const pages = [
    { lang: 'fr', path: '/fr/', title: 'Accueil', description: 'Desc', kind: 'page', inSitemap: true },
    { lang: 'fr', path: '/fr/chambres/a/', title: 'Chambre A', description: '', kind: 'rooms', inSitemap: true },
    { lang: 'fr', path: '/fr/cache/', title: 'Cachée', kind: 'page', inSitemap: false },
    { lang: 'en', path: '/en/', title: 'Home', kind: 'page', inSitemap: true },
  ];
  const txt = llmsTxt({ siteUrl: 'https://exemple.fr', lang: 'fr', graph, pages, homes: [{ lang: 'fr', name: 'Français', url: 'https://exemple.fr/fr/' }, { lang: 'en', name: 'English', url: 'https://exemple.fr/en/' }] });
  assert.match(txt, /^# Hôtel Test\n\n> Un hôtel\./);
  assert.match(txt, /- Adresse : 1 rue A, 06000 Nice, FR/);
  assert.match(txt, /\*\*Le Resto\*\* : Brasserie\. \(horaires tous les jours 07:30–22:00\)/);
  assert.match(txt, /- \[Accueil\]\(https:\/\/exemple\.fr\/fr\/\): Desc/);
  assert.match(txt, /## Chambres et suites\n\n- \[Chambre A\]/);
  assert.doesNotMatch(txt, /Cachée|\[Home\]/);
  assert.match(txt, /- \[English\]\(https:\/\/exemple\.fr\/en\/\)/);
});

test('FAQ : une réponse « à confirmer » reste hors des données structurées', () => {
  const $ = cheerio.load(`<main><section class="faq">
    <details><summary>Q1 ?</summary><p>Oui.</p></details>
    <details><summary>Q2 ?</summary><p><span class="verify">Peut-être</span></p></details></section></main>`);
  const faq = faqFromDom($);
  assert.deepEqual(faq.mainEntity.map((q) => q.name), ['Q1 ?']);
  const page = webPageNode({ url: 'https://exemple.fr/fr/faq/', name: 'FAQ', description: 'd', locale: 'fr-FR', siteUrl: 'https://exemple.fr', faq: faq.mainEntity });
  assert.deepEqual(page['@type'], ['WebPage', 'FAQPage']);
  assert.equal(page.isPartOf['@id'], 'https://exemple.fr/#website');
  assert.equal(page.about['@id'], 'https://exemple.fr/#hotel');
});
