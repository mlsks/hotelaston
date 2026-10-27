/**
 * Collections (chambres, services, équipements, avis, chat…) et leurs éléments.
 * Un élément = champs communs (cms_items.data) + champs traduits par langue (cms_item_i18n.data).
 */
import { guard, assertCan, assertInScope, isScoped, rulesOf, folderInScope } from '../auth/auth.js';
import { notFound, badRequest, sanitizeRich, toUtcIso } from '../lib/http.js';
import { nowIso, sha, isPlainObject } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { splitTranslatable, mergeTranslation } from '../ssg/collections.js';
import { ID, ID_LANG, STATUS, DATE, assertLang, translationState, pick, updateRow, bool } from './helpers.js';

/** Champs en texte riche, nettoyés à l'enregistrement. */
const HTML_FIELDS = { services: ['body'], chat: ['answer'] };
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function cleanHtml(collection, data) {
  for (const field of HTML_FIELDS[collection] || []) if (typeof data[field] === 'string') data[field] = sanitizeRich(data[field]);
  return data;
}

/** Contrôles propres à certaines collections, sur l'élément complet (champs communs + langue par défaut). */
const VALIDATE = {
  gigs(item) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || '') || Number.isNaN(Date.parse(item.date))) throw badRequest('Concert : date au format AAAA-MM-JJ.');
    if (item.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) throw badRequest('Concert : heure au format HH:MM.');
    if (item.venue && !['selon-meteo', 'moon-bar', 'aston-club'].includes(item.venue)) throw badRequest('Concert : lieu « selon-meteo », « moon-bar » ou « aston-club ».');
    if (item.artist !== undefined && !String(item.artist).trim()) throw badRequest('Concert : nom de l’artiste obligatoire.');
  },
};

