# Back-office Aston La Scala — CMS, générateur statique et analytics

**Architecture et modèle de données.**
Statut : validée.
- Réalisé : briques 1 à 4, ainsi que l'éditeur limité au Live Music (voir [README.md](README.md)).
- À faire : fichiers de déploiement.

Le site public reste 100 % statique. Un serveur Node.js unique (Fastify + SQLite) sert le back-office et l'API, génère le site avec Cheerio, et reçoit les mesures d'audience. Caddy sert les fichiers statiques et redirige `/api`, `/admin` et `/preview` vers Node.

---

## 0. Choix structurants à valider

| # | Choix proposé | Pourquoi |
|---|---|---|
| A | Tout le projet vit dans `hotelaston/Backend/`. Le code Node est dans `server/` (et non `backend/`, pour éviter `Backend/backend/`). | Le site actuel (`hotelaston/index.html`…) reste intact et sert de source à l'import initial. |
| B | Les gabarits sont créés **une fois** à partir de `index.html` par un script d'import : un `layout.html` commun + une page par vue. | Le site actuel tient dans un seul fichier avec des adresses en `#/`. Google ne les indexe pas, et le multilingue exige une vraie page par vue et par langue. |
| C | Brouillon et production séparés par un **snapshot** des tables de contenu, pris à chaque « Publier ». Les builds de production (manuels, cron, rollback) lisent toujours un snapshot, jamais les brouillons. | Le cron de minuit ne doit pas publier des modifications non relues. |
| D | Rollback par **lien symbolique** : `public-dist` pointe vers l'une des 3 dernières versions dans `releases/`. Restaurer = changer le lien. | Instantané (une opération atomique), sans régénération. |
| E | Analytics sans cookie : identifiant visiteur = empreinte quotidienne (sel du jour + IP + navigateur), sel détruit le lendemain, IP jamais stockée. | Mesure d'audience exemptée de consentement si les conditions de la CNIL sont respectées (voir § 8). |
| F | Un seul processus Node (PM2 en mode `fork`, pas `cluster`). | `better-sqlite3` est synchrone et le verrou de build, la file d'écriture analytics et le cron vivent en mémoire. Largement suffisant pour un hôtel. |
| G | `ffmpeg` / `ffprobe` installés sur le VPS (paquet système gratuit) pour lire la durée des vidéos et extraire leur image `poster`. | `sharp` ne traite que les images. Sans ffmpeg, le poster doit être téléversé à la main. |
| H | Le `sitemap.xml` est régénéré à chaque build de production. La date `lastmod` d'une adresse ne change que si le contenu de la page a réellement changé. Les adresses ajoutées ou modifiées sont signalées par IndexNow à chaque publication. | Google relit le sitemap de lui-même et ignore un `lastmod` qui change toutes les nuits sans raison (§ 7.2). |
| I | Statistiques en trois niveaux : 1) mesure enrichie sans consentement (pays, canal dont les assistants IA, engagement, recherches de dates, entonnoir, Core Web Vitals) ; 2) en option, visiteurs récurrents ; 3) en option, réservations confirmées importées de D-Edge et données de la Search Console. | Le niveau 1 mesure tous les visiteurs sans bandeau cookies ; les niveaux 2 et 3 apportent la valeur commerciale (§ 8). |

---

## 1. Arborescence

```
hotelaston/
├── index.html, styles.css, …      ← site actuel, inchangé (source de l'import)
└── Backend/
    ├── ARCHITECTURE.md             ← ce document
    ├── package.json
    ├── .env.example                ← PORT, SITE_URL, SESSION_SECRET, TZ=Europe/Paris…
    │
    ├── server/                     ← Node.js 24 LTS + Fastify
    │   ├── index.js                ← démarrage, plugins, routes, cron
    │   ├── config.js
    │   ├── db/
    │   │   ├── connection.js       ← better-sqlite3, PRAGMA, requêtes préparées
    │   │   ├── migrations/         ← 001_init.sql, 002_….sql (numérotées, appliquées au démarrage)
    │   │   └── import-legacy.js    ← découpe index.html en gabarits + remplit la base (FR)
    │   ├── auth/                   ← sessions, mots de passe (argon2id), rôles, CSRF
    │   ├── routes/                 ← un fichier par module de l'API (§ 9)
    │   ├── media/
    │   │   ├── pipeline.js         ← sharp : WebP + tailles adaptatives ; ffprobe/ffmpeg : durée, poster
    │   │   └── gc.js               ← suppression des fichiers orphelins (hors snapshots conservés)
    │   ├── ssg/
    │   │   ├── build.js            ← orchestration d'un build (§ 5)
    │   │   ├── snapshot.js         ← copie des tables cms_* dans storage/snapshots/
    │   │   ├── compose.js          ← layout + page + partials (Cheerio)
    │   │   ├── inject/             ← content.js, media.js, lists.js, links.js, booking.js,
    │   │   │                          seo.js, jsonld.js, banners.js, popup.js, i18n-js.js
    │   │   ├── validate.js         ← règles bloquantes / avertissements
    │   │   ├── sitemap.js          ← sitemap.xml multilingue (lastmod fiable, images), robots.txt, redirections, IndexNow
    │   │   ├── seo-checks.js       ← contrôles SEO par page et par langue (mot-clé, longueurs, doublons, H1)
    │   │   └── release.js          ← releases/, lien symbolique, rollback, nettoyage
    │   ├── cron/nightly.js         ← build de minuit, agrégats analytics, purge, sauvegarde
    │   └── analytics/
    │       ├── ingest.js           ← validation, anti-robots, file d'attente, insertion par lots
    │       ├── geoip.js            ← pays et région depuis une base locale, IP jamais stockée
    │       ├── channels.js         ← classement des sources (recherche, IA, réseaux, e-mail…)
    │       ├── aggregate.js        ← visites et agrégats quotidiens
    │       ├── imports.js          ← réservations D-Edge, Search Console (options)
    │       └── queries.js          ← requêtes du tableau de bord
    │
    ├── admin/                      ← back-office monopage, sans build
    │   ├── index.html              ← Tailwind, Alpine.js, Chart.js : versions figées, servis depuis node_modules
    │   ├── app.js
    │   ├── lib/                    ← appels API, état partagé, routeur, éditeur de texte riche, champs des collections
    │   └── views/                  ← un fragment HTML par écran + son composant Alpine (views/parts/ : morceaux partagés)
    │
    ├── templates-src/              ← sources HTML du site, annotées data-cms-*
    │   ├── layout.html             ← <head>, en-tête, menus, pied de page, chat, sprite SVG
    │   ├── partials/               ← header.html, mobile-menu.html, footer.html, booking-hero.html…
    │   ├── pages/                  ← accueil.html, chambres.html, restaurant-horloge.html, …
    │   ├── items/                  ← gabarits de fiche : chambre.html, service.html, article.html
    │   ├── components/             ← banner.html, popup.html
    │   └── assets/                 ← styles.css, remotion-vanilla.js, track.js, popup.js, sw.js, icônes
    │
    ├── storage/                    ← jamais servi directement
    │   ├── db/aston.sqlite         ← (+ -wal, -shm) contenu + analytics
    │   ├── snapshots/              ← cms-<buildId>.sqlite (3 derniers publiés)
    │   ├── uploads/                ← originaux téléversés
    │   ├── geoip/                  ← base pays / région DB-IP Lite (gratuite, mise à jour mensuelle)
    │   └── backups/                ← sauvegardes nocturnes de la base (7 jours)
    │
    ├── media/                      ← variantes optimisées, servies sous /media/ (communes à toutes les versions)
    ├── preview/                    ← build privé, servi sous /preview/ aux administrateurs connectés
    ├── releases/<buildId>/         ← 3 dernières versions de production
    ├── public-dist -> releases/<id> ← lien symbolique servi par Caddy
    │
    └── deploy/
        ├── Caddyfile
        ├── ecosystem.config.cjs    ← PM2
        ├── Dockerfile              ← alternative à PM2
        └── backup.sh
```

