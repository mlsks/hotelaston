-- 014 — avis Google : une ligne par avis, calquée sur l'API Google Business Profile
-- (accounts.locations.reviews), alimentée à la main (ajout, import JSON) en attendant la
-- synchronisation par l'API. Le site n'affiche que les avis visibles notés 4 ou 5 étoiles.
-- Tables cms_* : elles partent dans le snapshot de chaque publication.

CREATE TABLE cms_google_reviews (
  review_id        TEXT PRIMARY KEY,               -- reviewId de Google ; « local-… » pour un avis saisi à la main
  author_name      TEXT NOT NULL DEFAULT '',       -- reviewer.displayName
  author_photo_url TEXT,                           -- reviewer.profilePhotoUrl
  rating           INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5), -- starRating (ONE … FIVE)
  comment          TEXT NOT NULL DEFAULT '',       -- comment (vide : note sans texte)
  published_at     TEXT NOT NULL,                  -- createTime (ISO 8601)
  review_url       TEXT,                           -- lien de l'avis sur Google Maps (sinon : la fiche)
  is_visible       INTEGER NOT NULL DEFAULT 1,     -- masqué dans l'admin : jamais affiché
  reply_comment    TEXT,                           -- reviewReply.comment
  reply_at         TEXT,                           -- reviewReply.updateTime
  topics           TEXT NOT NULL DEFAULT '[]',     -- thèmes du site (filtres de la page Avis), propres au site
  room             TEXT,                           -- chambre concernée (fiche chambre), propre au site
  origin           TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'import', 'api', 'sample')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_google_reviews_published ON cms_google_reviews (published_at DESC);

-- Fiche Google de l'hôtel : vraie note globale et nombre total d'avis (averageRating, totalReviewCount)
CREATE TABLE cms_google_place (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  rating       REAL,                               -- note moyenne de tous les avis (vide : pas affichée)
  review_count INTEGER,
  maps_url     TEXT,                               -- fiche sur Google Maps
  synced_at    TEXT,                               -- dernière synchronisation par l'API
  updated_at   TEXT NOT NULL
);
