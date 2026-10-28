-- 008 — chambres de la page Chambres et du carrousel de l'accueil construites depuis les fiches.
-- Nouveaux champs traduits : résumé et titre des cartes (rooms), libellé court des pictogrammes (amenities).
-- Les cartes écrites dans les gabarits sont reprises au démarrage (server/ssg/room-cards.js, ensureRoomCards).

UPDATE cms_collections SET schema = json_set(schema, '$.translatable', json('["name","shortName","category","h1","title","metaDescription","facts[]","description","amenitiesFull[]","gallery[].kind","gallery[].alt","variants[].title","variants[].text","indexName","summary","cardTitle","cardFacts[].text"]'))
WHERE key = 'rooms';
UPDATE cms_collections SET schema = json_set(schema, '$.translatable', json('["label","shortLabel"]'))
WHERE key = 'amenities';
