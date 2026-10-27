---
name: hotel-aston-site
description: Hôtel Aston La Scala (Nice) — maquette HTML/CSS/JS + back-office Node (CMS, générateur statique, statistiques, admin) ; décisions et pièges
type: project
---

**Maquette du site** (livrée le 25/10/2026, à la racine de `hotelaston/`) : `index.html` (vues `#/…`, blocs de données JSON, JSON-LD), `styles.css`, `remotion-vanilla.js` (interpolate / spring portés de Remotion + toute l'interface), `remotion-compositions.tsx` (HeroRooftop 1920×1080 12 s, HeroRooftopPortrait 720×1280, MoonBarLive 8 s à 120 BPM), rendues dans `media/` par le petit projet Remotion `video/` (Remotion 4.0.535, `resolve.modules` de webpack surchargé pour que le .tsx racine trouve video/node_modules). Cahier des charges : revue UX en 36 règles (`revue-ux-hotel-aston-relecture.pdf`, sans couche texte : le lire en rendant les pages avec pymupdf). 35 règles sur 36 appliquées ; l'écart : pas d'avis sur les pages L'Horloge / Moon Bar / L'Aston Club (reporté par l'utilisateur).

Photos : la maquette racine les lit toujours sur le CDN de l'hôtel `d1i8cf9j7dueks.cloudfront.net/cache/img/` (tailles pré-générées seulement, une taille non prévue renvoie 404). Le back-office, lui, ne les lit plus sur le CDN depuis le 27/10/2026 : 72 photos importées dans la médiathèque par `node server/cli.js media:import-site` (accord de l'utilisateur pour le téléchargement), emplacements `data-cms-media` listés dans `Backend/templates-src/photos.json` (`<page>.photo-n`, `global.logo`), fiches chambre et service par `media` (id) dans chaque photo, JSON-LD réécrit en URL `/media/v/…webp` absolues ; image de partage en variante JPEG 1200×630 (`purpose = 'share'`, créée pour chaque image, choix validé par l'utilisateur : « fais ce qui est le mieux »). Sur une base neuve, relancer la commande (sinon la publication échoue). Le alt écrit dans le gabarit l'emporte sur celui de la médiathèque ; `data-cms-decorative` et `data-cms-portrait="off"` ; CSS `picture { display: contents }`. Hero = photo de la piscine ; la boucle vidéo (`media/video_hero_loop.mp4`, faite avec `video/make_hero_loop.py`) attend la prise de vue définitive, balise `<video>` commentée dans index.html.

**Pourquoi :** rien n'est inventé. Ce que le site actuel ne dit pas (prix et économies des offres, annulation, paiement, capacités de Matisse et de L'Aston Club…) est enveloppé dans `.verify` (visible avec `?audit`). Avis de démonstration étiquetés « Exemple ». Pas d'AggregateRating dans le JSON-LD, volontairement.

Faits confirmés par l'utilisateur (25/10/2026) : un seul bar ouvert à la fois, le Moon Bar (toit) quand le temps le permet, sinon L'Aston Club (7e étage) ; ne jamais qualifier L'Aston Club de bar « jazz ». Le lieu du Live Music les soirs de beau temps est une déduction (marquée `.verify`).

Résidence Aston La Scala : bâtiment voisin distinct (2 rue Chauvain, ancien Peter's Hôtel de 1908, 17 appartements). Tous les liens de l'hôtel passent par la page passerelle `#/appartements` ; elle seule renvoie vers le site de la Résidence (nouvel onglet + utm_*).

**Back-office** (`hotelaston/Backend/`, 26/10/2026) : Node 22+ (24 LTS visé), Fastify 5, better-sqlite3 (WAL), Cheerio, sharp, argon2, node-cron. Architecture validée dans `ARCHITECTURE.md` (32 tables). Réponses par défaut retenues : FR + EN actives, IT / DE préparées, x-default EN, rôles admin / editor / translator, PM2 (+ Dockerfile), ffmpeg sur le serveur, statistiques niveau 1 seulement.
- Brique 1 : import du site (34 pages FR identiques), génération par page et par langue, prévisualisation, publication figée (snapshot), 3 versions, restauration, cron de nuit, sitemap à lastmod fiable, IndexNow, redirections 301.
- Brique 2 : API, connexion (cookie HttpOnly, CSRF), rôles, médias (WebP 640–2400, portrait centré sur le point d'intérêt, poster vidéo), bandeaux (4 zones), popup, 57 textes `ui.*` du JavaScript.
- Éditeur limité Live Music (ajouté avant la brique 3 à la demande de l'utilisateur) : `sys_users.scopes` + `server/auth/scopes.js` (page live-music, collection `gigs`, médias `/live-music`, bandeaux du périmètre), publication limitée via `createScopedSnapshot`.
- Brique 3 : statistiques sans cookie (sel du jour, pas d'IP), `track.js` sur le site publié seulement, canaux dont « ai » et « metasearch », entonnoir, demande, Core Web Vitals, agrégats de nuit, purge 13 / 25 mois. Base DB-IP **non téléchargée** (accord de l'utilisateur nécessaire, mention CC BY obligatoire).
- Brique 4 : interface `admin/` = Alpine 3.17.4 (ESM) + Tailwind 4.3.3 (version navigateur) + Chart.js 4.5.1 servis depuis node_modules par `/admin/vendor/*` (`server/admin-assets.js`, CSP stricte, pas de CDN) ; routeur `#/…` dans `admin/lib/router.js`, un fragment `views/<nom>.html` + un composant `Alpine.data` par écran (22 écrans). 36 tests.
- Reste : fichiers de déploiement (Caddyfile, PM2, Dockerfile), sauvegarde nocturne de la base, import des photos dans la médiathèque, comptes réels. Liste complète dans `BILAN.md`.

**Pièges rencontrés :**
- Windows : remplacer une jonction par unlink puis rename ; fermer un fichier SQLite avant de le supprimer (EBUSY) ; clés étrangères désactivées pendant la copie d'un snapshot.
- `snapshot_path` et `release_path` sont relatifs à `config.varDir` depuis le 27/10/2026 (`toVarPath` / `fromVarPath`, réécriture des anciens chemins Windows au démarrage) : le dossier peut changer d'emplacement.
- Déploiement : `deploy/` (Caddyfile canonique `www`, PM2, Dockerfile avec `ASTON_VAR_DIR=/data`, sauvegardes). Documents pour l'hôtel : `docs/`.
- Tests : le runner de node lance les fichiers en parallèle, donc tout fichier temporaire doit vivre sous `ASTON_VAR_DIR` (`config.varDir`).
- Alpine : un `this.x = …` dans un composant enfant, sur une propriété non déclarée, écrit dans le composant parent (toujours déclarer les propriétés) ; `structuredClone` échoue sur les objets réactifs (copie JSON).
- Navigateur de prévisualisation masqué : `requestAnimationFrame` y est suspendu, donc `x-show` ne réaffiche plus rien ; ce n'est pas un bug de l'admin, vérifier l'état par JavaScript.
- Ouvrir `/fr/` en local crée des visites dans les statistiques de développement : les supprimer après les tests.

Identifiants locaux (administrateur de dev et éditeur Live Music) : `Backend/.dev-credentials`, jamais recopiés dans les réponses. Voir [[historique]] et [[user-profile]].
