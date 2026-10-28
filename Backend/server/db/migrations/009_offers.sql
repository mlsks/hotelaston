-- 009 — offres en fiches (page Offres et aperçus de l'accueil). Les offres des gabarits sont
-- reprises au démarrage, traductions comprises (server/ssg/offer-cards.js, ensureOffers).

INSERT OR IGNORE INTO cms_collections (key, label, item_template, parent_page, schema)
VALUES ('offers', 'Offres', NULL, NULL, '{"translatable":["tag","title","alt","price","priceNote","includes[]","saving","conditions","button","teaserTitle","teaserText"]}');
