/**
 * Langues, pages (SEO), textes (data-cms-*), réglages et redirections.
 */
import { guard, assertCan, assertUnscoped, assertInScope, isScoped, rulesOf } from '../auth/auth.js';
import { HttpError } from '../lib/http.js';
import { notFound, badRequest, sanitizeRich, assertHttpUrl } from '../lib/http.js';
import { nowIso } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { ID, ID_LANG, STATUS, assertLang, translationState, pageSourceHash, valueHash, pick, updateRow, bool } from './helpers.js';
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { blockTree, saveZone, copyBlock, deleteBlock } from '../ssg/page-blocks.js';
import { pageHero } from '../ssg/hero-veil.js';

const SETTINGS_EDITABLE = ['booking_engine', 'og_site_name', 'og_image_default', 'x_default_lang', 'reviews_meta', 'cdn_base', 'jsonld_graph'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function contentRoutes(app, { db, defaultLang }) {
  /* ---------- Langues ---------- */
  app.get('/languages', { preHandler: guard() }, async () => db.prepare('SELECT * FROM cms_languages ORDER BY position').all());

  app.post('/languages', {
    preHandler: guard('admin'),
    schema: { body: { type: 'object', required: ['code', 'name', 'native_name', 'locale', 'booking_lang'], additionalProperties: false, properties: {
      code: { type: 'string', pattern: '^[a-z]{2}$' }, name: { type: 'string', minLength: 1, maxLength: 60 }, native_name: { type: 'string', minLength: 1, maxLength: 60 },
      locale: { type: 'string', pattern: '^[a-z]{2}-[A-Z]{2}$' }, booking_lang: { type: 'string', pattern: '^[a-z]{2}$' },
    } } },
  }, async (req, reply) => {
    if (db.prepare('SELECT 1 FROM cms_languages WHERE code = ?').get(req.body.code)) throw badRequest('Cette langue existe déjà.');
    const position = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 FROM cms_languages').pluck().get();
    db.prepare(`INSERT INTO cms_languages (code, name, native_name, locale, booking_lang, is_default, is_active, position)
      VALUES (@code, @name, @native_name, @locale, @booking_lang, 0, 0, @position)`).run({ ...req.body, position });
    audit(db, req, 'create', 'language', req.body.code, { after: req.body });
    return reply.code(201).send(db.prepare('SELECT * FROM cms_languages WHERE code = ?').get(req.body.code));
  });

  app.patch('/languages/:code', {
    preHandler: guard('admin'),
    schema: { body: { type: 'object', additionalProperties: false, properties: {
      name: { type: 'string', maxLength: 60 }, native_name: { type: 'string', maxLength: 60 }, locale: { type: 'string', pattern: '^[a-z]{2}-[A-Z]{2}$' },
      booking_lang: { type: 'string', pattern: '^[a-z]{2}$' }, is_active: { type: 'boolean' }, position: { type: 'integer' },
    } } },
  }, async (req) => {
    const lang = assertLang(db, req.params.code);
    if (lang.is_default && req.body.is_active === false) throw badRequest('La langue par défaut ne peut pas être désactivée.');
    const fields = pick(req.body, ['name', 'native_name', 'locale', 'booking_lang', 'is_active', 'position']);
    if ('is_active' in fields) fields.is_active = bool(fields.is_active);
    updateRow(db, 'cms_languages', lang.code, fields, 'code');
    audit(db, req, 'update', 'language', lang.code, { before: lang, after: fields });
    return db.prepare('SELECT * FROM cms_languages WHERE code = ?').get(lang.code);
  });

  /* ---------- Pages ---------- */
  const pageI18n = (pageId) => Object.fromEntries(db.prepare('SELECT * FROM cms_page_i18n WHERE page_id = ?').all(pageId).map((r) => [r.lang, r]));
  const withStates = (pageId) => {
    const rows = pageI18n(pageId);
    const def = defaultLang();
    const source = pageSourceHash(rows[def]);
    const out = {};
    for (const l of db.prepare('SELECT code FROM cms_languages ORDER BY position').pluck().all()) {
      const r = rows[l];
      out[l] = r ? { ...r, state: translationState(r, source, l === def, (x) => Boolean(x?.title)) } : { state: 'missing' };
    }
    return out;
  };

  const pageInScope = (req, page) => assertInScope(req, (r) => r.pages.has(page.key), `la page « ${page.key} »`);

  app.get('/pages', { preHandler: guard() }, async (req) => db.prepare('SELECT * FROM cms_pages ORDER BY position, id').all()
    .filter((p) => !isScoped(req.user) || rulesOf(req.user).pages.has(p.key))
    .map((p) => ({ ...p, i18n: withStates(p.id) })));

  /** Pages dont le bandeau photo a un dégradé réglable (Fiches et listes → Bandeaux photo). */
  app.get('/pages/heroes', { preHandler: guard('content') }, async (req) => {
    assertUnscoped(req);
    return db.prepare('SELECT * FROM cms_pages ORDER BY position, id').all()
      .map((p) => ({ ...p, hero: pageHero(p) }))
      .filter((p) => p.hero)
      .map((p) => ({ ...p, i18n: withStates(p.id) }));
  });

  app.get('/pages/:id', { preHandler: guard(), schema: { params: ID } }, async (req) => {
    const page = db.prepare('SELECT * FROM cms_pages WHERE id = ?').get(req.params.id);
    if (!page) throw notFound('Page');
    pageInScope(req, page);
    return { ...page, i18n: withStates(page.id), entries: entriesFor({ page: page.id }), hero: pageHero(page) };
  });

  app.patch('/pages/:id', {
    preHandler: guard('content'),
    schema: { params: ID, body: { type: 'object', additionalProperties: false, properties: {
      in_sitemap: { type: 'boolean' }, is_active: { type: 'boolean' }, position: { type: 'integer' }, parent_id: { type: ['integer', 'null'] }, priority: { type: ['number', 'null'], minimum: 0, maximum: 1 },
      hero_veil: { type: ['object', 'null'], required: ['on', 'opacity', 'width'], additionalProperties: false, properties: {
        on: { type: 'boolean' }, opacity: { type: 'number', minimum: 0.1, maximum: 0.9 }, width: { type: 'integer', minimum: 20, maximum: 100 },
      } },
    } } },
  }, async (req) => {
    assertUnscoped(req);
    const page = db.prepare('SELECT * FROM cms_pages WHERE id = ?').get(req.params.id);
    if (!page) throw notFound('Page');
    const fields = pick(req.body, ['in_sitemap', 'is_active', 'position', 'parent_id', 'priority', 'hero_veil']);
    for (const k of ['in_sitemap', 'is_active']) if (k in fields) fields[k] = bool(fields[k]);
    if ('hero_veil' in fields) {
      if (fields.hero_veil && !pageHero(page)) throw badRequest('Cette page n’a pas de bandeau photo réglable.');
      fields.hero_veil = fields.hero_veil ? JSON.stringify(fields.hero_veil) : null;
    }
    if (fields.parent_id === page.id) throw badRequest('Une page ne peut pas être sa propre parente.');
    updateRow(db, 'cms_pages', page.id, { ...fields, updated_at: nowIso() });
    audit(db, req, 'update', 'page', page.id, { before: page, after: fields });
    return db.prepare('SELECT * FROM cms_pages WHERE id = ?').get(page.id);
  });

  app.put('/pages/:id/i18n/:lang', {
    preHandler: guard(),
    schema: { params: ID_LANG, body: { type: 'object', additionalProperties: false, properties: {
      slug: { type: 'string', maxLength: 80 }, nav_label: { type: ['string', 'null'], maxLength: 80 },
      title: { type: 'string', maxLength: 200 }, meta_description: { type: 'string', maxLength: 400 },
      og_title: { type: ['string', 'null'], maxLength: 200 }, og_description: { type: ['string', 'null'], maxLength: 400 },
      og_image_id: { type: ['integer', 'null'] }, noindex: { type: 'boolean' }, focus_keyword: { type: ['string', 'null'], maxLength: 120 }, status: STATUS,
    } } },
  }, async (req) => {
    const { lang } = req.params;
    assertLang(db, lang);
    const def = defaultLang();
    assertCan(req, 'translate', { lang, defaultLang: def });
    const page = db.prepare('SELECT * FROM cms_pages WHERE id = ?').get(req.params.id);
    if (!page) throw notFound('Page');
    pageInScope(req, page);
    const before = db.prepare('SELECT * FROM cms_page_i18n WHERE page_id = ? AND lang = ?').get(page.id, lang);
    const merged = { ...before, ...req.body };
    const slug = page.key === 'accueil' ? '' : String(merged.slug ?? page.key);
    if (page.key !== 'accueil' && !SLUG.test(slug)) throw badRequest('Adresse invalide : lettres minuscules, chiffres et tirets uniquement.');
    if (!merged.title) throw badRequest('Le title est obligatoire.');
    const path = slug ? `/${lang}/${slug}/` : `/${lang}/`;
    const clash = db.prepare('SELECT page_id FROM cms_page_i18n WHERE lang = ? AND path = ? AND page_id <> ?').get(lang, path, page.id);
    if (clash) throw badRequest(`L'adresse ${path} est déjà utilisée par une autre page.`);
    const defRow = lang === def ? merged : db.prepare('SELECT * FROM cms_page_i18n WHERE page_id = ? AND lang = ?').get(page.id, def);
    const row = {
      page_id: page.id, lang, slug, path,
      nav_label: merged.nav_label ?? null, title: merged.title, meta_description: merged.meta_description ?? '',
      og_title: merged.og_title ?? null, og_description: merged.og_description ?? null, og_image_id: merged.og_image_id ?? null,
      noindex: bool(merged.noindex), focus_keyword: merged.focus_keyword ?? null,
      status: lang === def ? 'ready' : (req.body.status || 'ready'),
      source_hash: pageSourceHash(defRow), updated_at: nowIso(), updated_by: req.user.id,
    };
    db.transaction(() => {
      db.prepare(`INSERT INTO cms_page_i18n (page_id, lang, slug, path, nav_label, title, meta_description, og_title, og_description, og_image_id, noindex, focus_keyword, status, source_hash, updated_at, updated_by)
        VALUES (@page_id, @lang, @slug, @path, @nav_label, @title, @meta_description, @og_title, @og_description, @og_image_id, @noindex, @focus_keyword, @status, @source_hash, @updated_at, @updated_by)
        ON CONFLICT (page_id, lang) DO UPDATE SET slug = excluded.slug, path = excluded.path, nav_label = excluded.nav_label, title = excluded.title,
          meta_description = excluded.meta_description, og_title = excluded.og_title, og_description = excluded.og_description, og_image_id = excluded.og_image_id,
          noindex = excluded.noindex, focus_keyword = excluded.focus_keyword, status = excluded.status, source_hash = excluded.source_hash,
          updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(row);
      // Adresse déjà publiée qui change : redirection 301 automatique vers la nouvelle
      if (before && before.path !== path && db.prepare('SELECT 1 FROM sys_page_state WHERE lang = ? AND path = ?').get(lang, before.path)) {
        db.prepare(`INSERT INTO cms_redirects (from_path, to_page, to_lang, code) VALUES (?, ?, ?, 301)
          ON CONFLICT (from_path) DO UPDATE SET to_page = excluded.to_page, to_lang = excluded.to_lang, to_url = NULL`).run(before.path, page.id, lang);
      }
      db.prepare('DELETE FROM cms_redirects WHERE from_path = ?').run(path);
      db.prepare('UPDATE cms_pages SET updated_at = ? WHERE id = ?').run(nowIso(), page.id);
    })();
    audit(db, req, 'update', 'page_i18n', page.id, { lang, before, after: row });
    return withStates(page.id)[lang];
  });

  /* ---------- Blocs des pages (sections et lignes : ordre, masquage, copies) ---------- */
  const blockPage = (req) => {
    const page = db.prepare('SELECT * FROM cms_pages WHERE id = ?').get(req.params.id);
    if (!page) throw notFound('Page');
    pageInScope(req, page);
    return page;
  };
  const BLOCK_REF = { type: 'object', required: ['zone', 'block'], additionalProperties: false, properties: {
    zone: { type: 'string', minLength: 1, maxLength: 200 }, block: { type: 'string', minLength: 1, maxLength: 200 },
  } };
  const blocksResult = (page, r) => {
    if (r.error) throw badRequest(r.error);
    db.prepare('UPDATE cms_pages SET updated_at = ? WHERE id = ?').run(nowIso(), page.id);
    return blockTree(db, page);
  };

  app.get('/pages/:id/blocks', { preHandler: guard(), schema: { params: ID } }, async (req) => blockTree(db, blockPage(req)));

  app.put('/pages/:id/blocks', {
    preHandler: guard('content'),
    schema: { params: ID, body: { type: 'object', required: ['zone', 'blocks'], additionalProperties: false, properties: {
      zone: { type: 'string', minLength: 1, maxLength: 200 },
      blocks: { type: 'array', maxItems: 200, items: { type: 'object', required: ['block'], additionalProperties: false, properties: {
        block: { type: 'string', minLength: 1, maxLength: 200 }, hidden: { type: 'boolean' },
      } } },
    } } },
  }, async (req) => {
    const page = blockPage(req);
    const out = blocksResult(page, saveZone(db, page, req.body.zone, req.body.blocks));
    audit(db, req, 'update', 'page_blocks', page.id, { after: req.body });
    return out;
  });

  app.post('/pages/:id/blocks/copy', { preHandler: guard('content'), schema: { params: ID, body: BLOCK_REF } }, async (req) => {
    const page = blockPage(req);
    const r = copyBlock(db, page, req.body.zone, req.body.block);
    const out = blocksResult(page, r);
    audit(db, req, 'create', 'page_block', page.id, { after: { ...req.body, copy: r.block } });
    return { copy: r.block, tree: out };
  });

  app.post('/pages/:id/blocks/delete', { preHandler: guard('content'), schema: { params: ID, body: BLOCK_REF } }, async (req) => {
    const page = blockPage(req);
    const out = blocksResult(page, deleteBlock(db, page, req.body.zone, req.body.block));
    audit(db, req, 'delete', 'page_block', page.id, { before: req.body });
    return out;
  });

  /* ---------- Textes ---------- */
  function entriesFor({ id = null, page = null, pages = null, scope = null, q = null }) {
    const def = defaultLang();
    const where = [];
    const params = {};
    if (id) { where.push('e.id = @id'); params.id = id; }
    if (page) { where.push('e.page_id = @page'); params.page = page; }
    if (pages) where.push(`e.page_id IN (${pages.map(Number).join(',') || 'NULL'})`);
    if (scope === 'global') where.push("e.page_id IS NULL AND e.key NOT LIKE 'ui.%' AND e.key NOT LIKE 'jsonld.%'");
    if (scope === 'ui') where.push("e.key LIKE 'ui.%'");
    if (scope && !['global', 'ui'].includes(scope)) { where.push('e.key LIKE @prefix'); params.prefix = `${scope}.%`; }
    if (q) { where.push('(e.key LIKE @q OR e.label LIKE @q OR EXISTS (SELECT 1 FROM cms_entry_values v2 WHERE v2.entry_id = e.id AND v2.value LIKE @q))'); params.q = `%${q}%`; }
    const entries = db.prepare(`SELECT e.* FROM cms_entries e ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.position, e.id`).all(params);
    const values = db.prepare('SELECT * FROM cms_entry_values WHERE entry_id = ?');
    const langs = db.prepare('SELECT code FROM cms_languages ORDER BY position').pluck().all();
    const thumbOf = db.prepare("SELECT '/media/' || path FROM cms_media_variants WHERE media_id = ? AND purpose = 'thumb'").pluck();
    return entries.map((e) => {
      const rows = Object.fromEntries(values.all(e.id).map((v) => [v.lang, v]));
      const source = rows[def] ? valueHash(rows[def].value) : null;
      const hasValue = e.type === 'media' ? (r) => Boolean(r?.media_id) : undefined;
      return {
        ...e,
        values: Object.fromEntries(langs.map((l) => [l, rows[l]
          ? { value: rows[l].value, media_id: rows[l].media_id, thumb: rows[l].media_id ? thumbOf.get(rows[l].media_id) ?? null : undefined, status: rows[l].status, state: translationState(rows[l], source, l === def, hasValue), updated_at: rows[l].updated_at }
          : { state: 'missing' }])),
      };
    });
  }

  app.get('/entries', {
    preHandler: guard(),
    schema: { querystring: { type: 'object', properties: { page: { type: 'integer' }, scope: { type: 'string', maxLength: 60 }, q: { type: 'string', maxLength: 100 } } } },
  }, async (req) => {
    if (!isScoped(req.user)) return entriesFor(req.query);
    const keys = [...rulesOf(req.user).pages];
    const allowed = db.prepare(`SELECT id FROM cms_pages WHERE key IN (${keys.map(() => '?').join(',')})`).pluck().all(...keys);
    if (req.query.page && !allowed.includes(req.query.page)) throw new HttpError(403, `Hors de votre périmètre (${rulesOf(req.user).label}).`);
    return entriesFor({ q: req.query.q, pages: req.query.page ? [req.query.page] : allowed });
  });

  app.put('/entries/:id/:lang', {
    preHandler: guard(),
    schema: { params: ID_LANG, body: { type: 'object', additionalProperties: false, properties: {
      value: { type: ['string', 'null'], maxLength: 20000 }, media_id: { type: ['integer', 'null'] }, status: STATUS,
    } } },
  }, async (req) => {
    const { lang } = req.params;
    assertLang(db, lang);
    const def = defaultLang();
    assertCan(req, 'translate', { lang, defaultLang: def });
    const entry = db.prepare('SELECT * FROM cms_entries WHERE id = ?').get(req.params.id);
    if (!entry) throw notFound('Texte');
    const entryPage = entry.page_id ? db.prepare('SELECT key FROM cms_pages WHERE id = ?').pluck().get(entry.page_id) : null;
    assertInScope(req, (r) => Boolean(entryPage) && r.pages.has(entryPage), `le texte ${entry.key}`);
    let value = req.body.value ?? null;
    let mediaId = req.body.media_id ?? null;
    if (entry.type === 'media') {
      if (mediaId && !db.prepare('SELECT 1 FROM cms_media WHERE id = ? AND deleted_at IS NULL').get(mediaId)) throw badRequest('Média introuvable.');
      value = null;
    } else {
      mediaId = null;
      if (value === null) throw badRequest('Valeur manquante.');
      if (entry.type === 'richtext') value = sanitizeRich(value);
      if (entry.type === 'url' && value) value = /^(#\/|\/)/.test(value) ? value : assertHttpUrl(value);
      if (entry.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw badRequest('Adresse e-mail invalide.');
      if (entry.max_length && value.length > entry.max_length) throw badRequest(`${entry.max_length} caractères au plus.`);
    }
    if (entry.required && lang === def && !value && !mediaId) throw badRequest('Ce texte est obligatoire dans la langue par défaut.');
    const before = db.prepare('SELECT * FROM cms_entry_values WHERE entry_id = ? AND lang = ?').get(entry.id, lang);
    const defRow = lang === def ? { value } : db.prepare('SELECT value FROM cms_entry_values WHERE entry_id = ? AND lang = ?').get(entry.id, def);
    const status = lang === def ? 'ready' : (req.body.status || 'ready');
    db.prepare(`INSERT INTO cms_entry_values (entry_id, lang, value, media_id, status, source_hash, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (entry_id, lang) DO UPDATE SET value = excluded.value, media_id = excluded.media_id, status = excluded.status,
        source_hash = excluded.source_hash, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(entry.id, lang, value, mediaId, status, valueHash(defRow?.value ?? (mediaId ? String(mediaId) : '')), nowIso(), req.user.id);
    db.prepare('UPDATE cms_entries SET updated_at = ? WHERE id = ?').run(nowIso(), entry.id);
    audit(db, req, 'update', 'entry', entry.key, { lang, before: before ? { value: before.value, media_id: before.media_id } : null, after: { value, media_id: mediaId } });
    return entriesFor({ id: entry.id })[0];
  });

  /* ---------- Pictogrammes du site (sprite SVG du layout), pour les choisir dans l'admin ---------- */
  app.get('/icons', { preHandler: guard() }, async () => {
    const file = path.join(config.templatesDir, 'layout.html');
    if (!fs.existsSync(file)) return [];
    const $ = cheerio.load(fs.readFileSync(file, 'utf8'));
    return $('svg symbol[id^="i-"]').map((i, el) => ({ id: el.attribs.id, viewBox: el.attribs.viewBox || '0 0 24 24', body: $(el).html() })).get();
  });

  /* ---------- Réglages ---------- */
  app.get('/settings', { preHandler: guard() }, async (req) => {
    assertUnscoped(req);
    return Object.fromEntries(db.prepare('SELECT key, value FROM cms_settings').all().map((r) => [r.key, JSON.parse(r.value)]));
  });

  app.patch('/settings', { preHandler: guard('admin'), schema: { body: { type: 'object' } } }, async (req) => {
    const unknown = Object.keys(req.body).filter((k) => !SETTINGS_EDITABLE.includes(k));
    if (unknown.length) throw badRequest(`Réglage non modifiable : ${unknown.join(', ')}`);
    if ('x_default_lang' in req.body) assertLang(db, req.body.x_default_lang);
    if ('jsonld_graph' in req.body && !Array.isArray(req.body.jsonld_graph?.['@graph'])) throw badRequest('Données structurées : un objet avec une liste « @graph » est attendu.');
    const upsert = db.prepare(`INSERT INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
    db.transaction(() => {
      for (const [k, v] of Object.entries(req.body)) upsert.run(k, JSON.stringify(v), nowIso());
    })();
    audit(db, req, 'update', 'settings', null, { after: req.body });
    return { ok: true };
  });

  /* ---------- Redirections (anciennes adresses) ---------- */
  app.get('/redirects', { preHandler: guard() }, async (req) => {
    assertUnscoped(req);
    return db.prepare('SELECT * FROM cms_redirects ORDER BY from_path').all();
  });

  app.post('/redirects', {
    preHandler: guard('content'),
    schema: { body: { type: 'object', required: ['from_path'], additionalProperties: false, properties: {
      from_path: { type: 'string', pattern: '^/[^\\s]*$', maxLength: 300 }, to_page: { type: ['integer', 'null'] }, to_lang: { type: ['string', 'null'] },
      to_url: { type: ['string', 'null'], maxLength: 500 }, code: { type: 'integer', enum: [301, 302] },
    } } },
  }, async (req, reply) => {
    assertUnscoped(req);
    const b = req.body;
    if (!b.to_page === !b.to_url) throw badRequest('Indiquer soit une page de destination, soit une adresse.');
    if (b.to_url) b.to_url = /^\//.test(b.to_url) ? b.to_url : assertHttpUrl(b.to_url);
    if (b.to_lang) assertLang(db, b.to_lang);
    const id = db.prepare('INSERT INTO cms_redirects (from_path, to_page, to_lang, to_url, code) VALUES (?, ?, ?, ?, ?)')
      .run(b.from_path, b.to_page ?? null, b.to_lang ?? null, b.to_url ?? null, b.code ?? 301).lastInsertRowid;
    audit(db, req, 'create', 'redirect', id, { after: b });
    return reply.code(201).send(db.prepare('SELECT * FROM cms_redirects WHERE id = ?').get(id));
  });

  app.delete('/redirects/:id', { preHandler: guard('content'), schema: { params: ID } }, async (req) => {
    assertUnscoped(req);
    const row = db.prepare('SELECT * FROM cms_redirects WHERE id = ?').get(req.params.id);
    if (!row) throw notFound('Redirection');
    db.prepare('DELETE FROM cms_redirects WHERE id = ?').run(row.id);
    audit(db, req, 'delete', 'redirect', row.id, { before: row });
    return { ok: true };
  });

  app.get('/audit', { preHandler: guard('admin'), schema: { querystring: { type: 'object', properties: { limit: { type: 'integer', maximum: 500 } } } } },
    async (req) => db.prepare(`SELECT a.*, u.email FROM sys_audit_log a LEFT JOIN sys_users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`).all(req.query.limit || 100));
}
