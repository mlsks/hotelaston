/**
 * Prévisualiser, publier, restaurer ; historique des builds ; nettoyage des médias.
 */
import { guard, assertUnscoped, isScoped, rulesOf } from '../auth/auth.js';
import { notFound } from '../lib/http.js';
import { toUtcIso } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { runBuild } from '../ssg/build.js';
import { restoreRelease, currentBuild } from '../ssg/release.js';
import { collectGarbage } from '../media/gc.js';
import { ID } from './helpers.js';

const shape = (b) => (b ? { ...b, langs: JSON.parse(b.langs || '[]'), warnings: JSON.parse(b.warnings || '[]') } : null);

export default function buildRoutes(app, { db }) {
  app.get('/builds', {
    preHandler: guard(),
    schema: { querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } } } },
  }, async (req) => ({
    current: shape(currentBuild(db)),
    items: db.prepare('SELECT * FROM sys_builds ORDER BY id DESC LIMIT ?').all(req.query.limit || 30).map(shape),
  }));

  app.get('/builds/:id', { preHandler: guard(), schema: { params: ID } }, async (req) => {
    const b = db.prepare('SELECT * FROM sys_builds WHERE id = ?').get(req.params.id);
    if (!b) throw notFound('Build');
    return shape(b);
  });

  app.post('/builds/preview', {
    preHandler: guard('preview'),
    schema: { body: { type: ['object', 'null'], additionalProperties: false, properties: { date: { type: 'string', maxLength: 30 } } } },
  }, async (req) => {
    const at = req.body?.date ? new Date(toUtcIso(req.body.date)) : new Date();
    const build = await runBuild({ kind: 'preview', trigger: 'manual', now: at, userId: req.user.id, log: (m) => req.log.info(m) });
    return shape(build);
  });

  app.post('/builds/publish', { preHandler: guard('publish') }, async (req) => {
    // Compte limité : seule sa partie du site est mise en ligne, le reste garde la version publiée
    const scope = isScoped(req.user) ? rulesOf(req.user).scopes : null;
    const build = await runBuild({ kind: 'production', trigger: 'manual', userId: req.user.id, scope, log: (m) => req.log.info(m) });
    audit(db, req, 'publish', 'build', build.id, { after: { status: build.status } });
    return shape(build);
  });

  const restore = async (req, buildId) => {
    assertUnscoped(req);
    const target = await restoreRelease({ buildId, withContent: Boolean(req.body?.with_content), userId: req.user.id });
    audit(db, req, 'rollback', 'build', target.id, { after: { with_content: Boolean(req.body?.with_content) } });
    return { restored: target.id, current: shape(currentBuild(db)) };
  };
  const RESTORE_BODY = { type: ['object', 'null'], additionalProperties: false, properties: { with_content: { type: 'boolean' } } };
  app.post('/builds/restore-previous', { preHandler: guard('publish'), schema: { body: RESTORE_BODY } }, async (req) => restore(req, null));
  app.post('/builds/:id/restore', { preHandler: guard('publish'), schema: { params: ID, body: RESTORE_BODY } }, async (req) => restore(req, req.params.id));

  app.post('/maintenance/media-gc', { preHandler: guard('admin') }, async (req) => ({ deleted: collectGarbage(db, { log: (m) => req.log.info(m) }) }));
}
