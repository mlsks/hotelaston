/**
 * Bandeaux (zones, dates, appel à l'action) et popups (déclencheur, fréquence, média). Un popup
 * peut promouvoir une offre (offer_key) : il reprend alors son contenu, que ses textes remplacent.
 */
import { guard, assertCan, assertInScope, assertUnscoped, isScoped, rulesOf } from '../auth/auth.js';
import { notFound, badRequest, sanitizeInline, sanitizeRich, assertHttpUrl, toUtcIso } from '../lib/http.js';
import { nowIso, sha } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { popupConflicts } from '../lib/popup-conflicts.js';
import { ID, ID_LANG, STATUS, DATE, assertLang, translationState, pick, updateRow, bool } from './helpers.js';

const COLOR = { type: ['string', 'null'], pattern: '^#[0-9a-fA-F]{6}$' };
const CTA_KIND = { type: 'string', enum: ['none', 'page', 'item', 'url', 'booking'] };

/** Vérifie la cible d'un appel à l'action selon son type. */
function checkCta(db, kind, target) {
  if (!kind || kind === 'none' || !target) return target ?? null;
  if (kind === 'url') return assertHttpUrl(target);
  if (kind === 'page') {
    const key = target.replace(/^page:/, '');
    if (!db.prepare('SELECT 1 FROM cms_pages WHERE key = ?').get(key)) throw badRequest(`Page inconnue : ${key}`);
    return `page:${key}`;
  }
  if (kind === 'item') {
    const [collection, key] = target.replace(/^item:/, '').split('/');
    if (!db.prepare('SELECT 1 FROM cms_items WHERE collection = ? AND key = ?').get(collection, key)) throw badRequest(`Fiche inconnue : ${target}`);
    return `item:${collection}/${key}`;
  }
  if (kind === 'booking') {
    if (!/^(room|offer):[a-z0-9-]+$|^$/.test(target)) throw badRequest('Réservation : cible « room:<chambre> » ou « offer:<offre> ».');
    return target;
  }
  return target;
}

function dated(body, row = {}) {
  const fields = {};
  if ('start_at' in body) fields.start_at = toUtcIso(body.start_at);
  if ('end_at' in body) fields.end_at = toUtcIso(body.end_at);
  const start = 'start_at' in fields ? fields.start_at : row.start_at;
  const end = 'end_at' in fields ? fields.end_at : row.end_at;
  if (start && end && end <= start) throw badRequest('La date de fin doit suivre la date de début.');
  return fields;
}

