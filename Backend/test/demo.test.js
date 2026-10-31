/**
 * Démo hébergée (Render…) : NOINDEX et DEMO_PASSWORD, écoute sur toutes les interfaces sous Render.
 * Chaque cas lance un processus neuf : la configuration est lue au chargement de config.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const backend = path.resolve(import.meta.dirname, '..');

function run(env, script) {
  const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-demo-'));
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: backend,
      env: { ...process.env, ASTON_NO_DOTENV: '1', ASTON_VAR_DIR: varDir, NOINDEX: '', DEMO_PASSWORD: '', RENDER: '', HOST: '', ...env },
      encoding: 'utf8',
    });
    return JSON.parse(out.trim().split('\n').pop());
  } finally {
    fs.rmSync(varDir, { recursive: true, force: true });
  }
}

const probe = `
import { buildApp } from './server/app.js';
const app = await buildApp({ logger: false, ingestFlushMs: 0 });
const auth = (p) => ({ authorization: 'Basic ' + Buffer.from('demo:' + p).toString('base64') });
const r = async (url, headers = {}) => { const res = await app.inject({ url, headers }); return { status: res.statusCode, robots: res.headers['x-robots-tag'] || null, body: res.body.slice(0, 60) }; };
const out = { admin: await r('/admin/'), robots: await r('/robots.txt'), health: await r('/api/health'), good: await r('/admin/', auth('s3cret')), bad: await r('/admin/', auth('faux')) };
await app.close();
console.log(JSON.stringify(out));
`;

test('par défaut : ni mot de passe ni noindex', () => {
  const out = run({}, probe);
  assert.equal(out.admin.status, 200);
  assert.equal(out.admin.robots, null);
});

test('NOINDEX=1 : en-tête X-Robots-Tag partout et robots.txt qui interdit tout', () => {
  const out = run({ NOINDEX: '1' }, probe);
  assert.equal(out.admin.status, 200);
  assert.equal(out.admin.robots, 'noindex, nofollow');
  assert.equal(out.robots.status, 200);
  assert.match(out.robots.body, /Disallow: \/\n/);
});

test('DEMO_PASSWORD : site fermé, sauf le contrôle de santé', () => {
  const out = run({ DEMO_PASSWORD: 's3cret' }, probe);
  assert.equal(out.admin.status, 401);
  assert.equal(out.bad.status, 401);
  assert.equal(out.good.status, 200);
  assert.equal(out.good.robots, 'noindex, nofollow');
  assert.equal(out.health.status, 200);
});

test('Render : écoute sur 0.0.0.0 sans HOST, HOST reste prioritaire', () => {
  const cfg = `import { config } from './server/config.js'; console.log(JSON.stringify({ host: config.host }));`;
  assert.equal(run({}, cfg).host, '127.0.0.1');
  assert.equal(run({ RENDER: 'true' }, cfg).host, '0.0.0.0');
  assert.equal(run({ RENDER: 'true', HOST: '127.0.0.1' }, cfg).host, '127.0.0.1');
});
