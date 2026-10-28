-- 012 — dégradé du bandeau photo d'une page (module CSS hero-veil), réglé dans l'onglet Réglages :
-- {"on": true|false, "opacity": 0.1–0.9, "width": 20–100}. NULL : réglage du gabarit (data-cms-hero).

ALTER TABLE cms_pages ADD COLUMN hero_veil TEXT;
