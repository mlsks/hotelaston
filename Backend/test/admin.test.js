/**
 * Interface d'administration : fichiers servis, en-têtes de sécurité, bibliothèques figées,
 * messages d'erreur lisibles, données dont l'interface a besoin (site, pictogrammes, GeoIP).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-admin-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';
process.env.SITE_URL = 'https://www.hotel-aston.com';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');

let app;
let session;
const PASSWORD = 'mot-de-passe-de-test-123';
const call = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie: session.cookie, 'x-csrf-token': session.csrf } });

before(async () => {
  const db = getDb();
  importLegacy(db, { writeTemplates: false, log: () => {} });
  db.prepare(`INSERT INTO sys_users (email, name, password_hash, role, is_active, created_at) VALUES (?, 'Admin', ?, 'admin', 1, ?)`)
    .run('admin@test.fr', await hashPassword(PASSWORD), new Date().toISOString());
  app = await buildApp({ logger: false, ingestFlushMs: 0 });
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@test.fr', password: PASSWORD } });
  session = { cookie: res.headers['set-cookie'].split(';')[0], csrf: res.json().csrf };
});

after(async () => {
  await app?.close();
  closeDb();
  fs.rmSync(VAR, { recursive: true, force: true });
});

test('page de l’admin : en-têtes de sécurité, pas d’indexation', async () => {
  const res = await app.inject({ method: 'GET', url: '/admin/' });
  assert.equal(res.statusCode, 200);
  const csp = res.headers['content-security-policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /https:\/\/cdn|unpkg|jsdelivr/, 'aucun CDN tiers dans l’admin');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.match(res.body, /<meta name="robots" content="noindex, nofollow">/);
  // Tous les fichiers référencés par l'admin sont locaux
  for (const src of res.body.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(!/^https?:/.test(src[1]), src[1]);
});

test('bibliothèques servies depuis node_modules, avec cache conditionnel', async () => {
  for (const name of ['alpine.js', 'chart.js', 'tailwind.js']) {
    const res = await app.inject({ method: 'GET', url: `/admin/vendor/${name}` });
    assert.equal(res.statusCode, 200, name);
    assert.match(res.headers['content-type'], /javascript/);
    const again = await app.inject({ method: 'GET', url: `/admin/vendor/${name}`, headers: { 'if-none-match': res.headers.etag } });
    assert.equal(again.statusCode, 304);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/admin/vendor/inconnu.js' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/admin/vendor/..%2Fpackage.json' })).statusCode, 404);
});

test('chaque écran de l’admin a son fragment et ses morceaux partagés', () => {
  const dir = path.resolve('admin/views');
  const router = fs.readFileSync(path.resolve('admin/lib/router.js'), 'utf8');
  // « notfound » et « forbidden » sont écrits par le routeur lui-même
  const views = [...router.matchAll(/view: '([a-z]+)'/g)].map((m) => m[1]).filter((v) => !['notfound', 'forbidden'].includes(v));
  assert.ok(views.length >= 20);
  for (const v of views) {
    assert.ok(fs.existsSync(path.join(dir, `${v}.html`)), `views/${v}.html`);
    const html = fs.readFileSync(path.join(dir, `${v}.html`), 'utf8');
    for (const inc of html.matchAll(/data-include="([a-z-]+)"/g)) assert.ok(fs.existsSync(path.join(dir, 'parts', `${inc[1]}.html`)), inc[1]);
    // La racine porte un composant enregistré dans un module de views/
    const comp = /^<div x-data="([a-zA-Z]+)"/.exec(html)?.[1];
    assert.ok(comp, `views/${v}.html : racine x-data`);
    const modules = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    assert.ok(modules.includes(`Alpine.data('${comp}'`), `composant ${comp}`);
  }
});

test('erreurs de validation en français', async () => {
  const res = await call('POST', '/api/users', { email: 'pas-un-email', name: 'X', role: 'editor' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'E-mail : adresse e-mail invalide.');
  const missing = await call('POST', '/api/redirects', {});
  assert.match(missing.json().error, /champ obligatoire manquant \(Ancienne adresse\)/);
});

test('données pour l’interface : adresse du site, pictogrammes, état de la géolocalisation', async () => {
  const me = (await call('GET', '/api/auth/me')).json();
  assert.equal(me.site.url, 'https://www.hotel-aston.com');
  const icons = (await call('GET', '/api/icons')).json();
  const wifi = icons.find((i) => i.id === 'i-wifi');
  assert.ok(wifi && wifi.viewBox && wifi.body.includes('<'));
  const summary = (await call('GET', '/api/analytics/summary?period=week')).json();
  assert.equal(summary.geoip, false);
});
