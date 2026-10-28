/**
 * État des traductions par langue et par module, liste des textes à traduire,
 * rapport SEO du dernier build et contrôles SEO d'une page.
 */
import * as cheerio from 'cheerio';
import { guard, assertUnscoped, assertInScope } from '../auth/auth.js';
import { notFound, badRequest } from '../lib/http.js';
import { sha } from '../lib/util.js';
import { renderOne } from '../ssg/build.js';
import { ID_LANG, assertLang, translationState, pageSourceHash, valueHash } from './helpers.js';

const STATES = ['ready', 'draft', 'outdated', 'missing'];
const MODULES = ['pages', 'entries', 'items', 'media', 'banners', 'popups'];

/** Toutes les unités traduisibles d'une langue : { module, id, label, state }. */
function units(db, lang, def) {
  const out = [];
  const byLang = (sql, ...args) => {
    const map = new Map();
    for (const r of db.prepare(sql).all(...args)) {
      if (!map.has(r.k)) map.set(r.k, {});
      map.get(r.k)[r.lang] = r;
    }
    return map;
  };

  const pages = byLang('SELECT page_id AS k, * FROM cms_page_i18n');
  for (const p of db.prepare('SELECT * FROM cms_pages WHERE is_active = 1 ORDER BY position').all()) {
    const rows = pages.get(p.id) || {};
    out.push({ module: 'pages', id: p.id, label: rows[def]?.title || p.key, ref: p.key, state: translationState(rows[lang], pageSourceHash(rows[def]), lang === def, (r) => Boolean(r?.title)) });
  }

  const values = byLang('SELECT entry_id AS k, * FROM cms_entry_values');
  for (const e of db.prepare('SELECT * FROM cms_entries WHERE translatable = 1 ORDER BY position, id').all()) {
    const rows = values.get(e.id) || {};
    const hasValue = e.type === 'media' ? (r) => Boolean(r?.media_id) : undefined;
    if (!rows[def] || (e.type !== 'media' && !rows[def].value)) continue;
    out.push({ module: 'entries', id: e.id, label: e.label, ref: e.key, section: e.section, state: translationState(rows[lang], valueHash(rows[def].value), lang === def, hasValue) });
  }

  const translatable = new Map(db.prepare('SELECT key, schema FROM cms_collections').all().map((c) => [c.key, JSON.parse(c.schema).translatable]));
  const items = byLang('SELECT item_id AS k, * FROM cms_item_i18n');
  for (const it of db.prepare('SELECT * FROM cms_items WHERE is_active = 1 ORDER BY collection, position').all()) {
    if (!translatable.get(it.collection)?.length) continue;
    const rows = items.get(it.id) || {};
    if (!rows[def]) continue;
    const source = JSON.parse(rows[def].data);
    if (!Object.values(source).some((v) => (typeof v === 'string' ? v.trim() : v && JSON.stringify(v) !== '[]' && JSON.stringify(v) !== '{}'))) continue; // rien à traduire
    const name = source.name || source.title || source.label || JSON.parse(it.data).name;
    out.push({ module: 'items', id: it.id, label: `${it.collection} · ${name || it.key}`, ref: `${it.collection}/${it.key}`,
      state: translationState(rows[lang], sha(rows[def].data), lang === def, (r) => Boolean(r?.data && r.data !== '{}')) });
  }

  const media = byLang('SELECT media_id AS k, * FROM cms_media_i18n');
  for (const m of db.prepare("SELECT * FROM cms_media WHERE deleted_at IS NULL AND kind NOT IN ('embed', 'document')").all()) {
    const rows = media.get(m.id) || {};
    out.push({ module: 'media', id: m.id, label: m.original_name || `média ${m.id}`, ref: String(m.id),
      state: translationState(rows[lang], rows[def] ? sha(`${rows[def].alt ?? ''}\n${rows[def].title ?? ''}`) : null, lang === def, (r) => Boolean(r?.alt)) });
  }

  const banners = byLang('SELECT banner_id AS k, * FROM cms_banner_i18n');
  for (const b of db.prepare('SELECT * FROM cms_banners WHERE is_active = 1').all()) {
    const rows = banners.get(b.id) || {};
    out.push({ module: 'banners', id: b.id, label: b.name, ref: String(b.id),
      state: translationState(rows[lang], rows[def] ? sha(`${rows[def].text}\n${rows[def].cta_label ?? ''}`) : null, lang === def, (r) => Boolean(r?.text)) });
  }

  const popups = byLang('SELECT popup_id AS k, * FROM cms_popup_i18n');
  for (const p of db.prepare('SELECT * FROM cms_popups WHERE is_active = 1').all()) {
    const rows = popups.get(p.id) || {};
    out.push({ module: 'popups', id: p.id, label: p.name, ref: String(p.id),
      state: translationState(rows[lang], rows[def] ? sha(`${rows[def].title}\n${rows[def].body ?? ''}\n${rows[def].cta_label ?? ''}`) : null, lang === def, (r) => Boolean(r?.title)) });
  }
  return out;
}

