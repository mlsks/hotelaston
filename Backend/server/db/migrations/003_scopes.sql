-- 003 — périmètres : un éditeur peut être limité à une partie du site (ex. « live-music »).
-- Programme Live Music : nouvelle collection « gigs » (date, heure, lieu, artiste, style, description).

ALTER TABLE sys_users ADD COLUMN scopes TEXT;          -- JSON ["live-music"] ; NULL = pas de limite
ALTER TABLE cms_banners ADD COLUMN scope TEXT;         -- bandeau modifiable par un éditeur de ce périmètre

INSERT OR IGNORE INTO cms_collections (key, label, item_template, parent_page, schema)
VALUES ('gigs', 'Programme Live Music', NULL, NULL, '{"translatable":["artist","style","description"]}');

UPDATE cms_banners SET scope = 'live-music' WHERE cta_target = 'page:live-music';
