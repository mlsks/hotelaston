/**
 * Base de géolocalisation : quand la télécharger, et jamais d'erreur si DB-IP ne répond pas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-geoip-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';

const { planGeoipUpdate, refreshGeoip, geoipActive } = await import('../server/analytics/geoip.js');

test('planGeoipUpdate : base absente, ancienne ou à jour', () => {
  assert.deepEqual(planGeoipUpdate([], '2026-11'), { update: true, city: false });
  assert.deepEqual(planGeoipUpdate([], '2026-11', 'city'), { update: true, city: true });
  assert.deepEqual(planGeoipUpdate(['dbip-country-lite-2026-10.mmdb'], '2026-11'), { update: true, city: false });
  assert.deepEqual(planGeoipUpdate(['dbip-country-lite-2026-11.mmdb'], '2026-11'), { update: false, city: false });
  // L'édition installée l'emporte sur GEOIP_EDITION
  assert.deepEqual(planGeoipUpdate(['dbip-city-lite-2026-09.mmdb'], '2026-11', 'country'), { update: true, city: true });
  assert.deepEqual(planGeoipUpdate(['dbip-country-lite-2026-11.mmdb'], '2026-11', 'city'), { update: false, city: false });
  // Base posée à la main sous un autre nom : on n'y touche pas
  assert.deepEqual(planGeoipUpdate(['GeoLite2-Country.mmdb'], '2026-11'), { update: false, city: false });
});

test('refreshGeoip : DB-IP indisponible → pas d’erreur, rien d’installé', async () => {
  const logs = [];
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: false, status: 404 }; };
  assert.equal(await refreshGeoip({ log: (m) => logs.push(m), fetchImpl }), null);
  assert.match(urls[0], /^https:\/\/download\.db-ip\.com\/free\/dbip-country-lite-\d{4}-\d{2}\.mmdb\.gz$/);
  assert.ok(logs.some((m) => m.includes('nouvel essai')));
  assert.equal(geoipActive(), false);
  assert.deepEqual(fs.existsSync(path.join(VAR, 'storage', 'geoip')) ? fs.readdirSync(path.join(VAR, 'storage', 'geoip')) : [], []);
});

test('refreshGeoip : fichier reçu illisible → rejeté, pas d’erreur', async () => {
  const zlib = await import('node:zlib');
  const body = zlib.gzipSync(Buffer.from('pas une base'));
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => body });
  assert.equal(await refreshGeoip({ fetchImpl }), null);
  assert.deepEqual(fs.readdirSync(path.join(VAR, 'storage', 'geoip')), []);
  assert.equal(geoipActive(), false);
});
