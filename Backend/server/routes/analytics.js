/**
 * Statistiques : réception publique (POST /api/track) et requêtes du tableau de bord.
 * Lecture réservée aux administrateurs et aux éditeurs sans périmètre.
 */
import { guard, assertUnscoped } from '../auth/auth.js';
import { HttpError, badRequest } from '../lib/http.js';
import { dayIn } from '../lib/util.js';
import { config } from '../config.js';
import { periodRange, summary, timeseries, top, funnel, demand, vitals, toCsv } from '../analytics/queries.js';
import { geoipActive } from '../analytics/geoip.js';

const PERIOD_QS = {
  type: 'object',
  properties: {
    period: { type: 'string', enum: ['week', 'month', 'year'] }, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    lang: { type: 'string', maxLength: 5 }, country: { type: 'string', maxLength: 2 }, device: { type: 'string', enum: ['mobile', 'tablet', 'desktop'] },
    channel: { type: 'string', maxLength: 20 }, dim: { type: 'string', maxLength: 20 }, limit: { type: 'integer', minimum: 1, maximum: 200 },
    report: { type: 'string', enum: ['timeseries', 'top', 'funnel', 'vitals'] },
  },
};

export default function analyticsRoutes(app, { db, ingest }) {
  /* Réception : texte brut (sendBeacon sans requête préalable), toujours 204 */
  app.post('/track', {
    bodyLimit: 16 * 1024,
    config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    const events = Array.isArray(body) ? body.slice(0, 20) : [body];
    for (const ev of events) ingest.accept(ev, { ip: req.ip, ua: req.headers['user-agent'] || '', acceptLanguage: req.headers['accept-language'] });
    return reply.code(204).header('Cache-Control', 'no-store').send();
  });

  const stats = async (req) => {
    if (!['admin', 'editor'].includes(req.user.role)) throw new HttpError(403, 'Statistiques réservées aux administrateurs et éditeurs.');
    assertUnscoped(req);
  };
  const context = (req) => {
    const q = req.query;
    const range = periodRange(q.period || 'month', q.date || dayIn(new Date(), config.timezone));
    const filters = { lang: q.lang, country: q.country, device: q.device, channel: q.channel };
    return { range, filters, limit: q.limit || 20 };
  };
  const opts = { preHandler: [guard(), stats], schema: { querystring: PERIOD_QS } };

  app.get('/analytics/summary', opts, async (req) => {
    const { range, filters } = context(req);
    return { range, filters, geoip: geoipActive(), current: summary(db, range, filters), previous: summary(db, { ...range.previous, period: range.period }, filters) };
  });
  app.get('/analytics/timeseries', opts, async (req) => {
    const { range, filters } = context(req);
    return { range, points: timeseries(db, range, filters) };
  });
  app.get('/analytics/top', opts, async (req) => {
    const { range, filters, limit } = context(req);
    if (!req.query.dim) throw badRequest('Paramètre « dim » manquant.');
    try {
      return { range, dim: req.query.dim, rows: top(db, req.query.dim, range, filters, limit) };
    } catch (err) {
      throw badRequest(err.message);
    }
  });
  app.get('/analytics/funnel', opts, async (req) => {
    const { range, filters } = context(req);
    return { range, steps: funnel(db, range, filters) };
  });
  app.get('/analytics/demand', opts, async (req) => {
    const { range, filters } = context(req);
    return { range, ...demand(db, range, filters) };
  });
  app.get('/analytics/vitals', opts, async (req) => {
    const { range, filters } = context(req);
    return { range, rows: vitals(db, range, filters) };
  });
  app.get('/analytics/export.csv', opts, async (req, reply) => {
    const { range, filters, limit } = context(req);
    const report = req.query.report || 'top';
    const rows = report === 'timeseries' ? timeseries(db, range, filters)
      : report === 'funnel' ? funnel(db, range, filters)
        : report === 'vitals' ? vitals(db, range, filters)
          : top(db, req.query.dim || 'channel', range, filters, limit);
    return reply.type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="statistiques-${report}-${range.from}.csv"`)
      .send(toCsv(rows));
  });
}
