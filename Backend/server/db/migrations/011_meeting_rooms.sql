-- 011 — salles de séminaire en fiches (tableau des capacités de la page Séminaires et liste du
-- formulaire de devis). Les salles du gabarit sont reprises au démarrage, traductions comprises
-- (server/ssg/meeting-rooms.js, ensureMeetingRooms).

INSERT OR IGNORE INTO cms_collections (key, label, item_template, parent_page, schema)
VALUES ('meeting_rooms', 'Salles de séminaire', NULL, NULL, '{"translatable":["name","detail"]}');
