/**
 * Application Fastify : API du back-office, prévisualisation protégée, fichiers du site.
 * Construite par une fonction pour être testée sans ouvrir de port (app.inject).
 * En production, Caddy sert lui-même public-dist et media/ ; Node reçoit /api, /admin et /preview.
 */
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { getDb } from './db/connection.js';
import { authPlugin } from './auth/auth.js';
import authRoutes from './routes/auth.js';
import contentRoutes from './routes/content.js';
import collectionRoutes from './routes/collections.js';
import menuRoutes from './routes/menus.js';
import mediaRoutes from './routes/media.js';
import bannerRoutes from './routes/banners.js';
import translationRoutes from './routes/translations.js';
import buildRoutes from './routes/builds.js';
import userRoutes from './routes/users.js';
import analyticsRoutes from './routes/analytics.js';
import googleReviewRoutes from './routes/google-reviews.js';
import { createIngest } from './analytics/ingest.js';
import { loadGeoip } from './analytics/geoip.js';
import { currentBuild } from './ssg/release.js';
import { adminVendor, ADMIN_HEADERS } from './admin-assets.js';

/** Erreur de validation de schéma en français lisible (le message d'Ajv est en anglais). */
const FIELDS = { email: 'E-mail', name: 'Nom', password: 'Mot de passe', title: 'Title', slug: 'Adresse', text: 'Texte', meta_description: 'Description', from_path: 'Ancienne adresse', code: 'Code' };
function validationMessage(v) {
  const p = v.params || {};
  const key = (v.instancePath || '').split('/').filter(Boolean).pop();
  const field = FIELDS[key] || key || 'Requête';
  const what = {
    format: p.format === 'email' ? 'adresse e-mail invalide' : `format attendu : ${p.format}`,
    required: `champ obligatoire manquant (${FIELDS[p.missingProperty] || p.missingProperty})`,
    additionalProperties: `champ inconnu (${p.additionalProperty})`,
    maxLength: `${p.limit} caractères au plus`, minLength: `${p.limit} caractère(s) au moins`,
    maximum: `${p.limit} au plus`, minimum: `${p.limit} au moins`, maxItems: `${p.limit} éléments au plus`,
    pattern: 'format invalide', enum: `valeur non autorisée (${(p.allowedValues || []).join(', ')})`, type: `valeur de type ${p.type} attendue`,
  }[v.keyword] || v.message;
  return `${field} : ${what}.`;
}

export async function buildApp({ logger = { level: 'info' }, ingestFlushMs = 2000 } = {}) {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
  const db = getDb();
  const defaultLang = () => db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get() || 'fr';

  for (const dir of [config.mediaDir, config.previewDir]) fs.mkdirSync(dir, { recursive: true });

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });
  await app.register(fastifyMultipart, { limits: { files: 1, fileSize: Math.max(...Object.values(config.uploadMaxMb)) * 1024 * 1024 } });
  authPlugin(app, db);

  // JSON vide accepté (DELETE, POST sans corps envoyés avec Content-Type: application/json)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (body === '') return done(null, undefined);
    try {
      return done(null, JSON.parse(body));
    } catch (err) {
      err.statusCode = 400;
      return done(err);
    }
  });

  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode || (err.validation ? 400 : 500);
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'Erreur interne du serveur.' : err.validation ? validationMessage(err.validation[0]) : err.message });
  });

  /* Redirections de confort */
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (url === '/') return reply.redirect(`/${defaultLang()}/`, 302);
    if (url === '/preview' || url === '/preview/') return reply.redirect(`/preview/${defaultLang()}/`, 302);
    return undefined;
  });

  /* Prévisualisation : réservée aux personnes connectées */
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/preview/')) return undefined;
    if (req.user) return undefined;
    const accepts = String(req.headers.accept || '');
    if (accepts.includes('text/html')) return reply.redirect(`/admin/?next=${encodeURIComponent(req.url)}`, 302);
    return reply.code(401).send({ error: 'Connexion requise.' });
  });

  app.get('/api/health', async () => {
    const cur = currentBuild(db);
    return { ok: true, online: cur ? { build: cur.id, since: cur.finished_at } : null };
  });

  // Statistiques : base GeoIP locale (facultative) et file d'écriture par lots
  await loadGeoip({ log: (m) => app.log.info(m) });
  const ingest = createIngest(db, { flushMs: ingestFlushMs });
  app.decorate('ingest', ingest);
  app.addHook('onClose', async () => ingest.close());

  const ctx = { db, defaultLang, ingest };
  await app.register(async (api) => {
    analyticsRoutes(api, ctx);
    authRoutes(api, ctx);
    contentRoutes(api, ctx);
    collectionRoutes(api, ctx);
    menuRoutes(api, ctx);
    mediaRoutes(api, ctx);
    bannerRoutes(api, ctx);
    translationRoutes(api, ctx);
    buildRoutes(api, ctx);
    userRoutes(api, ctx);
    googleReviewRoutes(api, ctx);
  }, { prefix: '/api' });

  /* Back-office : en-têtes de sécurité et bibliothèques servies depuis node_modules (versions figées) */
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/admin')) reply.headers(ADMIN_HEADERS);
  });
  const vendor = adminVendor();
  app.get('/admin/vendor/:file', async (req, reply) => {
    const file = vendor.get(req.params.file);
    if (!file) return reply.code(404).send({ error: 'Fichier inconnu.' });
    reply.header('ETag', file.etag).header('Cache-Control', 'public, max-age=3600');
    if (req.headers['if-none-match'] === file.etag) return reply.code(304).send();
    return reply.type('text/javascript; charset=utf-8').send(file.body);
  });

  /* Fichiers */
  app.register(fastifyStatic, { root: config.mediaDir, prefix: '/media/', decorateReply: false, maxAge: '365d', immutable: true });
  app.register(fastifyStatic, { root: config.previewDir, prefix: '/preview/', decorateReply: false, redirect: true });
  if (fs.existsSync(config.adminDir)) app.register(fastifyStatic, { root: config.adminDir, prefix: '/admin/', decorateReply: false, redirect: true });
  if (config.serveLegacy) {
    // Développement uniquement : l'ancien site d'une seule page, pour comparer avec la prévisualisation
    app.register(fastifyStatic, {
      root: config.legacyDir, prefix: '/legacy/', decorateReply: false, redirect: true,
      allowedPath: (p) => !/^\/?Backend(\/|$)/i.test(p),
    });
  }
  app.register(fastifyStatic, {
    root: config.publicDist, prefix: '/', redirect: true,
    allowedPath: (p) => !p.replace(/^\//, '').startsWith('_meta/'),
  });

  /** 404 : réponse JSON pour l'API, page 404 dans la langue de l'adresse sinon. */
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Route inconnue.' });
    const lang = /^\/(?:preview\/)?([a-z]{2})\//.exec(req.url)?.[1];
    const base = req.url.startsWith('/preview/') ? config.previewDir : config.publicDist;
    const file = [lang && path.join(base, lang, '404.html'), path.join(base, '404.html')].filter(Boolean).find((f) => fs.existsSync(f));
    return reply.code(404).type('text/html; charset=utf-8').send(file ? fs.readFileSync(file) : 'Page introuvable');
  });

  return app;
}
