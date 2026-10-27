-- 001 — schéma initial (repris de ARCHITECTURE.md § 3).
-- Les PRAGMA (WAL, clés étrangères…) sont posés à l'ouverture de la connexion.

CREATE TABLE cms_languages (
  code         TEXT PRIMARY KEY,                 -- 'fr', 'en', 'it', 'de'
  name         TEXT NOT NULL,                    -- 'Anglais' (libellé admin)
  native_name  TEXT NOT NULL,                    -- 'English' (sélecteur de langue)
  locale       TEXT NOT NULL,                    -- 'en-GB' (dates, Intl)
  booking_lang TEXT NOT NULL,                    -- segment de langue du moteur D-Edge
  is_default   INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 0,       -- publiée en production
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE cms_settings (
  key        TEXT PRIMARY KEY,                   -- 'site_url', 'booking_engine', 'hotel', 'x_default_lang'…
  value      TEXT NOT NULL,                      -- JSON
  updated_at TEXT NOT NULL
);

CREATE TABLE cms_redirects (                     -- anciennes adresses de hotel-aston.com → nouvelles pages
  id        INTEGER PRIMARY KEY,
  from_path TEXT NOT NULL UNIQUE,
  to_page   INTEGER REFERENCES cms_pages(id) ON DELETE CASCADE,
  to_lang   TEXT REFERENCES cms_languages(code),
  to_url    TEXT,
  code      INTEGER NOT NULL DEFAULT 301 CHECK (code IN (301, 302))
);

CREATE TABLE cms_pages (
  id           INTEGER PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE,             -- 'chambres', 'restaurant-horloge'
  template     TEXT NOT NULL,                    -- 'pages/chambres.html'
  parent_id    INTEGER REFERENCES cms_pages(id), -- fil d'Ariane et chemin
  in_sitemap   INTEGER NOT NULL DEFAULT 1,
  priority     REAL,                             -- sitemap
  is_active    INTEGER NOT NULL DEFAULT 1,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE cms_page_i18n (
  page_id          INTEGER NOT NULL REFERENCES cms_pages(id) ON DELETE CASCADE,
  lang             TEXT NOT NULL REFERENCES cms_languages(code),
  slug             TEXT NOT NULL,                -- 'rooms'
  path             TEXT NOT NULL,                -- '/en/rooms/' (calculé avec les parents)
  nav_label        TEXT,
  title            TEXT,                         -- <title>
  meta_description TEXT,
  og_title         TEXT,
  og_description   TEXT,
  og_image_id      INTEGER REFERENCES cms_media(id),
  focus_keyword    TEXT,                         -- requête visée : contrôles title / H1 / description / alt
  noindex          INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready')),
  source_hash      TEXT,
  updated_at       TEXT NOT NULL,
  updated_by       INTEGER,
  PRIMARY KEY (page_id, lang),
  UNIQUE (lang, path)
);

CREATE TABLE cms_entries (                       -- une entrée = une clé data-cms-*
  id           INTEGER PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE,             -- 'accueil.hero.titre'
  page_id      INTEGER REFERENCES cms_pages(id) ON DELETE CASCADE,  -- NULL = global (en-tête, pied, interface JS)
  section      TEXT,                             -- regroupement dans l'admin : 'Hero', 'Points forts'
  type         TEXT NOT NULL CHECK (type IN ('text', 'richtext', 'url', 'email', 'phone', 'media', 'number', 'boolean')),
  label        TEXT NOT NULL,
  help         TEXT,
  max_length   INTEGER,                          -- ex. 60 pour un titre
  translatable INTEGER NOT NULL DEFAULT 1,
  required     INTEGER NOT NULL DEFAULT 1,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE cms_entry_values (
  entry_id    INTEGER NOT NULL REFERENCES cms_entries(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL REFERENCES cms_languages(code),
  value       TEXT,
  media_id    INTEGER REFERENCES cms_media(id),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready')),
  source_hash TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  INTEGER,
  PRIMARY KEY (entry_id, lang)
);

CREATE TABLE cms_collections (
  key           TEXT PRIMARY KEY,                -- 'rooms', 'offers', 'services', 'faq', 'reviews', 'chat'…
  label         TEXT NOT NULL,
  item_template TEXT,                            -- 'items/chambre.html' si chaque élément a sa page
  parent_page   INTEGER REFERENCES cms_pages(id),-- page parente des fiches (chemin, fil d'Ariane)
  schema        TEXT NOT NULL                    -- JSON : [{ "name", "type", "translatable", "required", "max" }]
);

CREATE TABLE cms_items (
  id          INTEGER PRIMARY KEY,
  collection  TEXT NOT NULL REFERENCES cms_collections(key),
  key         TEXT NOT NULL,                     -- identifiant stable : 'confort', 'escapade-gourmande'
  data        TEXT NOT NULL DEFAULT '{}',        -- JSON des champs non traduits (surface, capacité, code D-Edge, prix)
  is_active   INTEGER NOT NULL DEFAULT 1,
  start_at    TEXT,                              -- offres datées
  end_at      TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (collection, key)
);

CREATE TABLE cms_item_i18n (
  item_id     INTEGER NOT NULL REFERENCES cms_items(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL REFERENCES cms_languages(code),
  slug        TEXT,                              -- si l'élément a sa propre page
  data        TEXT NOT NULL DEFAULT '{}',        -- JSON des champs traduits (nom, description, title, meta…)
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready')),
  source_hash TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  INTEGER,
  PRIMARY KEY (item_id, lang)
);

CREATE TABLE cms_item_media (
  item_id  INTEGER NOT NULL REFERENCES cms_items(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES cms_media(id),
  role     TEXT NOT NULL DEFAULT 'gallery',      -- 'cover', 'gallery', 'video'
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, media_id, role)
);

CREATE TABLE cms_media (
  id             INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'embed')),
  folder         TEXT NOT NULL DEFAULT '/',
  original_name  TEXT,
  storage_key    TEXT UNIQUE,                    -- chemin de l'original dans storage/uploads/
  mime           TEXT,
  bytes          INTEGER,
  sha256         TEXT UNIQUE,                    -- évite les doublons
  width          INTEGER,
  height         INTEGER,
  duration_s     REAL,
  focal_x        REAL NOT NULL DEFAULT 0.5,      -- point d'intérêt : recadrage portrait, object-position
  focal_y        REAL NOT NULL DEFAULT 0.5,
  poster_id      INTEGER REFERENCES cms_media(id),
  embed_url      TEXT,
  embed_provider TEXT,                           -- 'youtube', 'vimeo', 'spotify', 'soundcloud', 'other'
  credit         TEXT,
  status         TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'error')),
  error          TEXT,
  deleted_at     TEXT,                           -- suppression douce : les snapshots peuvent encore l'utiliser
  created_at     TEXT NOT NULL,
  created_by     INTEGER
);

CREATE TABLE cms_media_variants (
  id       INTEGER PRIMARY KEY,
  media_id INTEGER NOT NULL REFERENCES cms_media(id) ON DELETE CASCADE,
  purpose  TEXT NOT NULL,                        -- 'w640', 'w1024', 'w1600', 'w2400', 'portrait', 'thumb', 'poster'
  format   TEXT NOT NULL,                        -- 'webp', 'jpg', 'mp4', 'webm', 'mp3'
  width    INTEGER,
  height   INTEGER,
  bytes    INTEGER NOT NULL,
  path     TEXT NOT NULL UNIQUE,                 -- relatif à media/ (nom avec empreinte : immuable)
  UNIQUE (media_id, purpose, format)
);

CREATE TABLE cms_media_i18n (
  media_id INTEGER NOT NULL REFERENCES cms_media(id) ON DELETE CASCADE,
  lang     TEXT NOT NULL REFERENCES cms_languages(code),
  alt      TEXT,
  title    TEXT,
  caption  TEXT,
  status   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready')),
  PRIMARY KEY (media_id, lang)
);

CREATE TABLE cms_zones (
  key         TEXT PRIMARY KEY,                  -- 'top-bar', 'hero-sub', 'section-intercalaire', 'footer-cta'
  label       TEXT NOT NULL,
  description TEXT,
  max_banners INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE cms_banners (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,                     -- nom interne, sert aussi aux statistiques
  variant     TEXT NOT NULL DEFAULT 'info' CHECK (variant IN ('info', 'promo', 'evenement', 'alerte')),
  bg_color    TEXT,                              -- surcharge facultative des couleurs du variant
  text_color  TEXT,
  icon        TEXT,                              -- id du sprite SVG
  cta_kind    TEXT NOT NULL DEFAULT 'none' CHECK (cta_kind IN ('none', 'page', 'item', 'url', 'booking')),
  cta_target  TEXT,                              -- 'page:live-music', 'offer:escapade', URL…
  dismissible INTEGER NOT NULL DEFAULT 1,
  priority    INTEGER NOT NULL DEFAULT 0,
  start_at    TEXT,
  end_at      TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE cms_banner_i18n (
  banner_id   INTEGER NOT NULL REFERENCES cms_banners(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL REFERENCES cms_languages(code),
  text        TEXT NOT NULL,
  cta_label   TEXT,
  cta_url     TEXT,                              -- surcharge par langue (lien externe)
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready')),
  source_hash TEXT,
  PRIMARY KEY (banner_id, lang)
);

CREATE TABLE cms_banner_placements (
  id        INTEGER PRIMARY KEY,
  banner_id INTEGER NOT NULL REFERENCES cms_banners(id) ON DELETE CASCADE,
  zone      TEXT NOT NULL REFERENCES cms_zones(key),
  page_id   INTEGER REFERENCES cms_pages(id) ON DELETE CASCADE,   -- NULL = toutes les pages
  UNIQUE (banner_id, zone, page_id)
);

CREATE TABLE cms_popups (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  is_active      INTEGER NOT NULL DEFAULT 0,     -- interrupteur global
  start_at       TEXT,
  end_at         TEXT,
  media_id       INTEGER REFERENCES cms_media(id),
  trigger_type   TEXT NOT NULL DEFAULT 'delay' CHECK (trigger_type IN ('delay', 'scroll', 'exit_intent')),
  trigger_value  INTEGER,                        -- secondes ou pourcentage de défilement
  mobile_trigger TEXT NOT NULL DEFAULT 'scroll' CHECK (mobile_trigger IN ('delay', 'scroll', 'none')),
  frequency      TEXT NOT NULL DEFAULT 'days' CHECK (frequency IN ('once', 'session', 'days')),
  frequency_days INTEGER DEFAULT 7,
  version        INTEGER NOT NULL DEFAULT 1,     -- +1 = réafficher aux visiteurs qui l'ont fermé
  priority       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE cms_popup_i18n (
  popup_id    INTEGER NOT NULL REFERENCES cms_popups(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL REFERENCES cms_languages(code),
  title       TEXT NOT NULL,
  body        TEXT,                              -- texte riche nettoyé
  cta_label   TEXT,
  cta_kind    TEXT CHECK (cta_kind IN ('page', 'item', 'url', 'booking')),
  cta_target  TEXT,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready')),
  source_hash TEXT,
  PRIMARY KEY (popup_id, lang)
);

CREATE TABLE cms_popup_pages (
  popup_id INTEGER NOT NULL REFERENCES cms_popups(id) ON DELETE CASCADE,
  page_id  INTEGER REFERENCES cms_pages(id) ON DELETE CASCADE,    -- NULL = toutes les pages
  mode     TEXT NOT NULL DEFAULT 'include' CHECK (mode IN ('include', 'exclude')),
  UNIQUE (popup_id, page_id)
);

CREATE TABLE sys_users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,                   -- argon2id
  role          TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'translator')),
  langs         TEXT,                            -- JSON ['en','it'] : langues qu'un traducteur peut modifier
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sys_sessions (
  id         TEXT PRIMARY KEY,                   -- 32 octets aléatoires
  user_id    INTEGER NOT NULL REFERENCES sys_users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE sys_builds (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('preview', 'production', 'rollback')),
  triggered_by  TEXT NOT NULL CHECK (triggered_by IN ('manual', 'cron', 'rollback')),
  status        TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed', 'skipped')),
  user_id       INTEGER REFERENCES sys_users(id),
  snapshot_path TEXT,                            -- storage/snapshots/cms-<id>.sqlite
  release_path  TEXT,                            -- releases/<id>/
  output_hash   TEXT,                            -- empreinte du site généré (cron : rien de neuf → 'skipped')
  pages_count   INTEGER,
  langs         TEXT,                            -- JSON des langues publiées
  warnings      TEXT,                            -- JSON
  error         TEXT,
  is_current    INTEGER NOT NULL DEFAULT 0,      -- version servie actuellement
  started_at    TEXT,
  finished_at   TEXT
);

CREATE TABLE sys_audit_log (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,
  user_id   INTEGER REFERENCES sys_users(id),
  action    TEXT NOT NULL,                       -- 'update', 'delete', 'publish', 'rollback', 'login'…
  entity    TEXT NOT NULL,                       -- 'entry', 'item', 'banner'…
  entity_id TEXT,
  lang      TEXT,
  data_before TEXT,                              -- JSON
  data_after  TEXT                               -- JSON
);

CREATE TABLE sys_page_state (                    -- mémoire du sitemap (production) : lastmod fiable
  lang          TEXT NOT NULL,
  path          TEXT NOT NULL,
  content_hash  TEXT NOT NULL,                   -- empreinte du contenu principal (hors bandeaux, popup, n° de build)
  lastmod       TEXT NOT NULL,                   -- ne change que si content_hash change
  first_seen_at TEXT NOT NULL,
  PRIMARY KEY (lang, path)
);

CREATE TABLE an_salts (                          -- sel du jour, supprimé le surlendemain
  day  TEXT PRIMARY KEY,                         -- 'YYYY-MM-DD' (heure de Paris)
  salt BLOB NOT NULL
);

CREATE TABLE an_visits (                         -- une ligne par visite, mise à jour à chaque lot d'événements
  visit          TEXT PRIMARY KEY,               -- visiteur + tranche d'inactivité de 30 min
  visitor        TEXT NOT NULL,                  -- empreinte du jour, jamais l'IP
  returning_id   TEXT,                           -- niveau 2 seulement : identifiant aléatoire de 13 mois
  day            TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  ended_at       TEXT NOT NULL,
  pages          INTEGER NOT NULL DEFAULT 0,
  engaged_ms     INTEGER NOT NULL DEFAULT 0,
  entry_path     TEXT,
  exit_path      TEXT,
  lang           TEXT,                           -- langue de la page d'entrée
  browser_lang   TEXT,                           -- langue du navigateur (2 lettres)
  country        TEXT,                           -- code ISO, depuis la base GeoIP locale
  region         TEXT,                           -- jamais plus précis que la région
  device         TEXT CHECK (device IN ('mobile', 'tablet', 'desktop')),
  channel        TEXT,                           -- 'organic', 'paid', 'ai', 'social', 'email', 'metasearch', 'referral', 'direct'
  referrer       TEXT,                           -- domaine seulement
  utm_source     TEXT,
  utm_medium     TEXT,
  utm_campaign   TEXT,
  utm_content    TEXT,
  searches       INTEGER NOT NULL DEFAULT 0,     -- recherches de disponibilités
  booking_clicks INTEGER NOT NULL DEFAULT 0,
  contacts       INTEGER NOT NULL DEFAULT 0,     -- téléphone, e-mail, devis
  is_engaged     INTEGER NOT NULL DEFAULT 0      -- > 10 s actives, ou 2 pages, ou une action
);
CREATE INDEX an_visits_day     ON an_visits (day);
CREATE INDEX an_visits_channel ON an_visits (day, channel);
CREATE INDEX an_visits_country ON an_visits (day, country);

CREATE TABLE an_events (
  id           INTEGER PRIMARY KEY,
  ts           TEXT NOT NULL,                    -- horodatage serveur UTC
  day          TEXT NOT NULL,                    -- jour (heure de Paris)
  type         TEXT NOT NULL CHECK (type IN (
                 'pageview', 'engagement', 'booking_search', 'booking_click',
                 'banner_view', 'banner_click', 'popup_view', 'popup_click', 'popup_close',
                 'phone_click', 'email_click', 'quote_submit', 'chat_question',
                 'lang_switch', 'video_play', 'map_open', 'outbound', 'not_found', 'web_vital')),
  visit        TEXT NOT NULL,                    -- → an_visits.visit
  lang         TEXT,
  path         TEXT,                             -- page, sans paramètres
  template     TEXT,                             -- type de page : 'chambre', 'offre', 'article'…
  source       TEXT,                             -- 'cta_header', 'cta_hero', 'banner:12', 'popup:3', 'room:confort'…
  via          TEXT,                             -- dernier bandeau / popup cliqué pendant la visite (attribution)
  element_kind TEXT,                             -- 'banner', 'popup', 'cta', 'room', 'offer'
  element_id   TEXT,
  arrival      TEXT,                             -- recherche de dates : arrivée demandée
  nights       INTEGER,
  adults       INTEGER,
  children     INTEGER,
  lead_days    INTEGER,                          -- jours entre la recherche et l'arrivée
  room_type    TEXT,
  offer_id     TEXT,
  engaged_ms   INTEGER,                          -- temps de lecture actif sur la page
  scroll_pct   INTEGER,                          -- défilement maximal
  metric       TEXT,                             -- Core Web Vitals : 'LCP', 'INP', 'CLS', 'TTFB'
  value        REAL,
  props        TEXT                              -- JSON des autres détails (réponse du chat, langue choisie…)
);
CREATE INDEX an_events_day_type ON an_events (day, type);
CREATE INDEX an_events_source   ON an_events (type, source, day);
CREATE INDEX an_events_visit    ON an_events (visit);
CREATE INDEX an_events_arrival  ON an_events (type, arrival);

CREATE TABLE an_daily (                          -- agrégats calculés chaque nuit
  day    TEXT NOT NULL,
  metric TEXT NOT NULL,                          -- 'visitors', 'visits', 'engaged_visits', 'pageviews', 'searches', 'booking_clicks'…
  dim    TEXT NOT NULL DEFAULT '',               -- '' = total ; 'lang:en', 'country:IT', 'channel:ai', 'banner:12', 'page:/fr/chambres/'…
  value  REAL NOT NULL,
  PRIMARY KEY (day, metric, dim)
);

CREATE TABLE an_search_console (                 -- option : import quotidien de la Search Console
  day         TEXT NOT NULL,
  page        TEXT NOT NULL,
  query       TEXT NOT NULL,
  country     TEXT NOT NULL,
  device      TEXT NOT NULL,
  clicks      INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  position    REAL NOT NULL,
  PRIMARY KEY (day, page, query, country, device)
);

CREATE TABLE an_bookings (                       -- option : réservations confirmées importées de D-Edge
  id           INTEGER PRIMARY KEY,
  booked_at    TEXT NOT NULL,
  day          TEXT NOT NULL,
  arrival      TEXT NOT NULL,
  nights       INTEGER NOT NULL,
  adults       INTEGER,
  children     INTEGER,
  room_type    TEXT,
  rate_code    TEXT,
  revenue      REAL,                             -- montant TTC
  currency     TEXT NOT NULL DEFAULT 'EUR',
  booking_lang TEXT,
  country      TEXT,
  channel      TEXT,                             -- canal déclaré par le moteur
  visit        TEXT,                             -- si D-Edge renvoie l'identifiant de visite (à vérifier)
  external_ref TEXT UNIQUE                       -- empreinte du n° de réservation, jamais le nom du client
);
