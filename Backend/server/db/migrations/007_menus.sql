-- 007 — cartes du restaurant et des bars en pages modifiables : rubriques, plats, prix, traductions.
-- Les cartes écrites dans les gabarits (Moon Bar, tapas) sont reprises au démarrage
-- (server/ssg/menus.js, ensureMenus) et leurs pages passent au gabarit commun pages/carte.html.

INSERT OR IGNORE INTO cms_collections (key, label, item_template, parent_page, schema)
VALUES ('menus', 'Cartes du restaurant et des bars', NULL, NULL,
  '{"translatable":["title","subtitle","backLabel","note","sections[].title","sections[].dishes[].name","sections[].dishes[].desc"]}');