**Dépendances npm prévues** : `fastify`, `@fastify/static`, `@fastify/multipart`, `@fastify/cookie`, `@fastify/rate-limit`, `better-sqlite3`, `cheerio`, `sharp`, `node-cron`, `@node-rs/argon2`, `sanitize-html`, `maxmind` (lecture de la base GeoIP locale). Côté site : `web-vitals` (bibliothèque de Google, environ 2 Ko). Les versions seront figées au moment du code.

---

## 2. Du site actuel aux gabarits

### 2.1 Import initial (une seule fois)
`server/db/import-legacy.js` lit `hotelaston/index.html` et :
1. sépare le **layout** (tout sauf les `<section class="view">`) des **pages** (une par vue) ;
2. remplace les textes par des clés `data-cms-key` et range les valeurs françaises dans la base ;
3. convertit les blocs JSON (`#data-rooms`, `#data-services`, avis, chat…) en **collections** ;
4. transforme les liens `#/chambres` en `data-cms-link="page:chambres"`.

Résultat attendu : le premier build de `/preview/fr/` doit être visuellement identique au site actuel. C'est le critère de réussite de la brique 1.

### 2.2 Convention d'annotation

| Attribut | Effet au build |
|---|---|
| `data-cms-key="accueil.hero.titre"` | Remplace le texte (échappé). |
| `data-cms-html="horloge.intro"` | Remplace le contenu par du texte riche **nettoyé** (liste blanche de balises). |
| `data-cms-attr="placeholder:booking.arrivee;aria-label:booking.label"` | Remplit des attributs. |
| `data-cms-media="accueil.hero.image" data-cms-sizes="100vw"` | Produit `<picture>`/`srcset` WebP depuis les variantes, `alt` et `title` dans la langue, `width`/`height`, point focal en `object-position`. |
| `data-cms-list="rooms"` + `<template data-cms-item>` | Répète le modèle pour chaque élément actif de la collection ; à l'intérieur, `data-cms-field="nom"`. |
| `data-cms-link="page:chambres"` / `"item:rooms/confort"` | Calcule l'adresse dans la langue (`/en/rooms/confort/`). |
| `data-cms-booking="room:confort"` / `"offer:escapade"` | Construit l'URL du moteur D-Edge dans la langue et ajoute le suivi (`data-track="booking"`, `data-track-source`). |
| `data-cms-zone="top-bar"` | Point d'insertion des bandeaux de cette zone. |

Tous les `data-cms-*` sont retirés du HTML final. Restent seulement les attributs utiles au navigateur (`data-start`, `data-end`, `data-track*`).

```html
<!-- templates-src/pages/accueil.html (extrait) -->
<h1 class="display" data-cms-key="accueil.hero.titre">Hôtel Aston La Scala, hôtel 4 étoiles au cœur de Nice</h1>
<div data-cms-zone="hero-sub"></div>
<a class="btn btn--primary" data-cms-booking="hero" data-cms-key="accueil.hero.cta">Réserver</a>
```

### 2.3 Ce qui change côté navigateur
- **Routeur** de `remotion-vanilla.js` : passage en mode « pages réelles ». Plus de `#/`, les vues ne sont plus masquées ; les modules (sliders, réservation, carte, chat…) restent identiques.
- **Textes écrits dans le JavaScript** (chat, programme Live Music, erreurs du module de réservation, formats de date) : sortis dans une collection « Interface », injectés dans chaque page en `<script type="application/json" id="i18n">`.
- **Service worker** : liste de pré-cache et version générées à chaque build.

---

## 3. Modèle de données (SQLite)

### 3.1 Conventions
- Un seul fichier `storage/db/aston.sqlite`.
- Préfixes : `cms_` = contenu (copié dans les snapshots), `sys_` = administration et builds, `an_` = analytics.
- Dates en texte ISO 8601 UTC. Les dates saisies dans l'admin sont en heure de Paris et converties.
- Les champs traduisibles vivent dans des tables `*_i18n` (une ligne par langue) avec un `status` et un `source_hash` (empreinte du texte français au moment de la traduction, pour repérer les traductions « à revoir »).

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

