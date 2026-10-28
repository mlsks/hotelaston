-- 006 — menus et listes de liens modifiables (menu principal, menu mobile, pied de page, cartes du
-- restaurant et du bar). Les liens des gabarits sont repris au démarrage, traductions comprises
-- (server/ssg/link-lists.js, ensureLinkLists).

INSERT OR IGNORE INTO cms_collections (key, label, item_template, parent_page, schema)
VALUES ('links', 'Menus et liens', NULL, NULL, '{"translatable":["label"]}');
