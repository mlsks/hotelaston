-- 015 — blog : articles en fiches, une page par article sous la page Blog. Les trois articles du
-- gabarit et l'entrée « Blog » des menus sont repris au démarrage (server/ssg/posts.js).

INSERT OR IGNORE INTO cms_collections (key, label, item_template, parent_page, schema)
VALUES ('posts', 'Blog (articles)', 'items/article.html', (SELECT id FROM cms_pages WHERE key = 'blog'),
  '{"translatable":["category","title","summary","body","alt","seoTitle","metaDescription"]}');
