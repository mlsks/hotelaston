/**
 * Documentation : la version HTML du guide utilisateur doit correspondre à son Markdown
 * (node tools/md-to-html.mjs docs/guide-utilisateur.md pour la régénérer).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { convert, slug } = await import('../../tools/md-to-html.mjs');

test('guide utilisateur : le HTML est à jour et ses ancres internes existent', () => {
  const md = fs.readFileSync(path.join(ROOT, 'docs', 'guide-utilisateur.md'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'guide-utilisateur.html'), 'utf8');
  assert.equal(html, convert(md, 'guide-utilisateur.md'), 'lancer : node tools/md-to-html.mjs docs/guide-utilisateur.md');
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(anchor), `ancre introuvable : #${anchor}`);
  assert.equal(slug('9. Référencement (SEO)'), '9-referencement-seo');
});