export default function bannerRoutes(app, { db, defaultLang }) {
  const langs = () => db.prepare('SELECT code FROM cms_languages ORDER BY position').pluck().all();

  /* ---------- Bandeaux ---------- */
  const getBanner = (id) => {
    const b = db.prepare('SELECT * FROM cms_banners WHERE id = ?').get(id);
    if (!b) throw notFound('Bandeau');
    return b;
  };
  const bannerInScope = (req, b) => assertInScope(req, (r) => r.scopes.includes(b.scope), `le bandeau « ${b.name} »`);
  /** Un compte limité ne fait pointer un bandeau que vers les pages de son périmètre. */
  const ctaInScope = (req, kind, target) => {
    if (!isScoped(req.user) || !kind || kind === 'none') return;
    const key = String(target || '').replace(/^page:/, '');
    assertInScope(req, (r) => kind === 'page' && r.pages.has(key), `le lien ${kind}:${target}`);
  };
  function presentBanner(b) {
    const def = defaultLang();
    const rows = Object.fromEntries(db.prepare('SELECT * FROM cms_banner_i18n WHERE banner_id = ?').all(b.id).map((r) => [r.lang, r]));
    const source = rows[def] ? sha(`${rows[def].text}\n${rows[def].cta_label ?? ''}`) : null;
    return {
      ...b,
      placements: db.prepare(`SELECT bp.zone, bp.page_id, p.key AS page_key FROM cms_banner_placements bp LEFT JOIN cms_pages p ON p.id = bp.page_id
        WHERE bp.banner_id = ? ORDER BY bp.zone, p.position`).all(b.id),
      i18n: Object.fromEntries(langs().map((l) => [l, rows[l]
        ? { ...rows[l], state: translationState(rows[l], source, l === def, (r) => Boolean(r.text)) } : { state: 'missing' }])),
    };
  }
  const BANNER_BODY = {
    name: { type: 'string', minLength: 1, maxLength: 120 }, variant: { type: 'string', enum: ['info', 'promo', 'evenement', 'alerte'] },
    bg_color: COLOR, text_color: COLOR, icon: { type: ['string', 'null'], pattern: '^i-[a-z0-9-]+$' },
    cta_kind: CTA_KIND, cta_target: { type: ['string', 'null'], maxLength: 300 }, dismissible: { type: 'boolean' },
    priority: { type: 'integer' }, start_at: DATE, end_at: DATE, is_active: { type: 'boolean' },
  };

  app.get('/banners', { preHandler: guard() }, async (req) => db.prepare('SELECT * FROM cms_banners ORDER BY is_active DESC, priority DESC, id DESC').all()
    .filter((b) => !isScoped(req.user) || rulesOf(req.user).scopes.includes(b.scope))
    .map(presentBanner));
  app.get('/banners/:id', { preHandler: guard(), schema: { params: ID } }, async (req) => {
    const b = getBanner(req.params.id);
    bannerInScope(req, b);
    return presentBanner(b);
  });

  app.post('/banners', {
    preHandler: guard('content'),
    schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: BANNER_BODY } },
  }, async (req, reply) => {
    const b = req.body;
    ctaInScope(req, b.cta_kind, b.cta_target);
    const now = nowIso();
    const row = {
      name: b.name, variant: b.variant || 'info', bg_color: b.bg_color ?? null, text_color: b.text_color ?? null, icon: b.icon ?? null,
      cta_kind: b.cta_kind || 'none', cta_target: checkCta(db, b.cta_kind, b.cta_target), dismissible: bool(b.dismissible ?? true),
      priority: b.priority ?? 0, is_active: bool(b.is_active ?? true), start_at: null, end_at: null, ...dated(b),
      scope: isScoped(req.user) ? rulesOf(req.user).scopes[0] : null, created_at: now, updated_at: now,
    };
    const id = db.prepare(`INSERT INTO cms_banners (name, variant, bg_color, text_color, icon, cta_kind, cta_target, dismissible, priority, start_at, end_at, is_active, scope, created_at, updated_at)
      VALUES (@name, @variant, @bg_color, @text_color, @icon, @cta_kind, @cta_target, @dismissible, @priority, @start_at, @end_at, @is_active, @scope, @created_at, @updated_at)`).run(row).lastInsertRowid;
    audit(db, req, 'create', 'banner', id, { after: row });
    return reply.code(201).send(presentBanner(getBanner(id)));
  });

  app.patch('/banners/:id', {
    preHandler: guard('content'),
    schema: { params: ID, body: { type: 'object', additionalProperties: false, properties: BANNER_BODY } },
  }, async (req) => {
    const b = getBanner(req.params.id);
    bannerInScope(req, b);
    if ('cta_kind' in req.body || 'cta_target' in req.body) ctaInScope(req, req.body.cta_kind ?? b.cta_kind, req.body.cta_target ?? b.cta_target);
    const fields = { ...pick(req.body, ['name', 'variant', 'bg_color', 'text_color', 'icon', 'cta_kind', 'priority']), ...dated(req.body, b) };
    for (const k of ['dismissible', 'is_active']) if (k in req.body) fields[k] = bool(req.body[k]);
    if ('cta_target' in req.body || 'cta_kind' in req.body) fields.cta_target = checkCta(db, req.body.cta_kind ?? b.cta_kind, req.body.cta_target ?? b.cta_target);
    updateRow(db, 'cms_banners', b.id, { ...fields, updated_at: nowIso() });
    audit(db, req, 'update', 'banner', b.id, { before: b, after: fields });
    return presentBanner(getBanner(b.id));
  });

  app.delete('/banners/:id', { preHandler: guard('content'), schema: { params: ID } }, async (req) => {
    const b = getBanner(req.params.id);
    bannerInScope(req, b);
    db.prepare('DELETE FROM cms_banners WHERE id = ?').run(b.id);
    audit(db, req, 'delete', 'banner', b.id, { before: b });
    return { ok: true };
  });

  app.put('/banners/:id/i18n/:lang', {
    preHandler: guard(),
    schema: { params: ID_LANG, body: { type: 'object', required: ['text'], additionalProperties: false, properties: {
      text: { type: 'string', minLength: 1, maxLength: 600 }, cta_label: { type: ['string', 'null'], maxLength: 80 }, cta_url: { type: ['string', 'null'], maxLength: 500 }, status: STATUS,
    } } },
  }, async (req) => {
    const { lang } = req.params;
    assertLang(db, lang);
    const def = defaultLang();
    assertCan(req, 'translate', { lang, defaultLang: def });
    const b = getBanner(req.params.id);
    bannerInScope(req, b);
    const text = sanitizeInline(req.body.text);
    const cta = req.body.cta_label ?? null;
    const defRow = lang === def ? { text, cta_label: cta } : db.prepare('SELECT * FROM cms_banner_i18n WHERE banner_id = ? AND lang = ?').get(b.id, def);
    db.prepare(`INSERT INTO cms_banner_i18n (banner_id, lang, text, cta_label, cta_url, status, source_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (banner_id, lang) DO UPDATE SET text = excluded.text, cta_label = excluded.cta_label, cta_url = excluded.cta_url, status = excluded.status, source_hash = excluded.source_hash`)
      .run(b.id, lang, text, cta, req.body.cta_url ? assertHttpUrl(req.body.cta_url) : null, lang === def ? 'ready' : (req.body.status || 'ready'),
        defRow ? sha(`${defRow.text}\n${defRow.cta_label ?? ''}`) : null);
    db.prepare('UPDATE cms_banners SET updated_at = ? WHERE id = ?').run(nowIso(), b.id);
    audit(db, req, 'update', 'banner_i18n', b.id, { lang, after: { text, cta_label: cta } });
    return presentBanner(getBanner(b.id));
  });

  app.put('/banners/:id/placements', {
    preHandler: guard('content'),
    schema: { params: ID, body: { type: 'array', maxItems: 200, items: { type: 'object', required: ['zone'], additionalProperties: false, properties: {
      zone: { type: 'string' }, page_id: { type: ['integer', 'null'] }, page_key: { type: 'string' },
    } } } },
  }, async (req) => {
    const b = getBanner(req.params.id);
    bannerInScope(req, b);
    const rows = req.body.map((p) => {
      if (!db.prepare('SELECT 1 FROM cms_zones WHERE key = ?').get(p.zone)) throw badRequest(`Zone inconnue : ${p.zone}`);
      const pageId = p.page_key ? db.prepare('SELECT id FROM cms_pages WHERE key = ?').pluck().get(p.page_key) : p.page_id ?? null;
      if ((p.page_key || p.page_id) && !pageId) throw badRequest(`Page inconnue : ${p.page_key || p.page_id}`);
      const key = pageId ? db.prepare('SELECT key FROM cms_pages WHERE id = ?').pluck().get(pageId) : null;
      assertInScope(req, (r) => Boolean(key) && r.pages.has(key), key ? `la page « ${key} »` : 'toutes les pages');
      return { zone: p.zone, page_id: pageId };
    });
    if (isScoped(req.user)) {
      // Les emplacements hors périmètre posés par un éditeur complet sont conservés
      const pages = [...rulesOf(req.user).pages];
      const kept = db.prepare(`SELECT bp.zone, bp.page_id FROM cms_banner_placements bp LEFT JOIN cms_pages p ON p.id = bp.page_id
        WHERE bp.banner_id = ? AND (p.key IS NULL OR p.key NOT IN (${pages.map(() => '?').join(',')}))`).all(b.id, ...pages);
      rows.push(...kept);
    }
    db.transaction(() => {
      db.prepare('DELETE FROM cms_banner_placements WHERE banner_id = ?').run(b.id);
      const ins = db.prepare('INSERT OR IGNORE INTO cms_banner_placements (banner_id, zone, page_id) VALUES (?, ?, ?)');
      for (const r of rows) ins.run(b.id, r.zone, r.page_id);
    })();
    audit(db, req, 'update', 'banner_placements', b.id, { after: rows });
    return presentBanner(getBanner(b.id));
  });

  app.get('/zones', { preHandler: guard() }, async () => db.prepare('SELECT * FROM cms_zones ORDER BY rowid').all());

  /* ---------- Popups (comptes sans périmètre uniquement) ---------- */
  const unscoped = async (req) => assertUnscoped(req);
  const getPopup = (id) => {
    const p = db.prepare('SELECT * FROM cms_popups WHERE id = ?').get(id);
    if (!p) throw notFound('Popup');
    return p;
  };
  /** Offre d'un popup ; son titre est un texte traduit (langue par défaut). */
  const getOffer = (key) => db.prepare(`SELECT it.id, it.key, it.is_active, it.start_at, it.end_at,
      COALESCE(json_extract(tr.data, '$.title'), json_extract(it.data, '$.title')) AS title
    FROM cms_items it LEFT JOIN cms_item_i18n tr ON tr.item_id = it.id AND tr.lang = ? WHERE it.collection = 'offers' AND it.key = ?`).get(defaultLang(), key);
  function presentPopup(p, conflicts = popupConflicts(db)) {
    const def = defaultLang();
    const rows = Object.fromEntries(db.prepare('SELECT * FROM cms_popup_i18n WHERE popup_id = ?').all(p.id).map((r) => [r.lang, r]));
    const source = rows[def] ? sha(`${rows[def].title}\n${rows[def].body ?? ''}\n${rows[def].cta_label ?? ''}`) : null;
    // Popup d'une offre : ses textes sont facultatifs (sinon ceux de l'offre)
    const hasText = p.offer_key ? (r) => Boolean(r.title || r.body) : (r) => Boolean(r.title);
    return {
      ...p,
      offer: p.offer_key ? getOffer(p.offer_key) || null : null,
      conflicts: conflicts.get(p.id) || [],
      pages: db.prepare(`SELECT pp.page_id, pp.mode, pg.key AS page_key FROM cms_popup_pages pp LEFT JOIN cms_pages pg ON pg.id = pp.page_id WHERE pp.popup_id = ?`).all(p.id),
      i18n: Object.fromEntries(langs().map((l) => [l, rows[l]
        ? { ...rows[l], state: translationState(rows[l], source, l === def, hasText) } : { state: 'missing' }])),
    };
  }
  const checkOffer = (key) => {
    if (!key) return null;
    if (!getOffer(key)) throw badRequest(`Offre inconnue : ${key}`);
    return key;
  };
  const POPUP_BODY = {
    name: { type: 'string', minLength: 1, maxLength: 120 }, is_active: { type: 'boolean' }, start_at: DATE, end_at: DATE,
    media_id: { type: ['integer', 'null'] }, trigger_type: { type: 'string', enum: ['delay', 'scroll', 'exit_intent'] },
    trigger_value: { type: ['integer', 'null'], minimum: 0, maximum: 600 }, mobile_trigger: { type: 'string', enum: ['delay', 'scroll', 'none'] },
    frequency: { type: 'string', enum: ['once', 'session', 'days'] }, frequency_days: { type: ['integer', 'null'], minimum: 1, maximum: 365 },
    priority: { type: 'integer' }, reshow: { type: 'boolean' }, offer_key: { type: ['string', 'null'], maxLength: 120 },
  };
  const checkMedia = (id) => {
    if (!id) return null;
    const m = db.prepare('SELECT kind FROM cms_media WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!m || !['image', 'video', 'audio'].includes(m.kind)) throw badRequest('Média du popup : image, vidéo ou son de la médiathèque.');
    return id;
  };

  app.get('/popups', { preHandler: [guard(), unscoped] }, async () => {
    const conflicts = popupConflicts(db);
    return db.prepare('SELECT * FROM cms_popups ORDER BY is_active DESC, priority DESC, id DESC').all().map((p) => presentPopup(p, conflicts));
  });
  app.get('/popups/:id', { preHandler: [guard(), unscoped], schema: { params: ID } }, async (req) => presentPopup(getPopup(req.params.id)));

  app.post('/popups', {
    preHandler: [guard('content'), unscoped],
    schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: POPUP_BODY } },
  }, async (req, reply) => {
    const b = req.body;
    const now = nowIso();
    const row = {
      name: b.name, is_active: bool(b.is_active ?? false), start_at: null, end_at: null, ...dated(b), media_id: checkMedia(b.media_id),
      trigger_type: b.trigger_type || 'delay', trigger_value: b.trigger_value ?? 8, mobile_trigger: b.mobile_trigger || 'scroll',
      frequency: b.frequency || 'days', frequency_days: b.frequency_days ?? 7, priority: b.priority ?? 0, offer_key: checkOffer(b.offer_key),
      created_at: now, updated_at: now,
    };
    const id = db.prepare(`INSERT INTO cms_popups (name, is_active, start_at, end_at, media_id, trigger_type, trigger_value, mobile_trigger, frequency, frequency_days, priority, offer_key, created_at, updated_at)
      VALUES (@name, @is_active, @start_at, @end_at, @media_id, @trigger_type, @trigger_value, @mobile_trigger, @frequency, @frequency_days, @priority, @offer_key, @created_at, @updated_at)`).run(row).lastInsertRowid;
    audit(db, req, 'create', 'popup', id, { after: row });
    return reply.code(201).send(presentPopup(getPopup(id)));
  });

  app.patch('/popups/:id', {
    preHandler: [guard('content'), unscoped],
    schema: { params: ID, body: { type: 'object', additionalProperties: false, properties: POPUP_BODY } },
  }, async (req) => {
    const p = getPopup(req.params.id);
    const fields = { ...pick(req.body, ['name', 'trigger_type', 'trigger_value', 'mobile_trigger', 'frequency', 'frequency_days', 'priority']), ...dated(req.body, p) };
    if ('is_active' in req.body) fields.is_active = bool(req.body.is_active);
    if ('media_id' in req.body) fields.media_id = checkMedia(req.body.media_id);
    if ('offer_key' in req.body) fields.offer_key = checkOffer(req.body.offer_key);
    if (req.body.reshow) fields.version = p.version + 1; // réafficher aux visiteurs qui l'avaient fermé
    updateRow(db, 'cms_popups', p.id, { ...fields, updated_at: nowIso() });
    audit(db, req, 'update', 'popup', p.id, { before: p, after: fields });
    return presentPopup(getPopup(p.id));
  });

  app.delete('/popups/:id', { preHandler: [guard('content'), unscoped], schema: { params: ID } }, async (req) => {
    const p = getPopup(req.params.id);
    db.prepare('DELETE FROM cms_popups WHERE id = ?').run(p.id);
    audit(db, req, 'delete', 'popup', p.id, { before: p });
    return { ok: true };
  });

  app.put('/popups/:id/i18n/:lang', {
    preHandler: [guard(), unscoped],
    schema: { params: ID_LANG, body: { type: 'object', required: ['title'], additionalProperties: false, properties: {
      title: { type: 'string', maxLength: 160 }, body: { type: ['string', 'null'], maxLength: 4000 },
      cta_label: { type: ['string', 'null'], maxLength: 80 }, cta_kind: CTA_KIND, cta_target: { type: ['string', 'null'], maxLength: 300 }, status: STATUS,
    } } },
  }, async (req) => {
    const { lang } = req.params;
    assertLang(db, lang);
    const def = defaultLang();
    assertCan(req, 'translate', { lang, defaultLang: def });
    const p = getPopup(req.params.id);
    const body = req.body.body ? sanitizeRich(req.body.body) : null;
    const ctaKind = req.body.cta_kind && req.body.cta_kind !== 'none' ? req.body.cta_kind : null; // sans bouton (popup d'une offre : celui de l'offre) : NULL en base
    if (!req.body.title.trim() && !p.offer_key) throw badRequest('Le titre du popup est obligatoire.');
    if (p.offer_key && !req.body.title.trim() && !body && !ctaKind) {
      // Plus rien de propre au popup dans cette langue : il reprend entièrement l'offre
      db.prepare('DELETE FROM cms_popup_i18n WHERE popup_id = ? AND lang = ?').run(p.id, lang);
      db.prepare('UPDATE cms_popups SET updated_at = ? WHERE id = ?').run(nowIso(), p.id);
      audit(db, req, 'update', 'popup_i18n', p.id, { lang, after: null });
      return presentPopup(getPopup(p.id));
    }
    const defRow = lang === def ? { title: req.body.title, body, cta_label: req.body.cta_label } : db.prepare('SELECT * FROM cms_popup_i18n WHERE popup_id = ? AND lang = ?').get(p.id, def);
    db.prepare(`INSERT INTO cms_popup_i18n (popup_id, lang, title, body, cta_label, cta_kind, cta_target, status, source_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (popup_id, lang) DO UPDATE SET title = excluded.title, body = excluded.body, cta_label = excluded.cta_label, cta_kind = excluded.cta_kind,
        cta_target = excluded.cta_target, status = excluded.status, source_hash = excluded.source_hash`)
      .run(p.id, lang, req.body.title, body, req.body.cta_label ?? null, ctaKind, ctaKind ? checkCta(db, ctaKind, req.body.cta_target) : null,
        lang === def ? 'ready' : (req.body.status || 'ready'), defRow ? sha(`${defRow.title}\n${defRow.body ?? ''}\n${defRow.cta_label ?? ''}`) : null);
    db.prepare('UPDATE cms_popups SET updated_at = ? WHERE id = ?').run(nowIso(), p.id);
    audit(db, req, 'update', 'popup_i18n', p.id, { lang, after: req.body });
    return presentPopup(getPopup(p.id));
  });

  app.put('/popups/:id/pages', {
    preHandler: [guard('content'), unscoped],
    schema: { params: ID, body: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: false, properties: {
      page_id: { type: ['integer', 'null'] }, page_key: { type: 'string' }, mode: { type: 'string', enum: ['include', 'exclude'] },
    } } } },
  }, async (req) => {
    const p = getPopup(req.params.id);
    const rows = req.body.map((r) => {
      const pageId = r.page_key ? db.prepare('SELECT id FROM cms_pages WHERE key = ?').pluck().get(r.page_key) : r.page_id ?? null;
      if ((r.page_key || r.page_id) && !pageId) throw badRequest(`Page inconnue : ${r.page_key || r.page_id}`);
      return { page_id: pageId, mode: r.mode || 'include' };
    });
    db.transaction(() => {
      db.prepare('DELETE FROM cms_popup_pages WHERE popup_id = ?').run(p.id);
      const ins = db.prepare('INSERT OR IGNORE INTO cms_popup_pages (popup_id, page_id, mode) VALUES (?, ?, ?)');
      for (const r of rows) ins.run(p.id, r.page_id, r.mode);
    })();
    audit(db, req, 'update', 'popup_pages', p.id, { after: rows });
    return presentPopup(getPopup(p.id));
  });

  /** Conflit tranché : ce popup passe devant l'autre pendant leur période commune (priorité relevée). */
  app.post('/popups/:id/prefer', {
    preHandler: [guard('content'), unscoped],
    schema: { params: ID, body: { type: 'object', required: ['over'], additionalProperties: false, properties: { over: { type: 'integer' } } } },
  }, async (req) => {
    const p = getPopup(req.params.id);
    const other = getPopup(req.body.over);
    if (other.id === p.id) throw badRequest('Choisissez un autre popup.');
    if (p.priority <= other.priority) {
      updateRow(db, 'cms_popups', p.id, { priority: other.priority + 1, updated_at: nowIso() });
      audit(db, req, 'update', 'popup', p.id, { before: { priority: p.priority }, after: { priority: other.priority + 1, over: other.id } });
    }
    return presentPopup(getPopup(p.id));
  });
}
