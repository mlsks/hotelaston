-- 010 — blocs des pages (onglet « Blocs ») : ordre, visibilité et copies des sections et lignes
-- marquées data-cms-block dans les gabarits (server/ssg/page-blocks.js).

CREATE TABLE cms_page_blocks (
  id          INTEGER PRIMARY KEY,
  page_id     INTEGER NOT NULL REFERENCES cms_pages(id) ON DELETE CASCADE,
  zone        TEXT NOT NULL,                 -- data-cms-blocks (suffixé « ~id » dans une copie)
  block       TEXT NOT NULL,                 -- data-cms-block, ou « <original>~<id> » pour une copie
  copy_of     TEXT,                          -- copie : id du bloc d'origine dans le gabarit
  is_active   INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (page_id, zone, block)
);