### 3.2 Langues et réglages

```sql
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
```

### 3.3 Pages et contenus

```sql
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

CREATE TABLE cms_page_blocks (                   -- blocs des pages (migration 010, server/ssg/page-blocks.js)
  id          INTEGER PRIMARY KEY,
  page_id     INTEGER NOT NULL REFERENCES cms_pages(id) ON DELETE CASCADE,
  zone        TEXT NOT NULL,                     -- data-cms-blocks du gabarit (suffixé « ~id » dans une copie)
  block       TEXT NOT NULL,                     -- data-cms-block, ou « <original>~<id> » pour une copie
  copy_of     TEXT,                              -- copie : bloc d'origine ; ses clés data-cms-* reçoivent le suffixe « ~id »
  is_active   INTEGER NOT NULL DEFAULT 1,        -- 0 = masqué
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (page_id, zone, block)
);
```

### 3.4 Collections (chambres, offres, services, FAQ, avis, cartes, articles, appartements, interface…)

Les champs de chaque collection sont décrits dans `cms_collections.schema` (JSON). L'admin génère ses formulaires à partir de ce schéma, ce qui évite une table par type de contenu.

```sql
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
```

### 3.5 Médias

```sql
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
```

### 3.6 Bandeaux

```sql
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
```

### 3.7 Popup

```sql
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
```

### 3.8 Administration et builds

```sql
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
```

### 3.9 Statistiques

```sql
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
```

### 3.10 Relations principales

```
cms_languages ─┬─< cms_page_i18n >── cms_pages ──< cms_entries ──< cms_entry_values
               ├─< cms_item_i18n >── cms_items >── cms_collections
               ├─< cms_media_i18n >─ cms_media ──< cms_media_variants
               ├─< cms_banner_i18n >─ cms_banners ──< cms_banner_placements >── cms_zones / cms_pages
               └─< cms_popup_i18n >── cms_popups ──< cms_popup_pages >── cms_pages
sys_users ──< sys_sessions, sys_builds, sys_audit_log
an_salts ; an_events ─► an_visits ─► an_daily (calcul nocturne) ; an_search_console, an_bookings (imports, options)
```

---

## 4. Brouillon, publication, snapshots

1. **Enregistrer** dans l'admin écrit dans la base (`cms_*`). Le site public ne bouge pas.
2. **Prévisualiser** génère le site à partir de la base courante (brouillons compris) dans `preview/`. Toutes les langues sont générées, même incomplètes, avec un bandeau « Prévisualisation » et les manques signalés.
3. **Publier** :
   - copie les tables `cms_*` dans `storage/snapshots/cms-<id>.sqlite` (cohérent grâce à une transaction de lecture) ;
   - génère la production **à partir de ce snapshot** ;
   - met en ligne (§ 5.3).
4. **Cron de minuit** : régénère la production à partir du **snapshot publié en cours**, avec la date du jour. Il active ou retire les bandeaux et popups programmés, sans jamais publier un brouillon.
5. **Restaurer la version précédente** : remet en ligne la version précédente (lien symbolique) et en fait le snapshot de référence pour les prochains crons. En option, « restaurer aussi le contenu » recopie ce snapshot dans la base de travail, après une sauvegarde automatique de l'état actuel.

L'admin signale « modifié depuis la dernière publication » en comparant `updated_at` à la date du snapshot en cours.

Les médias supprimés restent sur le disque tant qu'un des 3 snapshots conservés y fait référence. Le nettoyage nocturne efface ensuite les fichiers orphelins.

---

## 5. Flux du moteur de build

### 5.1 Déclencheurs

