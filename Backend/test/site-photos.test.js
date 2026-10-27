import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertTemplates } from '../server/media/site-photos.js';

const CDN = 'https://d1i8cf9j7dueks.cloudfront.net/cache/img/';

test('photos du CDN : les gabarits passent sur la médiathèque, relance sans effet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-photos-'));
  try {
    fs.mkdirSync(path.join(dir, 'pages'));
    fs.writeFileSync(path.join(dir, 'layout.html'), `<head>\n  <link rel="preconnect" href="https://d1i8cf9j7dueks.cloudfront.net" crossorigin="">\n</head><footer><img src="${CDN}logo-234599-500-406-landscape.png" alt="Logo" width="160" height="130" loading="lazy"></footer>`);
    fs.writeFileSync(path.join(dir, 'pages', 'offres.html'), [
      `<img src="${CDN}salle-242915-825-500-crop.jpg" srcset="${CDN}salle-242915-825-500-crop.jpg 825w, ${CDN}salle-242915-1650-1000-crop.jpg 1650w" sizes="100vw" alt="Salle" width="825" height="500" data-cms-attr="alt:offres.001-img@alt">`,
      `<img src="${CDN}piscine-234600-1280-600-portrait.jpg" alt="" width="900" height="600" loading="lazy">`,
      '<img src="/static/img/local.png" alt="Local">',
    ].join('\n'));

    const manifest = convertTemplates(dir);
    assert.deepEqual(Object.keys(manifest).sort(), ['global.logo', 'offres.photo-1', 'offres.photo-2']);
    assert.equal(manifest['offres.photo-1'].url, `${CDN}salle-242915-1650-1000-crop.jpg`); // la plus grande taille du srcset
    assert.equal(manifest['offres.photo-1'].alt, 'Salle');

    const page = fs.readFileSync(path.join(dir, 'pages', 'offres.html'), 'utf8');
    assert.ok(!page.includes('cloudfront'));
    assert.match(page, /<img data-cms-media="offres\.photo-1" data-cms-sizes="100vw" alt="Salle" data-cms-attr="alt:offres\.001-img@alt">/);
    assert.match(page, /data-cms-media="offres\.photo-2"[^>]*data-cms-decorative[^>]*data-cms-portrait="off"/);
    assert.match(page, /src="\/static\/img\/local\.png"/);
    assert.ok(!fs.readFileSync(path.join(dir, 'layout.html'), 'utf8').includes('cloudfront'));

    assert.deepEqual(convertTemplates(dir), manifest);
    assert.equal(fs.readFileSync(path.join(dir, 'pages', 'offres.html'), 'utf8'), page);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
