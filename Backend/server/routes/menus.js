/**
 * Cartes du restaurant et des bars : création d'une carte (page + contenu + lien dans « Les cartes »
 * du lieu), masquage. Le contenu se modifie ensuite par les routes des collections (/items/:id).
 */
import { guard, assertUnscoped } from '../auth/auth.js';
import { notFound, badRequest } from '../lib/http.js';
import { nowIso, sha } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { MENUS, MENU_TEMPLATE, VENUES } from '../ssg/menus.js';
import { LINKS } from '../ssg/link-lists.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function menuRoutes(app, { db, defaultLang }) {
  const pageOf = (key) => db.prepare('SELECT * FROM cms_pages WHERE key = ?').get(key);

  /** Cartes : contenu (comme /collections/menus/items) + page (id, adresse, active). */
  app.get('/menus', { preHandler: guard() }, async (req) => {
    assertUnscoped(req);
    const def = defaultLang();
    return db.prepare(`SELECT i.id, i.key, i.is_active, i.data, json_extract(ii.data, '$.title') AS title, p.id AS page_id, pi.path
      FROM cms_items i LEFT JOIN cms_item_i18n ii ON ii.item_id = i.id AND ii.lang = @def
      LEFT JOIN cms_pages p ON p.key = i.key LEFT JOIN cms_page_i18n pi ON pi.page_id = p.id AND pi.lang = @def
      WHERE i.collection = @menus ORDER BY i.position, i.id`).all({ def, menus: MENUS })
      .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  });

  app.get('/menus/venues', { preHandler: guard() }, async () => Object.entries(VENUES).map(([key, v]) => ({ key, label: v.label })));

  /** Nouvelle carte : page sous le lieu, contenu vide (une rubrique), lien ajouté à « Les cartes » du lieu. */
  app.post('/menus', {
    preHandler: guard('content'),
    schema: { body: { type: 'object', required: ['title', 'venue', 'slug'], additionalProperties: false, properties: {
      title: { type: 'string', minLength: 1, maxLength: 120 }, venue: { type: 'string', maxLength: 60 }, slug: { type: 'string', maxLength: 80 },
    } } },
  }, async (req, reply) => {
    assertUnscoped(req);
    const { venue } = req.body;
    const title = req.body.title.trim();
    const slug = req.body.slug.trim();
    if (!VENUES[venue]) throw badRequest('Lieu inconnu.');
    if (!title) throw badRequest('Nom de la carte obligatoire.');
    if (!SLUG.test(slug)) throw badRequest('Adresse invalide : lettres minuscules, chiffres et tirets.');
    const def = defaultLang();
    if (pageOf(slug) || db.prepare('SELECT 1 FROM cms_page_i18n WHERE lang = ? AND path = ?').get(def, `/${def}/${slug}/`)) throw badRequest(`L’adresse « ${slug} » est déjà utilisée.`);
    const parent = pageOf(venue);
    const now = nowIso();
    const label = VENUES[venue].label;
    const id = db.transaction(() => {
      const pageId = db.prepare(`INSERT INTO cms_pages (key, template, parent_id, in_sitemap, is_active, position, created_at, updated_at)
        VALUES (?, ?, ?, 1, 1, (SELECT COALESCE(MAX(position), 0) + 1 FROM cms_pages), ?, ?)`).run(slug, MENU_TEMPLATE, parent?.id ?? null, now, now).lastInsertRowid;
      const meta = { title: `${title}, ${label} | Hôtel Aston La Scala, Nice`, meta_description: `${title} : la carte du ${label} à l'hôtel Aston La Scala, à Nice.` };
      db.prepare(`INSERT INTO cms_page_i18n (page_id, lang, slug, path, title, meta_description, status, source_hash, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`).run(pageId, def, slug, `/${def}/${slug}/`, meta.title, meta.meta_description, sha(`${meta.title}\n${meta.meta_description}`), now, req.user.id);
      const base = { page: slug, venue, sections: [{ dishes: [] }] };
      const itemId = db.prepare(`INSERT INTO cms_items (collection, key, data, is_active, position, created_at, updated_at)
        VALUES (?, ?, ?, 1, (SELECT COALESCE(MAX(position), -1) + 1 FROM cms_items WHERE collection = ?), ?, ?)`).run(MENUS, slug, JSON.stringify(base), MENUS, now, now).lastInsertRowid;
      const tr = JSON.stringify({ title, backLabel: `Retour : ${label}`, sections: [{ title: 'Nouvelle rubrique', dishes: [] }] });
      db.prepare(`INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at, updated_by) VALUES (?, ?, NULL, ?, 'ready', ?, ?, ?)`)
        .run(itemId, def, tr, sha(tr), now, req.user.id);
      // Lien dans « Les cartes » du lieu, si la liste est gérée dans Menus et liens
      const list = VENUES[venue].links;
      if (list && db.prepare(`SELECT 1 FROM cms_items WHERE collection = ? AND json_extract(data, '$.list') = ?`).get(LINKS, list)) {
        const linkId = db.prepare(`INSERT INTO cms_items (collection, key, data, is_active, position, created_at, updated_at)
          VALUES (?, ?, ?, 1, (SELECT COALESCE(MAX(position), -1) + 1 FROM cms_items WHERE collection = ? AND json_extract(data, '$.list') = ?), ?, ?)`)
          .run(LINKS, `${list}-${slug}`, JSON.stringify({ list, parent: null, kind: 'page', page: slug }), LINKS, list, now, now).lastInsertRowid;
        const lt = JSON.stringify({ label: title });
        db.prepare(`INSERT INTO cms_item_i18n (item_id, lang, slug, data, status, source_hash, updated_at, updated_by) VALUES (?, ?, NULL, ?, 'ready', ?, ?, ?)`)
          .run(linkId, def, lt, sha(lt), now, req.user.id);
      }
      return itemId;
    })();
    audit(db, req, 'create', 'item', id, { after: req.body });
    return reply.code(201).send({ id, key: slug });
  });

  /** Masquer / afficher une carte : sa page, son contenu et les liens qui mènent à elle. */
  app.patch('/menus/:key', {
    preHandler: guard('content'),
    schema: { body: { type: 'object', required: ['is_active'], additionalProperties: false, properties: { is_active: { type: 'boolean' } } } },
  }, async (req) => {
    assertUnscoped(req);
    const item = db.prepare('SELECT * FROM cms_items WHERE collection = ? AND key = ?').get(MENUS, req.params.key);
    if (!item) throw notFound('Carte');
    const active = req.body.is_active ? 1 : 0;
    const now = nowIso();
    db.transaction(() => {
      db.prepare('UPDATE cms_items SET is_active = ?, updated_at = ? WHERE id = ?').run(active, now, item.id);
      db.prepare('UPDATE cms_pages SET is_active = ?, updated_at = ? WHERE key = ?').run(active, now, item.key);
      db.prepare(`UPDATE cms_items SET is_active = ?, updated_at = ? WHERE collection = ? AND json_extract(data, '$.kind') = 'page' AND json_extract(data, '$.page') = ?`)
        .run(active, now, LINKS, item.key);
    })();
    audit(db, req, active ? 'update' : 'deactivate', 'item', item.id, { after: req.body });
    return { ok: true };
  });
}
