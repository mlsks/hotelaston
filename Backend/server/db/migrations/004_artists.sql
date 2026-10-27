-- 004 — fiches artistes du Live Music (nom, style, présentation, site internet, photo de la médiathèque).
-- Un concert désigne désormais son artiste par la clé de sa fiche : le nom saisi librement est
-- converti en fiche au démarrage (server/db/gig-artists.js, migrateGigArtists).

INSERT OR IGNORE INTO cms_collections (key, label, item_template, parent_page, schema)
VALUES ('artists', 'Artistes (Live Music)', NULL, NULL, '{"translatable":["style","bio"]}');

UPDATE cms_collections SET schema = '{"translatable":["style","description"]}' WHERE key = 'gigs';
