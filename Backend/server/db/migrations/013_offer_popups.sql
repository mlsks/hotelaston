-- 013 — popup d'une offre (bouton « Promouvoir en popup » de la fiche) : titre, texte, photo et
-- bouton repris de la fiche « offers » (le popup peut les remplacer), dates bornées par celles de
-- l'offre ; une offre masquée, supprimée ou expirée emporte son popup.

ALTER TABLE cms_popups ADD COLUMN offer_key TEXT;
