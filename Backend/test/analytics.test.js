/**
 * Statistiques (niveau 1) : classement des visites, périodes, parcours simulé de bout en bout,
 * confidentialité (pas d'IP, sel quotidien), droits de lecture.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-stats-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';

const { getDb, closeDb } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { hashPassword } = await import('../server/auth/auth.js');
const { buildApp } = await import('../server/app.js');
const { channelOf, deviceOf, isBot } = await import('../server/analytics/classify.js');
const { periodRange } = await import('../server/analytics/queries.js');
const { setGeoReader } = await import('../server/analytics/geoip.js');
const { createIngest } = await import('../server/analytics/ingest.js');
const { aggregateDay } = await import('../server/analytics/aggregate.js');
const { dayIn } = await import('../server/lib/util.js');
const { config } = await import('../server/config.js');

let app;
let db;
const s = {};
const PASSWORD = 'mot-de-passe-de-test-123';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const today = () => dayIn(new Date(), config.timezone);

const track = (body, { ua = DESKTOP, ip = '1.2.3.4', lang = 'fr-FR' } = {}) => app.inject({
  method: 'POST', url: '/api/track', payload: JSON.stringify(body),
  headers: { 'content-type': 'text/plain', 'user-agent': ua, 'x-forwarded-for': ip, 'accept-language': lang },
});
const get = (who, url) => app.inject({ method: 'GET', url, headers: { cookie: s[who].cookie } });

before(async () => {
  db = getDb();
  importLegacy(db, { writeTemplates: false, log: () => {} });
  const hash = await hashPassword(PASSWORD);
  const add = db.prepare(`INSERT INTO sys_users (email, name, password_hash, role, scopes, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`);
  add.run('admin@test.fr', 'Admin', hash, 'admin', null, new Date().toISOString());
  add.run('live@test.fr', 'Live', hash, 'editor', '["live-music"]', new Date().toISOString());
  add.run('translator@test.fr', 'Trad', hash, 'translator', null, new Date().toISOString());
  setGeoReader({ get: (ip) => ({ '1.2.3.4': { country: { iso_code: 'FR' }, subdivisions: [{ iso_code: 'PAC' }] }, '5.6.7.8': { country: { iso_code: 'GB' } } }[ip] || null) });
  app = await buildApp({ logger: false, ingestFlushMs: 0 });
  for (const who of ['admin', 'live', 'translator']) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${who}@test.fr`, password: PASSWORD } });
    s[who] = { cookie: res.headers['set-cookie'].split(';')[0] };
  }
});

after(async () => {
  await app?.close();
  closeDb();
  fs.rmSync(VAR, { recursive: true, force: true });
});

test('canaux, appareils et robots', () => {
  assert.equal(channelOf({ referrer: 'chatgpt.com' }), 'ai');
  assert.equal(channelOf({ referrer: 'perplexity.ai' }), 'ai');
  assert.equal(channelOf({ referrer: 'mail.google.com' }), 'email');
  assert.equal(channelOf({ referrer: 'google.fr' }), 'organic');
  assert.equal(channelOf({ referrer: 'booking.com' }), 'metasearch');
  assert.equal(channelOf({ referrer: 'l.instagram.com' }), 'social');
  assert.equal(channelOf({ referrer: 'nice-tourisme.com' }), 'referral');
  assert.equal(channelOf({ referrer: null }), 'direct');
  assert.equal(channelOf({ referrer: 'google.fr', utm: { medium: 'cpc' } }), 'paid');
  assert.equal(channelOf({ referrer: null, paid: true }), 'paid');
  assert.equal(channelOf({ referrer: null, utm: { medium: 'newsletter', source: 'printemps' } }), 'email');
  assert.equal(deviceOf(IPHONE), 'mobile');
  assert.equal(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'tablet');
  assert.equal(deviceOf(DESKTOP), 'desktop');
  assert.ok(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)') && isBot('curl/8.4') && isBot('') && !isBot(DESKTOP));
});

test('périodes : semaine du lundi au dimanche, mois, année, période précédente', () => {
  assert.deepEqual(periodRange('week', '2026-10-28'), { period: 'week', from: '2026-10-26', to: '2026-11-01', previous: { from: '2026-10-19', to: '2026-10-25' } });
  assert.deepEqual(periodRange('month', '2026-03-15'), { period: 'month', from: '2026-03-01', to: '2026-03-31', previous: { from: '2026-02-01', to: '2026-02-28' } });
  assert.deepEqual(periodRange('year', '2026-10-28').previous, { from: '2025-01-01', to: '2025-12-31' });
});

test('parcours simulé : de ChatGPT au moteur de réservation, avec bandeau attribué', async () => {
  const arrival = dayIn(new Date(Date.now() + 20 * 864e5), config.timezone);
  // Visiteur A : arrive depuis ChatGPT, clique le bandeau, consulte une chambre, cherche des dates, part vers le moteur
  assert.equal((await track({ t: 'pageview', p: '/fr/', l: 'fr', tp: 'accueil', r: 'https://chatgpt.com/c/123' })).statusCode, 204);
  await track({ t: 'banner_view', p: '/fr/', l: 'fr', s: 'banner:1', e: 'banner', i: '1' });
  await track({ t: 'banner_click', p: '/fr/', l: 'fr', s: 'banner:1', e: 'banner', i: '1' });
  await track({ t: 'pageview', p: '/fr/chambres/confort/?utm_source=x', l: 'fr', tp: 'chambre', r: 'https://www.hotel-aston.com/fr/' });
  const intent = { p: '/fr/chambres/confort/', l: 'fr', tp: 'chambre', s: 'room:confort', via: 'banner:1', a: arrival, n: 2, ad: 2, ch: 1, g: 'confort' };
  await track({ t: 'booking_search', ...intent });
  await track({ t: 'booking_click', ...intent });
  await track({ t: 'engagement', p: '/fr/chambres/confort/', l: 'fr', tp: 'chambre', ms: 15000, sp: 80 });
  await track({ t: 'web_vital', p: '/fr/chambres/confort/', l: 'fr', tp: 'chambre', m: 'LCP', v: 1800 });
  await track({ t: 'chat_question', p: '/fr/chambres/confort/', l: 'fr', e: 'chat', i: 'parking' });
  // Visiteur B : depuis Google sur iPhone, une page, peu de temps
  await track({ t: 'pageview', p: '/fr/', l: 'fr', tp: 'accueil', r: 'https://www.google.fr/' }, { ua: IPHONE, ip: '5.6.7.8', lang: 'en-GB' });
  await track({ t: 'engagement', p: '/fr/', l: 'fr', tp: 'accueil', ms: 3000, sp: 20 }, { ua: IPHONE, ip: '5.6.7.8', lang: 'en-GB' });
  await track({ t: 'phone_click', p: '/fr/', l: 'fr', s: 'bottom_bar' }, { ua: IPHONE, ip: '5.6.7.8', lang: 'en-GB' });
  // Ignorés : robot, type inconnu, adresse invalide
  await track({ t: 'pageview', p: '/fr/', l: 'fr' }, { ua: 'Googlebot/2.1' });
  await track({ t: 'piratage', p: '/fr/' });
  await track({ t: 'pageview', p: 'javascript:alert(1)' });
  assert.ok(app.ingest.flush() >= 12);

  const q = `?period=month&date=${today()}`;
  const sum = (await get('admin', `/api/analytics/summary${q}`)).json().current;
  assert.deepEqual(
    [sum.visitors, sum.visits, sum.pageviews, sum.searches, sum.booking_clicks, sum.converting_visits, sum.engaged_visits, sum.contacts],
    [2, 2, 3, 1, 1, 1, 2, 1],
  );
  assert.equal(sum.conversion_rate, 50);

  const top = async (dim) => (await get('admin', `/api/analytics/top${q}&dim=${dim}`)).json().rows;
  assert.deepEqual((await top('channel')).map((r) => [r.key, r.visits, r.converting_visits]).sort(), [['ai', 1, 1], ['organic', 1, 0]]);
  assert.deepEqual((await top('country')).map((r) => r.key).sort(), ['FR', 'GB']);
  assert.deepEqual((await top('region')).find((r) => r.key === 'FR-PAC')?.visits, 1);
  assert.deepEqual((await top('device')).map((r) => r.key).sort(), ['desktop', 'mobile']);
  assert.equal((await top('browser_lang')).find((r) => r.key === 'en').visits, 1);
  assert.equal((await top('source'))[0].key, 'room:confort');
  const banner = (await top('element')).find((r) => r.key === 'banner:1');
  assert.deepEqual([banner.views, banner.clicks, banner.booking_clicks], [1, 1, 1]);
  assert.equal((await top('chat'))[0].key, 'parking');
  assert.equal((await top('contact'))[0].key, 'phone_click · bottom_bar');
  assert.equal((await top('page')).find((r) => r.key === '/fr/chambres/confort/').avg_scroll_pct, 80);

  const funnel = (await get('admin', `/api/analytics/funnel${q}`)).json().steps.map((st) => st.count);
  assert.deepEqual(funnel, [2, 1, 1, 1]);
  const demand = (await get('admin', `/api/analytics/demand${q}`)).json();
  assert.equal(demand.searches, 1);
  assert.equal(demand.lead_time.find((b) => b.key === '8 à 30 jours').searches, 1);
  assert.deepEqual(demand.party, [{ key: '2 adulte(s) + 1 enfant(s)', searches: 1 }]);
  assert.match(demand.arrivals_by_week[0].key, /^\d{4}-S\d{2}$/);
  const lcp = (await get('admin', `/api/analytics/vitals${q}`)).json().rows.find((r) => r.metric === 'LCP' && r.template === '*');
  assert.deepEqual([lcp.p75, lcp.rating], [1800, 'bon']);
  const points = (await get('admin', `/api/analytics/timeseries${q}`)).json().points;
  assert.equal(points.find((p) => p.bucket === today()).visits, 2);
  const csv = await get('admin', `/api/analytics/export.csv${q}&report=top&dim=channel`);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.body, /^﻿key;visits/);

  // Filtres croisés
  const mobile = (await get('admin', `/api/analytics/summary${q}&device=mobile`)).json().current;
  assert.deepEqual([mobile.visits, mobile.booking_clicks], [1, 0]);

  // Agrégats quotidiens
  aggregateDay(db, today());
  assert.equal(db.prepare("SELECT value FROM an_daily WHERE day = ? AND metric = 'visits' AND dim = ''").pluck().get(today()), 2);
  assert.equal(db.prepare("SELECT value FROM an_daily WHERE day = ? AND metric = 'visits' AND dim = 'channel:ai'").pluck().get(today()), 1);
});

test('confidentialité : ni IP ni identifiant durable, sel quotidien supprimé le surlendemain', () => {
  const cols = db.prepare('PRAGMA table_info(an_visits)').all().map((c) => c.name).concat(db.prepare('PRAGMA table_info(an_events)').all().map((c) => c.name));
  assert.ok(!cols.some((c) => /ip|user_agent/.test(c)));
  const dump = JSON.stringify(db.prepare('SELECT * FROM an_visits').all()) + JSON.stringify(db.prepare('SELECT * FROM an_events').all());
  assert.doesNotMatch(dump, /1\.2\.3\.4|5\.6\.7\.8|Chrome\/130|chatgpt\.com\/c\/123/);
  assert.ok(db.prepare('SELECT visitor FROM an_visits').pluck().all().every((v) => /^[0-9a-f]{16}$/.test(v)));

  let clock = new Date('2030-01-01T10:00:00Z');
  const ingest = createIngest(db, { flushMs: 0, now: () => clock });
  const hit = () => ingest.accept({ t: 'pageview', p: '/fr/' }, { ip: '9.9.9.9', ua: DESKTOP });
  hit();
  const firstVisitor = db.prepare("SELECT 1 FROM an_salts WHERE day = '2030-01-01'").get();
  assert.ok(firstVisitor);
  clock = new Date('2030-01-04T10:00:00Z');
  hit();
  ingest.flush();
  assert.equal(db.prepare("SELECT COUNT(*) FROM an_salts WHERE day = '2030-01-01'").pluck().get(), 0, 'sel du 1er janvier supprimé le 4');
  const visitors = db.prepare("SELECT DISTINCT visitor FROM an_visits WHERE day IN ('2030-01-01', '2030-01-04')").pluck().all();
  assert.equal(visitors.length, 2, 'le même visiteur n’est pas reliable d’un jour à l’autre');
  db.prepare("DELETE FROM an_events WHERE day >= '2030-01-01'").run();
  db.prepare("DELETE FROM an_visits WHERE day >= '2030-01-01'").run();
});

test('lecture réservée aux administrateurs et éditeurs sans périmètre', async () => {
  assert.equal((await get('admin', '/api/analytics/summary')).statusCode, 200);
  assert.equal((await get('live', '/api/analytics/summary')).statusCode, 403);
  assert.equal((await get('translator', '/api/analytics/summary')).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/api/analytics/summary' })).statusCode, 401);
});
