-- 002 — données de départ : langues et zones de bandeaux.
-- Français par défaut ; anglais actif (ses pages ne sont publiées qu'une fois traduites) ;
-- italien et allemand prêts à être activés.

INSERT INTO cms_languages (code, name, native_name, locale, booking_lang, is_default, is_active, position) VALUES
  ('fr', 'Français', 'Français', 'fr-FR', 'fr', 1, 1, 0),
  ('en', 'Anglais',  'English',  'en-GB', 'en', 0, 1, 1),
  ('it', 'Italien',  'Italiano', 'it-IT', 'it', 0, 0, 2),
  ('de', 'Allemand', 'Deutsch',  'de-DE', 'de', 0, 0, 3);

INSERT INTO cms_zones (key, label, description, max_banners) VALUES
  ('top-bar',              'Bandeau du haut',       'Fine ligne au-dessus de l''en-tête, refermable', 1),
  ('hero-sub',             'Sous le module du Hero', 'Sous le module de réservation de l''accueil',   1),
  ('section-intercalaire', 'Entre deux sections',    'Emplacements marqués data-cms-zone dans les gabarits', 2),
  ('footer-cta',           'Avant le pied de page',  'Appel à l''action en bas de chaque page',        1);