| Déclencheur | Source des données | Sortie | Date de référence |
|---|---|---|---|
| Prévisualiser | base courante | `preview/` | maintenant (ou date simulée choisie dans l'admin) |
| Publier | nouveau snapshot | `releases/<id>/` puis mise en ligne | maintenant |
| Cron 00:00 (Paris) | snapshot en cours | `releases/<id>/` si le résultat diffère | minuit |
| Restaurer | aucune génération | lien symbolique | — |

Un seul build à la fois (verrou en mémoire + file d'attente). Un deuxième clic sur « Publier » pendant un build est mis en file, pas lancé en parallèle.

### 5.2 Étapes d'un build

```
 1. Verrou ──► 2. Ouvrir la source (base ou snapshot, lecture seule)
 3. Charger layout, partials, pages, gabarits de fiches, composants (Cheerio)
 4. Pour chaque langue active × chaque page publiable (pages + fiches de collections) :
      a. composer layout + page
      b. injecter les contenus (data-cms-key / html / attr / list / field)
      c. injecter les médias (<picture>, srcset WebP, alt/title de la langue, poster des vidéos)
      d. réécrire les liens internes et les URL du moteur de réservation de la langue
      e. <head> : <html lang>, title, description, Open Graph, canonical,
         <link rel="alternate" hreflang> pour chaque langue publiée + x-default, JSON-LD
      f. bandeaux par zone (§ 6.1) et configuration du popup (§ 6.2)
      g. textes de l'interface JS (#i18n), attributs de suivi (data-track*)
      h. retirer les data-cms-* et minifier légèrement le HTML
 5. Contrôles (§ 5.4) : une erreur bloquante arrête un build de production
 6. Écrire dans un dossier temporaire .build-<id>/ :
      /fr/…/index.html, /en/…/index.html, /404.html par langue
      /assets/ (CSS et JS renommés avec leur empreinte : styles.3f2a1c.css)
      sitemap.xml (lastmod fiable, images, alternatives hreflang), robots.txt,
      redirects.caddy (anciennes URL → nouvelles), sw.js versionné
 7. Calculer l'empreinte du résultat (output_hash)
 8. Finaliser :
      - preview    → remplacer preview/ par le dossier temporaire
      - production → déplacer vers releases/<id>/, mise en ligne (§ 5.3),
                     puis IndexNow : liste des adresses ajoutées ou modifiées
      - cron       → si output_hash = version en ligne : statut 'skipped', rien n'est remplacé
 9. Enregistrer sys_builds (durée, pages, langues, avertissements) et libérer le verrou
```

Les médias ne sont pas copiés dans chaque version : ils sont servis depuis `media/` et leurs noms contiennent une empreinte, donc ils sont immuables. Une restauration retrouve exactement les mêmes fichiers.

### 5.3 Mise en ligne et rollback
- **Mise en ligne atomique** : création d'un lien temporaire vers `releases/<id>/`, puis renommage par-dessus `public-dist` (`rename` est atomique sous Linux). Aucun visiteur ne voit un site à moitié écrit.
- **Conservation** : les 3 dernières versions de production réussies, et leurs snapshots, sont gardées ; les plus anciennes sont supprimées.
- **Restaurer** : le lien pointe vers la version précédente, en une opération, sans régénération.
- Le cron ignore les régénérations identiques, pour que les 3 emplacements contiennent de vraies versions différentes et pas trois copies de la nuit.

### 5.4 Contrôles

| Contrôle | Prévisualisation | Production |
|---|---|---|
| Gabarit illisible, clé `data-cms-*` sans entrée | erreur | bloquant |
| Champ obligatoire vide dans la langue par défaut | signalé | bloquant |
| Lien interne cassé, chemin en double | signalé | bloquant |
| Page incomplète dans une langue étrangère | affichée avec repère orange | page **non publiée** dans cette langue, absente des hreflang et du sitemap |
| Image sans `alt`, title > 60 caractères, description > 160 | avertissement | avertissement |

Règle de publication par langue : une page n'est publiée dans une langue que si toutes ses entrées obligatoires y sont au statut `ready`. Jamais de page à moitié traduite.

---

## 6. Bandeaux et popup

### 6.1 Bandeaux
- **Zones** : `top-bar` (remplace l'actuel bandeau Live Music), `hero-sub` (sous le module de réservation), `section-intercalaire` (entre deux sections, emplacements marqués dans les gabarits), `footer-cta` (avant le pied de page).
- **Sélection au build** : bandeaux actifs, placés sur cette page (ou sur toutes), dans la langue (sinon en anglais s'il est prêt, sinon en français : un bandeau n'est jamais masqué faute de traduction), et dont la période recoupe la fenêtre « maintenant → prochain cron + 1 h ». Tri par priorité, dans la limite de `max_banners` de la zone.
- **Double sécurité** : chaque bandeau porte `data-start` et `data-end` (ISO avec fuseau). Un petit script en ligne dans le `<head>`, exécuté avant l'affichage, masque un bandeau expiré ou pas encore commencé. Un bandeau qui démarre à 14 h apparaît donc à 14 h sans attendre le cron, et un bandeau expiré disparaît sans clignoter.
- Un bandeau refermé reste fermé pour ce visiteur (`localStorage`, clé avec l'id et la version du bandeau).

### 6.2 Popup
- Injecté seulement sur les pages ciblées : balise `<dialog>` + configuration en JSON + `popup.js` (moins de 3 Ko).
- **Déclencheurs** : délai, pourcentage de défilement ou intention de sortie. L'intention de sortie n'existe pas sur mobile : on y applique `mobile_trigger`.
- **Fréquence** dans `localStorage` (une fois, une fois par session, tous les N jours). Changer `version` réaffiche le popup à tous. Si le stockage est indisponible (navigation privée), le popup s'affiche au plus une fois par page chargée.
- **Accessibilité** : focus piégé dans la fenêtre, fermeture par Échap et par un bouton visible, retour du focus.
- **Médias** : jamais de son automatique (lecture au clic). Vidéo muette en boucle avec `poster`, chargée seulement à l'ouverture.
- **Bonne pratique Google** : sur mobile, éviter une fenêtre plein écran dès l'arrivée depuis la recherche (pénalité « interstitiels intrusifs »). Le popup s'y affiche en panneau bas de page et jamais avant la première interaction.

---

## 7. Langues et SEO

### 7.1 Langues

- **Adresses** : `/fr/…`, `/en/…`, `/it/…`, `/de/…`, avec des noms de pages traduits (`/en/rooms/`, `/it/camere/`). `/` redirige vers la langue par défaut, jamais selon le pays ou le navigateur.
- **Sélecteur de langue** : écrit au build dans chaque élément `data-lang-switch` du layout (menu déroulant de l'en-tête sur ordinateur, menu mobile, pied de page). Il liste, dans l'ordre de « Langues », les langues actives où la page est publiée (dans la prévisualisation : toutes les langues actives), sous leur nom natif, et mène à la même page dans chaque langue. Une langue où la page n'est pas encore traduite n'y figure pas ; avec une seule langue, le sélecteur est retiré.
- **hreflang** : sur chaque page, une balise par langue où elle est publiée, plus `x-default` (réglage `x_default_lang`).
- **sitemap.xml** : une entrée par page et par langue, avec les alternatives `xhtml:link`. `robots.txt` indique son adresse.
- **Moteur de réservation** : le segment de langue D-Edge vient de `cms_languages.booking_lang`.
- **État des traductions** : pour chaque langue, et par module (pages, collections, médias, bandeaux, popup), l'admin calcule trois états :
  - **manquant** : aucune valeur ;
  - **à revoir** : le `source_hash` enregistré diffère de l'empreinte actuelle du texte français ;
  - **prêt** : statut `ready` et empreinte à jour.
  Il affiche un pourcentage par langue et la liste des manques, avec un lien direct vers chaque champ.

### 7.2 Un sitemap toujours à jour

- **Régénéré à chaque build de production** : publication, cron de minuit. Une restauration remet en ligne le sitemap de la version restaurée, puisqu'il fait partie de la version.
- **Contenu** : uniquement les pages publiées et indexables, dans les langues où elles existent, avec leurs alternatives `hreflang` et leurs photos principales (`image:image`, utile pour Google Images : chambres, rooftop, restaurants). Jamais la prévisualisation ni les pages `noindex`.
- **`lastmod` fiable** : le build calcule l'empreinte du contenu principal de chaque page, hors bandeaux, popup et numéro de build. La date ne change que si cette empreinte change (`sys_page_state`). Les moteurs gardent ainsi confiance dans cette date.
- **Signalement aux moteurs** :
  - `robots.txt` indique l'adresse du sitemap ;
  - le sitemap est déclaré une fois dans Google Search Console et Bing Webmaster Tools ;
  - à chaque publication, les adresses ajoutées ou modifiées sont envoyées par IndexNow (Bing, Yandex et les autres moteurs participants).
  Google a supprimé en 2023 le « ping » de sitemap : il relit le fichier lui-même. D'où l'importance d'un `lastmod` fiable.
- **Contrôles après build** : XML valide, chaque adresse du sitemap correspond à un fichier de la version, hreflang réciproques.
- **Suivi** (option § 8.4) : avec l'accès à la Search Console, le tableau de bord affiche les pages envoyées, les pages indexées et les erreurs du sitemap.

### 7.3 SEO pris en compte

**Technique, automatique à chaque build**
- **Adresses** : une vraie adresse par page et par langue, en minuscules, avec une barre finale cohérente. Redirections 301 de `http` vers `https`, de la variante sans `www`, de `/fr/index.html` vers `/fr/`, et des anciennes adresses du site actuel.
- **Balises** : `<title>`, meta description, canonical vers la page elle-même, `hreflang` réciproques (vérifiés), `<html lang>`, Open Graph et carte Twitter avec une image par page.
- **Données structurées JSON-LD**, générées depuis la base dans chaque langue et validées au build (propriétés obligatoires présentes) :
  - `Hotel` : adresse, coordonnées GPS, téléphone, étoiles, horaires d'arrivée et de départ, équipements ;
  - `HotelRoom` + `Offer` : surface, capacité, lits, prix quand il est connu ;
  - `Restaurant` et `BarOrPub` : horaires, réservation ;
  - `Event` pour les soirées Live Music, `BreadcrumbList` pour le fil d'Ariane, `FAQPage`, `BlogPosting` pour le journal.

  Pas de note moyenne (`AggregateRating`) tirée des avis publiés sur le site lui-même : Google ne l'affiche pas en étoiles pour un hôtel qui se note lui-même. Les résultats enrichis « FAQ » sont aujourd'hui réservés par Google à quelques sites officiels, mais ces données restent utiles aux assistants IA.
- **Visibilité dans les assistants IA (GEO, 27/10/2026)** :
  - nœud `WebPage` sur chaque page (titre, description, langue, image principale), relié par `@id` au site, à l'hôtel, au fil d'Ariane et au contenu principal ; pages à questions typées `FAQPage`, sans les réponses encore « à confirmer » (`.verify`) ;
  - `robots.txt` qui nomme et autorise les robots IA (`AI_BOTS` dans `sitemap.js`) ; balise robots `max-snippet:-1, max-image-preview:large` sur le site publié ;
  - `llms.txt` (`ssg/llms.js`) : faits tirés du graphe JSON-LD et liste des pages publiées avec leur title et leur description, à la racine dans la langue par défaut et sous `/<langue>/llms.txt`.
- **Vitesse (Core Web Vitals)** :
  - HTML statique ; CSS et JS avec empreinte et cache long ;
  - image principale préchargée en priorité, WebP en tailles adaptées, `width`/`height` sur chaque image (pas de saut de mise en page) ;
  - chargement différé sous la ligne de flottaison, polices préchargées.

  Mesurée chez les vrais visiteurs (§ 8.2).
- **Indexation** : prévisualisation protégée et marquée `noindex` (en-tête HTTP), option `noindex` par page, vraie erreur 404 par langue.
- **Maillage interne** : fil d'Ariane ; liens entre chambres, offres et restaurants tirés des collections ; liens internes cassés bloquants au build.

**Éditorial, aidé par l'admin**
- **Aperçu en direct** pendant la saisie : résultat Google (ordinateur et mobile) et partage sur les réseaux sociaux.
- **Mot-clé principal** par page et par langue (`focus_keyword`), avec des contrôles affichés en vert, orange ou rouge :
  - présence du mot-clé dans le title, le H1, la description, l'adresse et le premier paragraphe ;
  - title de 30 à 60 caractères, description de 70 à 160 ;
  - un seul H1, ordre des titres respecté, `alt` sur chaque image ;
  - longueur minimale du texte pour les pages de recherche (« hôtel avec piscine à Nice »…).

  Ce sont des avertissements, pas des blocages.
- **Doublons** : titles ou descriptions identiques sur deux pages signalés.
- **Référencement local** : nom, adresse et téléphone saisis une seule fois dans les réglages et réutilisés partout (pied de page, contact, JSON-LD), comme sur la fiche Google Business Profile.
- **Assistants IA** (fiche 32 de l'audit) : réponses précises en texte (distances, horaires, capacités, prix) et données structurées. En option, un fichier `llms.txt` qui liste les pages clés : convention récente, non officielle, au coût presque nul.

---

## 8. Statistiques

### 8.1 Ce qui se fait dans l'hôtellerie, et notre approche
**La pratique la plus répandue :**
- Google Analytics 4 installé avec Google Tag Manager ;
- suivi e-commerce du moteur de réservation (D-Edge le propose pour GA4) ;
- Search Console et rapports Looker Studio ;
- cartes de chaleur et enregistrements de sessions (Hotjar, Microsoft Clarity) ;
- pixels publicitaires (Google Ads, Meta, Google Hotel Ads).

Tout cela exige un bandeau de consentement. En France, une part importante des visiteurs refuse, et les chiffres ne portent alors que sur ceux qui acceptent. Les données partent chez Google ou Microsoft.

**Notre approche** reprend celle des outils respectueux de la vie privée (Plausible, Umami, ou Matomo configuré selon la CNIL), intégrée au back-office et complétée par des indicateurs propres à l'hôtellerie, en trois niveaux.

### 8.2 Niveau 1 — inclus, sans consentement

| Thème | Ce qu'on mesure | À quoi ça sert |
|---|---|---|
| Audience | Visiteurs, visites, pages vues ; pays et région ; langue du navigateur comparée à celle de la page ; appareil. | Marchés à cibler, langues à traduire en priorité. |
| Acquisition | Canal : recherche naturelle, payant, **assistants IA** (ChatGPT, Perplexity, Gemini, Copilot), réseaux sociaux, e-mail, comparateurs et agences en ligne, sites référents, accès direct. Campagnes UTM, page d'entrée. | Savoir ce qui amène des réservations, pas seulement des visites. |
| Engagement | Temps de lecture actif, défilement, part de visites engagées (plus de 10 s actives, 2 pages ou une action, comme GA4), pages de sortie, erreurs 404. | Pages qui retiennent ou qui font fuir. |
| Intentions de réservation | Recherches du module : date d'arrivée, nombre de nuits, adultes, enfants, délai avant l'arrivée, chambre ou offre. Clics vers le moteur avec leur source exacte. | **Calendrier de la demande** pour le revenue management, délai de réservation, durée de séjour, taille des groupes. |
| Autres conversions | Clics sur le téléphone et l'e-mail, demandes de devis séminaire, réservations de table par téléphone, ouverture de la carte. | Les contacts qui ne passent pas par le moteur. |
| Éléments | Vues, clics et clics de réservation attribués pour chaque bandeau, popup et bouton (carte des clics par élément). | Savoir ce qui convertit. |
| Chat | Questions par thème reconnu, nombre de questions sans réponse. | Compléter la base de réponses. |
| Performance | Core Web Vitals mesurés chez les vrais visiteurs (LCP, INP, CLS), par type de page et par appareil. | Google en tient compte dans le classement. |

**Règles de confidentialité**
- **Ni cookie ni identifiant persistant.**
- **Visiteur** = `sha256(sel du jour + IP + User-Agent + domaine)`, tronqué. Le sel est tiré au hasard chaque jour puis supprimé le surlendemain : impossible de relier deux jours ou de retrouver une IP. L'IP n'est jamais écrite.
- **Pays et région** : lus dans une base GeoIP locale et gratuite (DB-IP Lite, mise à jour mensuelle), consultée en mémoire. Seuls le pays et la région sont gardés, jamais la ville : la CNIL demande de ne pas descendre sous l'échelle de la ville.
- **Chat** : on enregistre l'identifiant de la réponse donnée, jamais le texte tapé, qui peut contenir des données personnelles.
- **Pas d'enregistrement de session ni de carte de chaleur au pixel** : la carte des clics par élément suffit et reste anonyme.
- **Attribution** : `track.js` mémorise en `sessionStorage` (30 min) le dernier bandeau ou popup cliqué, pour l'attacher au clic de réservation (`via`).
- **Conservation** : événements bruts 13 mois, agrégats 25 mois, purge automatique. Robots exclus ; le signal `Do Not Track` est respecté.

Ces choix suivent les conditions d'exemption de consentement de la CNIL pour la mesure d'audience : finalité limitée, statistiques anonymes, pas de croisement avec d'autres traitements. La validation finale revient au référent RGPD de l'hôtel, et une mention dans la politique de confidentialité reste obligatoire.

### 8.3 Niveau 2 — option : visiteurs récurrents
- **Principe** : un identifiant aléatoire propre au site, gardé 13 mois au plus dans le `localStorage`.
- **Ce que ça apporte** :
  - visiteurs uniques exacts sur une semaine, un mois ou une année ;
  - nouveaux visiteurs et visiteurs qui reviennent ;
  - nombre de visites et de jours avant le clic de réservation ;
  - attribution au premier canal (« premier contact ») en plus du dernier.
- **Condition** : rester dans l'exemption de la CNIL suppose d'en informer les visiteurs et de proposer un lien d'opposition dans la politique de confidentialité. Le refus est mémorisé et plus rien n'est envoyé.

### 8.4 Niveau 3 — option : réservations confirmées et Search Console
- **Réservations D-Edge, sans traçage** : import quotidien des réservations faites sur le site, par export CSV du back-office D-Edge ou par API si D-Edge en fournit une. On en tire le nombre de réservations, les nuitées, le chiffre d'affaires, le prix moyen, le délai, la durée et le pays. Aucune donnée nominative : le numéro de réservation n'est gardé que sous forme d'empreinte.
  - Résultat : le vrai taux de transformation, le chiffre d'affaires par visite et le rapport recherches / réservations (« look-to-book »), jour par jour et par langue.
- **Réservations D-Edge, visite par visite** : relier chaque réservation à sa source exacte (bandeau, popup, canal) suppose que le moteur renvoie l'identifiant de visite passé dans l'adresse, ou qu'il accepte un script sur sa page de confirmation. À vérifier avec D-Edge. Si cela passe par GA4, le consentement devient obligatoire.
- **Search Console** (gratuite ; l'hôtel accorde un accès en lecture) : requêtes Google, impressions, clics et position par page et par pays, état du sitemap, importés chaque nuit.
- **Pixels publicitaires** (Google Ads, Meta, Hotel Ads) : seulement si l'hôtel lance des campagnes payantes. Ils imposent un bandeau de consentement et sortent du périmètre actuel.

### 8.5 Script client `track.js` (17 Ko, 6,5 Ko compressé, `web-vitals` compris)
- Une page vue au chargement.
- À la sortie de la page (`pagehide`) : temps actif, défilement maximal et Core Web Vitals.
- Clics : réservation, bandeaux, popup, téléphone, e-mail, plan, langue, liens sortants.
- Envoi du module de réservation, avec les dates et les voyageurs.
- Le site émet des événements (`aston:booking`, `aston:chat`, `aston:quote`) que `track.js` écoute : le site fonctionne sans lui.
- Envoi par `navigator.sendBeacon` (le clic vers le moteur n'est jamais retardé), en `text/plain` pour éviter une requête CORS préalable. Rien n'est envoyé en cas d'opposition (niveau 2), de `Do Not Track` ou de `Global Privacy Control`.

```json
{ "t": "booking_search", "p": "/en/rooms/confort/", "l": "en", "tp": "chambre",
  "s": "room:confort", "a": "2027-05-14", "n": 3, "ad": 2, "ch": 1, "g": "confort",
  "r": "chatgpt.com", "u": { "source": "newsletter", "medium": "email", "campaign": "printemps" } }
```

### 8.6 Réception `POST /api/track`
- Validation stricte du format (schéma Fastify) et limite de débit par IP.
- Calculs côté serveur : empreintes, pays et région, canal (règles par domaine référent et UTM, avec une catégorie dédiée aux assistants IA), délai avant arrivée.
- Mise en file, puis insertion par lots toutes les 2 secondes dans une seule transaction (événements + mise à jour de la visite). Réponse `204` immédiate.

### 8.7 Tableau de bord
**Filtres** : Semaine, Mois, Année, avec navigation et comparaison à la période précédente. Filtres croisés : langue, pays, appareil, canal.

| Écran | Contenu |
|---|---|
| Vue d'ensemble | Visiteurs, visites engagées, recherches de disponibilités, clics vers le moteur, **taux de conversion** (visites avec un clic de réservation ÷ visites). Avec le niveau 3 : réservations, chiffre d'affaires, chiffre d'affaires par visite, look-to-book. |
| Acquisition | Canaux (dont assistants IA), sites référents, campagnes, pages d'entrée avec leur taux de conversion. Avec le niveau 3 : requêtes Google. |
| Audience | Pays et régions, langues (navigateur ou page : révèle les langues manquantes), appareils. Avec le niveau 2 : nouveaux visiteurs et visiteurs qui reviennent. |
| Comportement | Pages, temps actif, défilement, sorties, erreurs 404, clics par élément, thèmes du chat. |
| Réservation | **Entonnoir** : visite → fiche chambre ou offre → recherche de dates → clic vers le moteur → réservation (niveau 3). **Calendrier de la demande** : dates d'arrivée recherchées, semaine par semaine. Délai avant l'arrivée, durée de séjour, taille des groupes, chambres et offres demandées. |
| Bandeaux et popup | Vues → clics → clics de réservation attribués → taux, pour chaque élément. |
| Performance et SEO | Core Web Vitals (75e centile) par type de page et appareil, état du sitemap, avertissements SEO du dernier build. Avec le niveau 3 : positions dans Google. |

- **Export CSV** de chaque tableau. **Rapport hebdomadaire par e-mail** en option (il faut un serveur d'envoi).
- **Limites affichées honnêtement dans l'interface** :
  - sans le niveau 3, on mesure le **clic vers le moteur**, pas la réservation confirmée, qui se passe chez D-Edge ;
  - sans le niveau 2, les visiteurs uniques sont exacts à la journée. Sur une semaine ou un mois, c'est la somme des visiteurs quotidiens : une même personne revenue deux jours compte deux fois.

---

## 9. API (Fastify)

Toutes les routes sauf `/api/track` exigent une session. Les écritures exigent en plus le jeton CSRF. Les droits dépendent du rôle :
- **admin** : tout ;
- **editor** : contenus, médias, bandeaux, popup, prévisualisation et publication ;
- **translator** : uniquement les langues qui lui sont attribuées, sans publication.

| Module | Routes |
|---|---|
| Authentification | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Langues | `GET/POST /api/languages`, `PATCH /api/languages/:code` |
| Pages et SEO | `GET /api/pages`, `GET/PATCH /api/pages/:id`, `PUT /api/pages/:id/i18n/:lang` |
| Contenus | `GET /api/entries?page=&lang=`, `PUT /api/entries/:id/:lang` |
| Collections | `GET /api/collections`, `GET/POST /api/collections/:key/items`, `GET/PATCH/DELETE /api/items/:id`, `PUT /api/items/:id/i18n/:lang`, `PUT /api/items/:id/media` |
| Médias | `GET /api/media?folder=&kind=&q=`, `POST /api/media` (multipart), `POST /api/media/embed`, `PATCH /api/media/:id`, `PUT /api/media/:id/i18n/:lang`, `DELETE /api/media/:id` |
| Bandeaux | `GET/POST /api/banners`, `GET/PATCH/DELETE /api/banners/:id`, `PUT /api/banners/:id/i18n/:lang`, `PUT /api/banners/:id/placements` |
| Popup | `GET/POST /api/popups`, `GET/PATCH/DELETE /api/popups/:id`, `PUT /api/popups/:id/i18n/:lang`, `PUT /api/popups/:id/pages` |
| Traductions | `GET /api/translations/status`, `GET /api/translations/todo?lang=` |
| Builds | `POST /api/builds/preview`, `POST /api/builds/publish`, `GET /api/builds`, `GET /api/builds/:id`, `POST /api/builds/:id/restore` |
| Statistiques | `POST /api/track` (public), `GET /api/analytics/summary?period=week\|month\|year&date=&lang=&country=&device=&channel=`, `GET /api/analytics/timeseries`, `GET /api/analytics/top?dim=channel\|source\|lang\|country\|banner\|popup\|page\|entry\|referrer\|utm\|element\|chat`, `GET /api/analytics/funnel`, `GET /api/analytics/demand` (dates recherchées, délai, durée), `GET /api/analytics/vitals`, `GET /api/analytics/search-console`, `POST /api/analytics/bookings/import` (CSV D-Edge), `GET /api/analytics/export.csv` |
| SEO | `GET /api/seo/report` (avertissements du dernier build), `GET /api/seo/pages/:id/:lang` (contrôles du mot-clé, longueurs, doublons) |
| Utilisateurs, réglages | `GET/POST/PATCH/DELETE /api/users`, `GET/PATCH /api/settings` |
| Aperçu | `GET /preview/*` (fichiers de `preview/`, session obligatoire, `noindex`) |

---

## 10. Médias : pipeline à l'upload

- **Contrôles** : taille maximale par type (réglable), type réel vérifié sur le contenu du fichier (pas l'extension), nom normalisé, empreinte SHA-256 contre les doublons.
- **Images** (`sharp`) :
  - rotation EXIF appliquée, métadonnées retirées ;
  - variantes WebP en 640, 1024, 1600 et 2400 px de large (jamais au-delà de l'original) ;
  - recadrage portrait 900×1600 centré sur le point focal ;
  - miniature pour l'admin.
- **Vidéos** (`ffprobe` / `ffmpeg`) :
  - lecture de la durée, des dimensions et du poids, avec alerte au-delà de 8 Mo pour une boucle de fond ;
  - poster WebP extrait à 1 seconde, ou poster téléversé à la main.
- **Audio** : durée et poids, alerte au-delà de 5 Mo.
- **Liens externes** (YouTube, Vimeo, Spotify…) : URL validée et fournisseur reconnu. Au build, l'intégration n'est chargée qu'au clic, avec une image d'attente : pas de cookies tiers avant une action du visiteur.
- **Traitement en arrière-plan** : le média reste au statut `processing` pendant le travail, puis `ready` ou `error` avec le message.

---

## 11. Sécurité

- **Admin** :
  - session en cookie `HttpOnly; Secure; SameSite=Strict` (cookie interne à l'admin, sans rapport avec le site public) ;
  - mot de passe argon2id ;
  - limite de tentatives de connexion ;
  - jeton CSRF ;
  - journal d'audit de chaque modification.
- **Contenu** : texte riche nettoyé par liste blanche avant stockage et avant injection. Les textes simples sont toujours échappés.
- **Téléversements** : stockés hors des dossiers servis, sans exécution possible, type vérifié.
- **En-têtes HTTP** (Caddy) :
  - CSP stricte sur le site public ;
  - CSP de l'admin limitée au site lui-même : les bibliothèques (versions figées dans `package.json`) sont servies par Node depuis `node_modules`, sans CDN tiers ;
  - HSTS, `X-Content-Type-Options`, `Referrer-Policy`.
- **Prévisualisation** : jamais publique (session obligatoire, `noindex`).
- **Sauvegardes** : copie nocturne de la base (API de sauvegarde SQLite) sur 7 jours glissants. Le dossier `media/` est à synchroniser hors du VPS (script `backup.sh` fourni, destination à choisir).

---

## 12. Déploiement (fichiers livrés en fin de projet)

- **Caddyfile** :
  - HTTPS automatique ;
  - `root` sur `public-dist` ;
  - `/api/*`, `/admin/*`, `/preview/*` → `reverse_proxy localhost:3000` ;
  - `/media/*` servi depuis `media/` ;
  - cache long `immutable` pour `/assets/*` et `/media/*`, `no-cache` pour le HTML ;
  - import de `redirects.caddy` généré par le build ;
  - pages 404 par langue.
- **PM2** : un processus, redémarrage automatique, journaux tournants, `TZ=Europe/Paris`.
- **Dockerfile** (alternative) : image Node 24 avec `ffmpeg`, volumes pour `storage/`, `media/`, `releases/` et `preview/`, lien `public-dist` partagé avec Caddy.

---

## 13. Plan de développement (après validation)

| Brique | Contenu | Comment on vérifie |
|---|---|---|
| **1. Base + moteur SSG** | Migrations, import du site actuel, composition Cheerio, injection, contrôles, SEO technique (sitemap à `lastmod` fiable, IndexNow, données structurées), prévisualisation, publication, versions et restauration, cron. Adaptation du routeur JS en pages réelles. Commandes `npm run build:preview` et `npm run publish`. | `/preview/fr/` identique au site actuel (comparaison page par page dans le navigateur) ; publication puis restauration testées. |
| **2. API CMS + médias** | Authentification et rôles, routes du § 9 (hors statistiques), pipeline `sharp` / `ffmpeg`, état des traductions, bandeaux et popup au build. | Tests d'API automatisés ; upload d'une photo → variantes WebP présentes dans le build. |
| **3. Statistiques** | Niveau 1 complet : `track.js`, `/api/track`, GeoIP locale, canaux, visites, agrégats nocturnes, purge, requêtes du tableau de bord. Niveaux 2 et 3 si tu les valides : identifiant de 13 mois avec opposition, import D-Edge, import Search Console. | Parcours simulé (arrivée depuis ChatGPT → fiche chambre → recherche de dates → clic vers le moteur) retrouvé avec le bon canal, la bonne attribution et la bonne demande. |
| **4. Interface d'administration** | Back-office Alpine.js + Tailwind + Chart.js : contenus avec aperçu Google et contrôles SEO, collections, médias, bandeaux, popup, langues, publication, statistiques. | Parcours complet dans le navigateur : modifier → prévisualiser → publier → restaurer. |

---

## 14. Questions avant de coder

1. **Emplacement** : tout dans `hotelaston/Backend/`, code Node dans `server/` (choix A) — d'accord ?
2. **Langues au lancement** : le cahier des charges cite FR, EN, IT, DE ; la Résidence propose FR, EN, IT, ES. Lesquelles activer, et laquelle pour `x-default` (souvent l'anglais pour une clientèle internationale) ?
3. **Rôles** : un seul compte administrateur suffit-il, ou faut-il dès le départ les rôles éditeur et traducteur ?
4. **Hébergement** : PM2 directement sur le VPS (recommandé, plus simple) ou Docker ?
5. **ffmpeg sur le VPS** pour les posters de vidéos (choix G) — d'accord ?
6. **Anciennes adresses** : faut-il rediriger les URL actuelles de hotel-aston.com vers les nouvelles pages ? Il me faudrait alors la liste des pages du site en ligne (ou l'accès à son sitemap).
7. **Statistiques** : le niveau 1 est inclus. Veux-tu aussi le niveau 2 (visiteurs récurrents, avec lien d'opposition) et le niveau 3 (réservations D-Edge, Search Console) ?
8. **À demander par l'hôtel** si le niveau 3 est retenu :
   - à D-Edge : un export ou une API des réservations, et la possibilité de faire suivre un paramètre de visite jusqu'à la confirmation ;
   - dans la Search Console : un accès en lecture pour le back-office.