const count = (list) => {
  const c = Object.fromEntries(STATES.map((s) => [s, 0]));
  for (const u of list) c[u.state] += 1;
  return { total: list.length, ...c, percent: list.length ? Math.round((c.ready / list.length) * 100) : 100 };
};

const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export default function translationRoutes(app, { db, defaultLang }) {
  app.get('/translations/status', { preHandler: guard() }, async (req) => {
    assertUnscoped(req);
    const def = defaultLang();
    const langs = db.prepare('SELECT * FROM cms_languages WHERE is_default = 0 ORDER BY position').all();
    return {
      defaultLang: def,
      langs: langs.map((l) => {
        const all = units(db, l.code, def);
        return { code: l.code, name: l.name, is_active: Boolean(l.is_active), ...count(all),
          modules: Object.fromEntries(MODULES.map((m) => [m, count(all.filter((u) => u.module === m))])) };
      }),
    };
  });

  app.get('/translations/todo', {
    preHandler: guard(),
    schema: { querystring: { type: 'object', required: ['lang'], properties: {
      lang: { type: 'string' }, module: { type: 'string', enum: MODULES }, state: { type: 'string', enum: STATES }, limit: { type: 'integer', maximum: 2000 },
    } } },
  }, async (req) => {
    assertUnscoped(req);
    assertLang(db, req.query.lang);
    const def = defaultLang();
    if (req.query.lang === def) throw badRequest('La langue par défaut est la source des traductions.');
    return units(db, req.query.lang, def)
      .filter((u) => u.state !== 'ready')
      .filter((u) => !req.query.module || u.module === req.query.module)
      .filter((u) => !req.query.state || u.state === req.query.state)
      .slice(0, req.query.limit || 500);
  });

  /* ---------- SEO ---------- */
  app.get('/seo/report', { preHandler: guard() }, async () => {
    const last = (kind) => db.prepare(`SELECT id, kind, status, finished_at, warnings FROM sys_builds WHERE kind = ? AND status IN ('success', 'skipped') ORDER BY id DESC LIMIT 1`).get(kind);
    const shape = (b) => (b ? { ...b, warnings: JSON.parse(b.warnings || '[]') } : null);
    return { preview: shape(last('preview')), production: shape(last('production')) };
  });

  /** Contrôles d'une page dans une langue, sur son rendu réel (base de travail). */
  app.get('/seo/pages/:id/:lang', { preHandler: guard(), schema: { params: ID_LANG } }, async (req) => {
    const { lang } = req.params;
    assertLang(db, lang);
    const page = db.prepare('SELECT * FROM cms_pages WHERE id = ?').get(req.params.id);
    if (!page) throw notFound('Page');
    assertInScope(req, (r) => r.pages.has(page.key), `la page « ${page.key} »`);
    const meta = db.prepare('SELECT * FROM cms_page_i18n WHERE page_id = ? AND lang = ?').get(page.id, lang)
      || db.prepare('SELECT * FROM cms_page_i18n WHERE page_id = ? AND lang = ?').get(page.id, defaultLang());
    const out = renderOne(db, { route: page.key === 'accueil' ? '' : page.key, lang });
    if (!out) throw notFound('Rendu de la page');
    const $ = cheerio.load(out.html);
    const title = $('head title').text();
    const description = $('head meta[name="description"]').attr('content') || '';
    const main = $('main');
    const h1 = main.find('h1');
    const firstParagraph = main.find('p').filter((i, el) => $(el).text().trim().length > 40).first().text();
    const words = main.text().split(/\s+/).filter(Boolean).length;
    const levels = main.find('h1, h2, h3, h4, h5, h6').map((i, el) => Number(el.name[1])).get();
    const jump = levels.some((l, i) => i > 0 && l - levels[i - 1] > 1);
    const noAlt = main.find('img').filter((i, el) => el.attribs.alt === undefined).length;
    const dupTitle = db.prepare('SELECT COUNT(*) FROM cms_page_i18n WHERE lang = ? AND title = ? AND page_id <> ?').pluck().get(lang, title, page.id);
    const dupDesc = db.prepare('SELECT COUNT(*) FROM cms_page_i18n WHERE lang = ? AND meta_description = ? AND page_id <> ?').pluck().get(lang, description, page.id);

    const check = (id, label, ok, detail, level = 'warn') => ({ id, label, status: ok ? 'ok' : level, detail });
    const checks = [
      check('title-length', 'Title de 30 à 60 caractères', title.length >= 30 && title.length <= 60, `${title.length} caractères`),
      check('description-length', 'Description de 70 à 160 caractères', description.length >= 70 && description.length <= 160, `${description.length} caractères`),
      check('h1', 'Un seul titre H1', h1.length === 1, `${h1.length} H1`, 'error'),
      check('headings', "Titres dans l'ordre (pas de saut de niveau)", !jump, levels.map((l) => `H${l}`).join(' › ')),
      check('img-alt', 'Texte alternatif sur chaque image', noAlt === 0, noAlt ? `${noAlt} image(s) sans alt` : 'toutes renseignées'),
      check('duplicate-title', 'Title unique', dupTitle === 0, dupTitle ? `partagé avec ${dupTitle} autre(s) page(s)` : 'unique'),
      check('duplicate-description', 'Description unique', dupDesc === 0, dupDesc ? `partagée avec ${dupDesc} autre(s) page(s)` : 'unique'),
      check('length', 'Au moins 300 mots pour une page de recherche', words >= 300 || !/-nice$/.test(page.key), `${words} mots`),
    ];
    const kw = normalize(meta?.focus_keyword);
    if (kw) {
      const has = (s) => normalize(s).includes(kw);
      checks.push(
        check('kw-title', 'Mot-clé dans le title', has(title), meta.focus_keyword),
        check('kw-h1', 'Mot-clé dans le H1', has(h1.first().text()), h1.first().text()),
        check('kw-description', 'Mot-clé dans la description', has(description), ''),
        check('kw-slug', "Mot-clé dans l'adresse", has(String(meta.slug || '').replace(/-/g, ' ')), out.path),
        check('kw-intro', 'Mot-clé dans le premier paragraphe', has(firstParagraph), firstParagraph.slice(0, 80)),
      );
    } else {
      checks.push(check('kw', 'Mot-clé principal renseigné', false, 'à définir dans les réglages SEO de la page'));
    }
    const ok = checks.filter((c) => c.status === 'ok').length;
    return {
      path: out.path, title, description, focus_keyword: meta?.focus_keyword || null,
      score: Math.round((ok / checks.length) * 100), checks,
      snippet: { url: out.path, title: title.length > 60 ? `${title.slice(0, 57)}…` : title, description: description.length > 160 ? `${description.slice(0, 157)}…` : description },
    };
  });
}