export default function collectionRoutes(app, { db, defaultLang }) {
  const getCollection = (key) => {
    const c = db.prepare('SELECT * FROM cms_collections WHERE key = ?').get(key);
    if (!c) throw notFound('Collection');
    return { ...c, schema: JSON.parse(c.schema) };
  };
  const getItem = (id) => {
    const it = db.prepare('SELECT * FROM cms_items WHERE id = ?').get(id);
    if (!it) throw notFound('Élément');
    return it;
  };
  const collectionInScope = (req, key) => assertInScope(req, (r) => r.collections.has(key), `la collection « ${key} »`);

  function present(item) {
    const def = defaultLang();
    const rows = Object.fromEntries(db.prepare('SELECT * FROM cms_item_i18n WHERE item_id = ?').all(item.id).map((r) => [r.lang, r]));
    const source = rows[def]?.data ? sha(rows[def].data) : null;
    const langs = db.prepare('SELECT code FROM cms_languages ORDER BY position').pluck().all();
    const base = JSON.parse(item.data);
    return {
      ...item,
      data: base,
      merged: mergeTranslation(base, rows[def] ? JSON.parse(rows[def].data) : undefined),
      i18n: Object.fromEntries(langs.map((l) => [l, rows[l]
        ? { slug: rows[l].slug, data: JSON.parse(rows[l].data), status: rows[l].status, state: translationState(rows[l], source, l === def, (r) => r.data && r.data !== '{}'), updated_at: rows[l].updated_at }
        : { state: 'missing' }])),
    };
  }

  app.get('/collections', { preHandler: guard() }, async (req) => db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM cms_items i WHERE i.collection = c.key) AS items
    FROM cms_collections c ORDER BY c.key`).all()
    .filter((c) => !isScoped(req.user) || rulesOf(req.user).collections.has(c.key))
    .map((c) => ({ ...c, schema: JSON.parse(c.schema) })));

  app.get('/collections/:key/items', { preHandler: guard() }, async (req) => {
    const c = getCollection(req.params.key);
    collectionInScope(req, c.key);
    return db.prepare('SELECT * FROM cms_items WHERE collection = ? ORDER BY position, id').all(c.key).map(present);
  });

  app.post('/collections/:key/items', {
    preHandler: guard('content'),
    schema: { body: { type: 'object', required: ['key', 'data'], additionalProperties: false, properties: {
      key: { type: 'string', maxLength: 80 }, data: { type: 'object' }, is_active: { type: 'boolean' }, position: { type: 'integer' }, start_at: DATE, end_at: DATE,
    } } },
  }, async (req, reply) => {
    const c = getCollection(req.params.key);
    collectionInScope(req, c.key);
    if (!KEY.test(req.body.key)) throw badRequest('Identifiant invalide : lettres minuscules, chiffres et tirets.');
    if (db.prepare('SELECT 1 FROM cms_items WHERE collection = ? AND key = ?').get(c.key, req.body.key)) throw badRequest('Cet identifiant existe déjà.');
    VALIDATE[c.key]?.(req.body.data);
    const { base, translated } = splitTranslatable(cleanHtml(c.key, req.body.data), c.schema.translatable);
    const now = nowIso();
    const position = req.body.position ?? db.prepare('SELECT COALESCE(MAX(position), -1) + 1 FROM cms_items WHERE collection = ?').pluck().get(c.key);
    const id = db.transaction(() => {
      const newId = db.prepare(`INSERT INTO cms_items (collection, key, data, is_active, start_at, end_at, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(c.key, req.body.key, JSON.stringify(base), bool(req.body.is_active ?? true), toUtcIso(req.body.start_at), toUtcIso(req.body.end_at), position, now, now).lastInsertRowid;
      const tr = JSON.stringify(translated);
      db.prepare(`INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at, updated_by) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?)`)
        .run(newId, defaultLang(), c.item_template ? req.body.key : null, tr, sha(tr), now, req.user.id);
      return newId;
    })();
    audit(db, req, 'create', 'item', id, { after: req.body });
    return reply.code(201).send(present(getItem(id)));
  });

  app.get('/items/:id', { preHandler: guard(), schema: { params: ID } }, async (req) => {
    const item = getItem(req.params.id);
    collectionInScope(req, item.collection);
    return present(item);
  });

  /** Champs communs ; un champ traduisible envoyé ici met à jour la langue par défaut. */
  app.patch('/items/:id', {
    preHandler: guard('content'),
    schema: { params: ID, body: { type: 'object', additionalProperties: false, properties: {
      data: { type: 'object' }, is_active: { type: 'boolean' }, position: { type: 'integer' }, start_at: DATE, end_at: DATE,
    } } },
  }, async (req) => {
    const item = getItem(req.params.id);
    const c = getCollection(item.collection);
    collectionInScope(req, c.key);
    if (req.body.data && VALIDATE[c.key]) {
      const current = present(item).merged;
      VALIDATE[c.key]({ ...current, ...req.body.data });
    }
    const fields = pick(req.body, ['is_active', 'position']);
    if ('is_active' in fields) fields.is_active = bool(fields.is_active);
    if ('start_at' in req.body) fields.start_at = toUtcIso(req.body.start_at);
    if ('end_at' in req.body) fields.end_at = toUtcIso(req.body.end_at);
    db.transaction(() => {
      if (req.body.data) {
        const { base, translated } = splitTranslatable(cleanHtml(c.key, req.body.data), c.schema.translatable);
        fields.data = JSON.stringify({ ...JSON.parse(item.data), ...base });
        if (Object.keys(translated).length) {
          const def = defaultLang();
          const row = db.prepare('SELECT data FROM cms_item_i18n WHERE item_id = ? AND lang = ?').get(item.id, def);
          const tr = JSON.stringify({ ...(row ? JSON.parse(row.data) : {}), ...translated });
          db.prepare(`INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at, updated_by) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?)
            ON CONFLICT (item_id, lang) DO UPDATE SET data = excluded.data, source_hash = excluded.source_hash, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
            .run(item.id, def, c.item_template ? item.key : null, tr, sha(tr), nowIso(), req.user.id);
        }
      }
      updateRow(db, 'cms_items', item.id, { ...fields, updated_at: nowIso() });
    })();
    audit(db, req, 'update', 'item', item.id, { before: item, after: req.body });
    return present(getItem(item.id));
  });

  app.delete('/items/:id', { preHandler: guard('content'), schema: { params: ID } }, async (req) => {
    const item = getItem(req.params.id);
    collectionInScope(req, item.collection);
    db.prepare('DELETE FROM cms_items WHERE id = ?').run(item.id);
    audit(db, req, 'delete', 'item', item.id, { before: item });
    return { ok: true };
  });

  /** Traduction d'un élément : les champs traduisibles de la collection, et seulement eux. */
  app.put('/items/:id/i18n/:lang', {
    preHandler: guard(),
    schema: { params: ID_LANG, body: { type: 'object', required: ['data'], additionalProperties: false, properties: {
      data: { type: 'object' }, slug: { type: ['string', 'null'], maxLength: 80 }, status: STATUS,
    } } },
  }, async (req) => {
    const { lang } = req.params;
    assertLang(db, lang);
    const def = defaultLang();
    assertCan(req, 'translate', { lang, defaultLang: def });
    const item = getItem(req.params.id);
    const c = getCollection(item.collection);
    collectionInScope(req, c.key);
    const { base, translated } = splitTranslatable(cleanHtml(c.key, structuredClone(req.body.data)), c.schema.translatable);
    const leftover = Object.keys(base).filter((k) => !isPlainObject(base[k]) && !Array.isArray(base[k]));
    if (leftover.length) throw badRequest(`Champs non traduisibles : ${leftover.join(', ')}`);
    if (req.body.slug && !KEY.test(req.body.slug)) throw badRequest('Adresse invalide : lettres minuscules, chiffres et tirets.');
    const tr = JSON.stringify(translated);
    const defRow = lang === def ? { data: tr } : db.prepare('SELECT data FROM cms_item_i18n WHERE item_id = ? AND lang = ?').get(item.id, def);
    const before = db.prepare('SELECT * FROM cms_item_i18n WHERE item_id = ? AND lang = ?').get(item.id, lang);
    db.prepare(`INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (item_id, lang) DO UPDATE SET slug = excluded.slug, data = excluded.data, status = excluded.status,
        source_hash = excluded.source_hash, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(item.id, lang, c.item_template ? (req.body.slug || before?.slug || item.key) : null, tr,
        lang === def ? 'ready' : (req.body.status || 'ready'), defRow?.data ? sha(defRow.data) : null, nowIso(), req.user.id);
    db.prepare('UPDATE cms_items SET updated_at = ? WHERE id = ?').run(nowIso(), item.id);
    audit(db, req, 'update', 'item_i18n', item.id, { lang, before: before ? JSON.parse(before.data) : null, after: translated });
    return present(getItem(item.id));
  });

  app.put('/items/:id/media', {
    preHandler: guard('content'),
    schema: { params: ID, body: { type: 'array', maxItems: 100, items: { type: 'object', required: ['media_id'], additionalProperties: false, properties: {
      media_id: { type: 'integer' }, role: { type: 'string', enum: ['cover', 'gallery', 'video'] }, position: { type: 'integer' },
    } } } },
  }, async (req) => {
    const item = getItem(req.params.id);
    collectionInScope(req, item.collection);
    const media = db.prepare('SELECT folder FROM cms_media WHERE id = ? AND deleted_at IS NULL');
    for (const m of req.body) {
      const row = media.get(m.media_id);
      if (!row) throw badRequest(`Média ${m.media_id} introuvable.`);
      assertInScope(req, (r) => folderInScope(r, row.folder), `le média ${m.media_id}`);
    }
    db.transaction(() => {
      db.prepare('DELETE FROM cms_item_media WHERE item_id = ?').run(item.id);
      const ins = db.prepare('INSERT INTO cms_item_media (item_id, media_id, role, position) VALUES (?, ?, ?, ?)');
      req.body.forEach((m, i) => ins.run(item.id, m.media_id, m.role || 'gallery', m.position ?? i));
    })();
    audit(db, req, 'update', 'item_media', item.id, { after: req.body });
    return db.prepare('SELECT * FROM cms_item_media WHERE item_id = ? ORDER BY role, position').all(item.id);
  });
}
