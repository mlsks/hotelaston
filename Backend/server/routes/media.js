/**
 * Médiathèque : envoi de fichiers, liens externes, textes alternatifs par langue, point d'intérêt,
 * suppression (douce : effacement définitif par le nettoyage nocturne).
 */
import { guard, assertCan, assertInScope, isScoped, rulesOf, folderInScope } from '../auth/auth.js';
import { HttpError, notFound, badRequest, assertHttpUrl } from '../lib/http.js';
import { nowIso, sha } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { ingestUpload, enqueue, refreshPortrait, providerOf, warningsFor, waitFor } from '../media/pipeline.js';
import { ID, ID_LANG, STATUS, assertLang, translationState, pick, updateRow } from './helpers.js';

const FOLDER = { type: 'string', pattern: '^/[\\w\\- /àâäéèêëîïôöùûüçÀ-ÿ]*$', maxLength: 120 };

export default function mediaRoutes(app, { db, defaultLang }) {
  const getMedia = (id) => {
    const m = db.prepare('SELECT * FROM cms_media WHERE id = ?').get(id);
    if (!m) throw notFound('Média');
    return m;
  };
  const mediaInScope = (req, m) => assertInScope(req, (r) => folderInScope(r, m.folder), `le média ${m.id}`);
  /** Dossier d'envoi : un compte limité range toujours dans son dossier. */
  const uploadFolder = (req, folder) => {
    if (!isScoped(req.user)) return folder;
    const rules = rulesOf(req.user);
    return folderInScope(rules, folder) ? folder : rules.mediaFolders[0];
  };

  /** Où un média est utilisé (une suppression ne doit pas casser une page sans prévenir). */
  const references = (id) => [
    ...db.prepare('SELECT e.key FROM cms_entry_values v JOIN cms_entries e ON e.id = v.entry_id WHERE v.media_id = ?').pluck().all(id).map((k) => `texte ${k}`),
    ...db.prepare('SELECT i.collection || \'/\' || i.key FROM cms_item_media im JOIN cms_items i ON i.id = im.item_id WHERE im.media_id = ?').pluck().all(id).map((k) => `fiche ${k}`),
    ...db.prepare("SELECT DISTINCT i.collection || '/' || i.key FROM cms_items i, json_tree(i.data) t WHERE t.key = 'media' AND t.value = ?").pluck().all(id).map((k) => `photo de la fiche ${k}`),
    ...db.prepare("SELECT s.key FROM cms_settings s, cms_media m WHERE m.id = ? AND s.value LIKE '%/media/v/' || substr(m.sha256, 1, 16) || '-%'").pluck().all(id).map((k) => `réglage ${k}`),
    ...db.prepare('SELECT name FROM cms_popups WHERE media_id = ?').pluck().all(id).map((n) => `popup « ${n} »`),
    ...db.prepare('SELECT p.key || \' (\' || pi.lang || \')\' FROM cms_page_i18n pi JOIN cms_pages p ON p.id = pi.page_id WHERE pi.og_image_id = ?').pluck().all(id).map((k) => `image de partage ${k}`),
  ];

  function present(m) {
    const def = defaultLang();
    const rows = Object.fromEntries(db.prepare('SELECT * FROM cms_media_i18n WHERE media_id = ?').all(m.id).map((r) => [r.lang, r]));
    const source = rows[def] ? sha(`${rows[def].alt ?? ''}\n${rows[def].title ?? ''}`) : null;
    const langs = db.prepare('SELECT code FROM cms_languages ORDER BY position').pluck().all();
    const variants = db.prepare('SELECT purpose, format, width, height, bytes, path FROM cms_media_variants WHERE media_id = ? ORDER BY width').all(m.id)
      .map((v) => ({ ...v, url: `/media/${v.path}` }));
    return {
      ...m,
      thumb: variants.find((v) => v.purpose === 'thumb')?.url || null,
      variants,
      warnings: warningsFor(m),
      i18n: Object.fromEntries(langs.map((l) => [l, rows[l]
        ? { alt: rows[l].alt, title: rows[l].title, caption: rows[l].caption, status: rows[l].status, state: translationState(rows[l], source, l === def, (r) => Boolean(r.alt)) }
        : { state: m.kind === 'embed' ? 'ready' : 'missing' }])),
    };
  }

  app.get('/media', {
    preHandler: guard(),
    schema: { querystring: { type: 'object', properties: {
      folder: { type: 'string' }, kind: { type: 'string', enum: ['image', 'video', 'audio', 'embed'] }, q: { type: 'string', maxLength: 100 },
      deleted: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 200 }, offset: { type: 'integer', minimum: 0 },
    } } },
  }, async (req) => {
    const where = [req.query.deleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
    const params = { limit: req.query.limit || 60, offset: req.query.offset || 0 };
    if (req.query.folder) { where.push('folder = @folder'); params.folder = req.query.folder; }
    if (req.query.kind) { where.push('kind = @kind'); params.kind = req.query.kind; }
    if (isScoped(req.user)) {
      const folders = rulesOf(req.user).mediaFolders;
      where.push(`(${folders.map((f, i) => `folder = @sf${i} OR folder LIKE @sl${i}`).join(' OR ')})`);
      folders.forEach((f, i) => { params[`sf${i}`] = f; params[`sl${i}`] = `${f}/%`; });
    }
    if (req.query.q) {
      where.push('(original_name LIKE @q OR embed_url LIKE @q OR EXISTS (SELECT 1 FROM cms_media_i18n t WHERE t.media_id = cms_media.id AND (t.alt LIKE @q OR t.title LIKE @q)))');
      params.q = `%${req.query.q}%`;
    }
    const total = db.prepare(`SELECT COUNT(*) FROM cms_media WHERE ${where.join(' AND ')}`).pluck().get(params);
    const items = db.prepare(`SELECT * FROM cms_media WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT @limit OFFSET @offset`).all(params).map(present);
    return { total, items };
  });

  app.get('/media/folders', { preHandler: guard() }, async (req) => db.prepare(`SELECT folder, COUNT(*) AS count FROM cms_media
    WHERE deleted_at IS NULL GROUP BY folder ORDER BY folder`).all()
    .filter((f) => !isScoped(req.user) || folderInScope(rulesOf(req.user), f.folder)));

  app.post('/media', { preHandler: guard('content') }, async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest('Aucun fichier reçu (champ « file »).');
    const folder = uploadFolder(req, String(file.fields.folder?.value || '/'));
    if (!/^\//.test(folder) || folder.length > 120) throw badRequest('Dossier invalide.');
    let result;
    try {
      result = await ingestUpload(db, { stream: file.file, filename: file.filename, folder, userId: req.user.id });
    } catch (err) {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, 'Fichier trop lourd.');
      throw err;
    }
    if (req.query.wait) await waitFor(result.id);
    audit(db, req, result.duplicate ? 'reuse' : 'create', 'media', result.id, { after: { name: file.filename, folder } });
    return reply.code(result.duplicate ? 200 : 201).send({ duplicate: result.duplicate, media: present(getMedia(result.id)) });
  });

  app.post('/media/embed', {
    preHandler: guard('content'),
    schema: { body: { type: 'object', required: ['url'], additionalProperties: false, properties: { url: { type: 'string', maxLength: 500 }, folder: FOLDER, title: { type: 'string', maxLength: 200 } } } },
  }, async (req, reply) => {
    const url = assertHttpUrl(req.body.url);
    if (!url.startsWith('https:')) throw badRequest('Lien externe : adresse https uniquement.');
    const digest = sha(`embed:${url}`);
    const existing = db.prepare('SELECT id FROM cms_media WHERE sha256 = ?').get(digest);
    if (existing) return { duplicate: true, media: present(getMedia(existing.id)) };
    const id = db.transaction(() => {
      const newId = db.prepare(`INSERT INTO cms_media (kind, folder, sha256, embed_url, embed_provider, status, created_at, created_by) VALUES ('embed', ?, ?, ?, ?, 'ready', ?, ?)`)
        .run(uploadFolder(req, req.body.folder || '/'), digest, url, providerOf(url), nowIso(), req.user.id).lastInsertRowid;
      if (req.body.title) db.prepare(`INSERT INTO cms_media_i18n (media_id, lang, title, status) VALUES (?, ?, ?, 'ready')`).run(newId, defaultLang(), req.body.title);
      return newId;
    })();
    audit(db, req, 'create', 'media', id, { after: { url } });
    return reply.code(201).send({ duplicate: false, media: present(getMedia(id)) });
  });

  app.get('/media/:id', { preHandler: guard(), schema: { params: ID } }, async (req) => {
    const m = getMedia(req.params.id);
    mediaInScope(req, m);
    return { ...present(m), references: references(m.id) };
  });

  app.patch('/media/:id', {
    preHandler: guard('content'),
    schema: { params: ID, body: { type: 'object', additionalProperties: false, properties: {
      folder: FOLDER, focal_x: { type: 'number', minimum: 0, maximum: 1 }, focal_y: { type: 'number', minimum: 0, maximum: 1 },
      credit: { type: ['string', 'null'], maxLength: 200 }, poster_id: { type: ['integer', 'null'] },
    } } },
  }, async (req) => {
    const m = getMedia(req.params.id);
    mediaInScope(req, m);
    const fields = pick(req.body, ['folder', 'focal_x', 'focal_y', 'credit', 'poster_id']);
    if ('folder' in fields) assertInScope(req, (r) => folderInScope(r, fields.folder), `le dossier ${fields.folder}`);
    if (fields.poster_id && getMedia(fields.poster_id).kind !== 'image') throw badRequest("Le poster doit être une image.");
    updateRow(db, 'cms_media', m.id, fields);
    if (('focal_x' in fields || 'focal_y' in fields) && m.kind === 'image') {
      const job = enqueue(m.id, () => refreshPortrait(db, m.id));
      if (req.query.wait) await job;
    }
    audit(db, req, 'update', 'media', m.id, { before: m, after: fields });
    return present(getMedia(m.id));
  });

  app.put('/media/:id/i18n/:lang', {
    preHandler: guard(),
    schema: { params: ID_LANG, body: { type: 'object', additionalProperties: false, properties: {
      alt: { type: ['string', 'null'], maxLength: 300 }, title: { type: ['string', 'null'], maxLength: 200 }, caption: { type: ['string', 'null'], maxLength: 500 }, status: STATUS,
    } } },
  }, async (req) => {
    const { lang } = req.params;
    assertLang(db, lang);
    const def = defaultLang();
    assertCan(req, 'translate', { lang, defaultLang: def });
    const m = getMedia(req.params.id);
    mediaInScope(req, m);
    const before = db.prepare('SELECT * FROM cms_media_i18n WHERE media_id = ? AND lang = ?').get(m.id, lang);
    const row = { alt: null, title: null, caption: null, ...before, ...req.body };
    db.prepare(`INSERT INTO cms_media_i18n (media_id, lang, alt, title, caption, status) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (media_id, lang) DO UPDATE SET alt = excluded.alt, title = excluded.title, caption = excluded.caption, status = excluded.status`)
      .run(m.id, lang, row.alt, row.title, row.caption, lang === def ? 'ready' : (req.body.status || 'ready'));
    audit(db, req, 'update', 'media_i18n', m.id, { lang, before, after: req.body });
    return present(getMedia(m.id));
  });

  app.delete('/media/:id', {
    preHandler: guard('content'),
    schema: { params: ID, querystring: { type: 'object', properties: { force: { type: 'boolean' } } } },
  }, async (req) => {
    const m = getMedia(req.params.id);
    mediaInScope(req, m);
    const refs = references(m.id);
    if (refs.length && !req.query.force) throw new HttpError(409, `Média utilisé : ${refs.slice(0, 5).join(', ')}. Ajoutez ?force=true pour le supprimer quand même.`);
    db.prepare('UPDATE cms_media SET deleted_at = ? WHERE id = ?').run(nowIso(), m.id);
    audit(db, req, 'delete', 'media', m.id, { before: { name: m.original_name, refs } });
    return { ok: true, references: refs };
  });
}
