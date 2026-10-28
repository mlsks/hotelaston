# Back-office Aston La Scala

CMS sur mesure, générateur de site statique et statistiques. L'architecture complète est décrite dans [ARCHITECTURE.md](ARCHITECTURE.md).

## État

| Brique | État |
|---|---|
| 1. Base de données, moteur de génération, publication, restauration | Terminée |
| 2. API du back-office, connexion et rôles, médias, bandeaux, popup, textes du JavaScript traduisibles | Terminée |
| 3. Statistiques (niveau 1) | Terminée |
| 4. Interface d'administration (`/admin/`) | Terminée |

Ajouté entre les briques 2 et 3 : un **éditeur limité au Live Music** (voir Rôles).

**Vérifié** :
- les 34 pages françaises générées ont le même texte, la même structure HTML, le même `<title>`, le même en-tête, pied de page, menu, bouton bas d'écran et bandeau Live Music que le site actuel ;
- 44 tests automatiques (`npm test`) :
  - connexion, CSRF, rôles, traductions, médias (images et vidéo), bandeaux, popup, textes d'interface, publication et restauration, utilisateurs ;
  - éditeur Live Music : ce qu'il voit, ce qu'il modifie, publication limitée à son périmètre ;
  - statistiques : canaux, périodes, parcours simulé de ChatGPT jusqu'au moteur de réservation avec bandeau attribué, entonnoir, demande, Core Web Vitals, export CSV, agrégats, confidentialité, droits ;
  - interface : en-têtes de sécurité, bibliothèques locales et leur cache, chaque écran et son composant, messages d'erreur en français ;
  - SEO et GEO : robots.txt ouvert aux robots IA, `llms.txt` tiré des données, FAQ structurée sans les réponses « à confirmer » ;
- dans le navigateur :
  - connexion, prévisualisation protégée, fermeture d'un bandeau mémorisée ;
  - popup en fenêtre sur ordinateur et en panneau bas sur mobile (jamais avant un geste du visiteur) ;
  - sur le site publié : pages vues, temps actif et défilement, TTFB, recherche de dates et clics vers le moteur bien enregistrés ;
  - dans l'admin, les 34 écrans s'ouvrent sans erreur ;
  - parcours complet : modifier un texte → le traduire → prévisualiser → publier → restaurer la version précédente ;
  - ajout d'un concert, envoi d'une photo avec point d'intérêt, contrôles SEO ;
  - éditeur Live Music : menu réduit, écrans interdits, bandeau partagé sans perte des emplacements des autres pages ;
  - traducteur : ses langues modifiables, les autres en lecture seule, pas de publication ;
  - affichage sur téléphone (375 px).

## Installation

Node.js 22 ou plus (24 LTS conseillé sur le serveur). `ffmpeg` et `ffprobe` pour les vidéos.

Pas à pas pour un PC Windows, avec les problèmes courants : [docs/INSTALLATION-LOCALE.md](../docs/INSTALLATION-LOCALE.md). Sur un dépôt cloné, `npm run import` garde les gabarits versionnés de `templates-src/` et remplit seulement la base et `media/`.

```bash
npm install
cp .env.example .env
npm run import                                   # une seule fois : importe le site actuel
node server/cli.js media:import-site             # télécharge les photos du site actuel dans la médiathèque
node server/cli.js user:add vous@exemple.fr admin --name="Votre nom"
npm start
```

La commande `user:add` affiche le mot de passe une seule fois. Se connecter ensuite sur `/admin/`.

## Commandes

| Commande | Effet |
|---|---|
| `npm run import` | Importe le site actuel (une seule fois ; `-- --force` pour tout réimporter). |
| `npm run build:preview` | Génère `preview/` depuis la base de travail, brouillons et langues incomplètes compris. Option `-- --date=AAAA-MM-JJ` pour voir le site à une autre date (bandeaux et popups programmés). |
| `npm run publish` | Fige le contenu (snapshot), génère la version et la met en ligne. Rien n'est créé si le site n'a pas changé. |
| `npm run rebuild` | Régénère la version en ligne depuis son snapshot (ce que fait le cron chaque nuit). |
| `npm run restore` | Remet en ligne la version précédente. `-- 18` pour une version donnée ; `-- --with-content` pour restaurer aussi le contenu (sauvegarde automatique avant). |
| `npm run builds` | Liste les derniers builds et la version en ligne. |
| `node server/cli.js user:add <email> <admin\|editor\|translator> [--name=…] [--langs=en,it] [--scopes=live-music]` | Crée un compte (`--scopes` : éditeur limité à un périmètre). |
| `node server/cli.js user:password <email>` | Nouveau mot de passe (les sessions ouvertes sont fermées). |
| `node server/cli.js media:import-site` | Range les photos du site actuel (encore sur son CDN) dans la médiathèque et relie les gabarits, les fiches chambre et service, l'image de partage et le JSON-LD. Relançable : ne télécharge que ce qui manque. Les emplacements sont listés dans `templates-src/photos.json`. |
| `node server/cli.js media:gc` | Efface les médias supprimés que plus aucune version conservée n'utilise (fait aussi chaque nuit). |
| `node server/cli.js stats:aggregate` | Agrégats quotidiens des statistiques et purge des données anciennes (fait aussi chaque nuit). |
| `node scripts/i18n-export.mjs` | Exporte tous les textes traduisibles du français (textes, pages et référencement, fiches, textes alternatifs, bandeaux, popups) dans `storage/translations/source.fr.json`, pour une traduction hors ligne. |
| `node scripts/i18n-import.mjs <fichier.json> [--dry]` | Réimporte une traduction de même forme (champ `lang`) par l'API, serveur lancé : tout arrive en **brouillon** et figure au Journal. Signale d'abord les balises, liens, variables `{…}` ou nombres qui diffèrent du français ; `--dry` s'arrête là. |
| `node scripts/i18n-ready.mjs <langue> [--dry]` | Passe en « prêt » tous les brouillons d'une langue (même valeur, seul le statut change), par l'API : chaque écriture figure au Journal. Il reste à publier. |
| `node server/cli.js geoip:update [--city]` | Télécharge la base de géolocalisation DB-IP Lite du mois dans `storage/geoip/` (pays ; pays et région avec `--city`, environ 130 Mo). À relancer chaque mois. |
| `npm start` | Serveur : API, prévisualisation protégée, site, réception des statistiques, cron de minuit (régénération, nettoyage des médias, agrégats des statistiques). |
| `npm test` | Tests automatiques. |

En local, `SERVE_LEGACY=1` sert aussi le site actuel sous `/legacy/`, pour comparer avec la prévisualisation.

## Interface d'administration

Mode d'emploi pour les utilisateurs : [docs/guide-utilisateur.md](../docs/guide-utilisateur.md) (version HTML : [guide-utilisateur.html](../docs/guide-utilisateur.html)).

Sur `/admin/`, sans étape de build : Alpine.js 3.17.4, Tailwind CSS 4.3.3 (version navigateur) et Chart.js 4.5.1, servis par le serveur depuis `node_modules` (versions figées dans `package.json`, aucun CDN tiers). Politique de sécurité (CSP) stricte sur `/admin`.

| Écran | Ce qu'on y fait |
|---|---|
| Accueil | Version en ligne, prévisualisation, statistiques de la semaine, avancement des traductions, SEO ; prochains concerts pour l'éditeur Live Music. |
| Pages | Arborescence et état de chaque langue. Par page : **textes** (le texte d'origine en regard pour traduire, enregistrement dès qu'on quitte le champ), **référencement** (adresse, title, description avec compteurs, mot-clé, partage, `noindex`, aperçu Google, contrôles sur la page générée), **réglages** (active, plan du site, page parente). |
| Textes communs, Textes de l'interface | En-tête, pied de page ; textes du JavaScript (réservation, avis, formulaires, chat). |
| Menus et liens | Menu principal, menu mobile (avec sous-menus), pied de page, cartes du restaurant et du bar, liens de la page Séminaires : libellé par langue, cible (page, document PDF, adresse), ordre, masquer, ajouter, supprimer. |
| Fiches et listes | Chambres, services, équipements, avis, réponses du chat, programme Live Music, artistes : formulaire adapté à chaque collection. En traduction, seuls les champs traduisibles sont modifiables ; une traduction incomplète part en brouillon. |
| Médiathèque | Envoi par glisser-déposer, dossiers, recherche, corbeille ; textes alternatifs par langue, point d'intérêt du recadrage portrait (un clic sur la photo), crédit, liens YouTube / Vimeo ; documents PDF (cartes). |
| Bandeaux, Popup | Texte par langue, aperçu, style et couleurs, lien (page, fiche, moteur de réservation, adresse), dates, emplacements ou pages concernées, déclenchement et fréquence du popup. |
| Traductions, Langues | Avancement par langue et par module, liste de ce qui reste avec un lien vers le bon écran ; ajout, activation et ordre des langues. |
| Publication et versions, Rapport SEO | Historique des générations, restauration d'une version conservée (avec ou sans le contenu) ; remarques SEO regroupées par page. |
| Statistiques | Semaine, mois ou année comparés à la période précédente ; filtres canal, appareil, langue, pays ; canaux (dont assistants IA), entonnoir, calendrier de la demande, bandeaux et popup, pages, contacts, chat, 404, Core Web Vitals ; exports CSV. |
| Redirections, Utilisateurs, Réglages, Journal | Anciennes adresses ; comptes (mot de passe généré et montré une seule fois) ; nom du site, langue x-default, moteur de réservation, avis, données structurées ; qui a modifié quoi. |
| Mon compte | Mot de passe ; « ne pas compter mes visites » sur les ordinateurs de l'hôtel. |

Les boutons **Prévisualiser** et **Publier** sont en haut de chaque écran. Une modification non enregistrée est signalée avant de quitter l'écran ou de changer de langue.

## Rôles

| Rôle | Peut |
|---|---|
| `admin` | Tout, y compris les utilisateurs, les langues, les réglages et le journal d'audit. |
| `editor` | Contenus en français, collections, médias, bandeaux, popup, redirections, prévisualiser, publier, restaurer. |
| `translator` | Traduire dans les langues qui lui sont attribuées (textes, pages, fiches, textes alternatifs, bandeaux, popup) et prévisualiser. |
| `editor` limité à `live-music` | La page Live Music (textes en français), le programme des concerts et les fiches artistes, ses bandeaux (texte, dates, emplacements sur sa page) et les médias du dossier `/live-music`. Il prévisualise et publie : seule la partie Live Music part en ligne, les brouillons des autres restent en attente. Pas de restauration, de popup, de réglages, de redirections ni de statistiques. |

Les périmètres sont décrits dans `server/auth/scopes.js`. Pour en ajouter un autre (par exemple un restaurant), il suffit d'y déclarer ses pages, ses collections et son dossier de médias.

Sécurité : mots de passe argon2id ; session en cookie `HttpOnly` / `SameSite=Strict` (le jeton n'est stocké en base que sous forme d'empreinte) ; en-tête `x-csrf-token` exigé pour toute écriture ; 10 tentatives de connexion par quart d'heure ; texte riche nettoyé (liste blanche) ; journal d'audit de chaque modification.

## API (préfixe `/api`)

| Module | Routes principales |
|---|---|
| Connexion | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password` |
| Langues | `GET /languages`, `POST /languages`, `PATCH /languages/:code` |
| Pages et SEO | `GET /pages`, `GET/PATCH /pages/:id`, `PUT /pages/:id/i18n/:lang` (adresse, title, description, Open Graph, mot-clé principal ; une adresse publiée qui change crée une redirection 301) |
| Textes | `GET /entries?page=&scope=global\|ui&q=`, `PUT /entries/:id/:lang` |
| Collections | `GET /collections`, `GET/POST /collections/:key/items`, `GET/PATCH/DELETE /items/:id`, `PUT /items/:id/i18n/:lang`, `PUT /items/:id/media` |
| Menus et liens | Collection `links` (`/collections/links/items`) : `list`, `parent` (clé du lien principal, sous-menu du menu mobile), `kind` = `page` (`page` = clé de page), `media` (`media` = identifiant d'un PDF ou d'une image) ou `url` (`https://`, `mailto:`, `tel:`, `/chemin`), `label` traduit. `GET /link-lists` (listes déclarées dans les gabarits), `PUT /link-lists/:key/order` (identifiants dans l'ordre). Supprimer un lien principal supprime ses sous-liens. |
| Médias | `GET /media`, `GET /media/folders`, `POST /media` (multipart, champ `file`), `POST /media/embed`, `GET/PATCH/DELETE /media/:id`, `PUT /media/:id/i18n/:lang` |
| Bandeaux | `GET /zones`, `GET/POST /banners`, `GET/PATCH/DELETE /banners/:id`, `PUT /banners/:id/i18n/:lang`, `PUT /banners/:id/placements` |
| Popup | `GET/POST /popups`, `GET/PATCH/DELETE /popups/:id`, `PUT /popups/:id/i18n/:lang`, `PUT /popups/:id/pages` |
| Traductions | `GET /translations/status`, `GET /translations/todo?lang=&module=&state=` |
| SEO | `GET /seo/report`, `GET /seo/pages/:id/:lang` (contrôles et aperçu Google sur le rendu réel de la page) |
| Programme Live Music | Collection `gigs` (`/collections/gigs/items`) : date `AAAA-MM-JJ`, heure `HH:MM`, lieu `selon-meteo`, `moon-bar` ou `aston-club`, `artist` (clé d'une fiche artiste, obligatoire), `description` (précisions sur la soirée, traduites ; vide = présentation de l'artiste) et, pour les concerts d'avant les fiches, `style` s'il diffère de celui de l'artiste. Les concerts à venir sont écrits dans la page avec la photo et le lien de l'artiste, et leurs données `MusicEvent` (`performer` = `MusicGroup` avec nom, genre, présentation, image, `url` et `sameAs`). |
| Artistes | Collection `artists` (`/collections/artists/items`) : `name` (obligatoire), `website` (facultatif, `https://…`), `media` (photo de la médiathèque), `style` et `bio` traduits. Un artiste programmé ne peut pas être supprimé ; masquer un artiste retire ses concerts du site. Dans le formulaire d'un concert, l'artiste se choisit dans la liste ou se crée sur place (« + Nouvel artiste »). Les concerts saisis avant les fiches (nom libre) sont convertis au démarrage, sans perte (`server/db/gig-artists.js`). |
| Statistiques | `POST /track` (public, sans cookie, réponse `204`) ; `GET /analytics/summary`, `/analytics/timeseries`, `/analytics/top?dim=`, `/analytics/funnel`, `/analytics/demand`, `/analytics/vitals`, `/analytics/export.csv?report=` (administrateurs et éditeurs sans périmètre) |
| Builds | `GET /builds`, `GET /builds/:id`, `POST /builds/preview`, `POST /builds/publish`, `POST /builds/restore-previous`, `POST /builds/:id/restore` |
| Administration | `GET/POST/PATCH/DELETE /users`, `GET/PATCH /settings`, `GET/POST/DELETE /redirects`, `GET /audit`, `POST /maintenance/media-gc` |

Dates (bandeaux, popup, offres) : « AAAA-MM-JJTHH:MM » est lu à l'heure de Paris.

Paramètres des statistiques :
- **Période** : `period=week|month|year` et `date=AAAA-MM-JJ`. On obtient la période qui contient cette date, comparée à la précédente.
- **Filtres** : `lang`, `country`, `device`, `channel`.
- **Classements** (`dim`) :
  - visites : `channel`, `referrer`, `utm_source`, `utm_campaign`, `entry`, `exit` ;
  - audience : `country`, `region`, `lang`, `browser_lang`, `device` ;
  - comportement : `page`, `source` (bouton ou formulaire de réservation), `element` (bandeaux et popup : vues, clics, clics de réservation attribués), `chat`, `not_found`, `contact`.

## Comment ça marche

1. **Gabarits** (`templates-src/`) : chaque texte porte une clé (`data-cms-key`, `data-cms-html`, `data-cms-text`, `data-cms-attr`) dont la valeur est en base, par langue. Une image de la médiathèque se place avec `data-cms-media="clé"` sur un `<img>` : le build écrit le `<picture>` WebP. Les emplacements de bandeaux sont des `data-cms-zone` : `top-bar`, `hero-sub`, `section-intercalaire`, `footer-cta`. Une liste de liens modifiable est un `<ul data-cms-links="clé" data-cms-links-label="Nom dans l'admin">` : ses liens d'origine sont repris dans la collection `links` au démarrage, traductions comprises (`server/ssg/link-lists.js`), puis le build reconstruit la liste depuis la base en gardant le premier `<li>` comme modèle.
2. **Prévisualiser** : génère toutes les langues actives dans `preview/` (réservé aux personnes connectées). Les textes non traduits retombent sur le français et sont entourés en orange.
3. **Publier** : copie les tables `cms_*` dans un snapshot, génère depuis cette copie dans `releases/<id>/`, puis fait pointer `public-dist` vers cette version. Une page n'est publiée dans une langue que si tous ses textes, y compris ceux du JavaScript, y sont traduits.
4. **Bandeaux** : rendus s'ils sont actifs dans les 25 prochaines heures, avec `data-start` / `data-end` ; un script du `<head>` les affiche ou les masque à la bonne heure et applique la fermeture choisie par le visiteur, avant l'affichage. Le bandeau Live Music du site actuel est devenu le bandeau n° 1 (zone `top-bar`, 6 pages restaurant et bar).
5. **Popup** : un par page au plus (le plus prioritaire), `popup.js` chargé seulement là ; déclencheur délai, défilement ou intention de sortie ; fréquence mémorisée ; panneau bas sur mobile, après un geste du visiteur.
6. **Médias** : type réel vérifié, doublons détectés, WebP 640 / 1024 / 1600 / 2400 px + recadrage portrait autour du point d'intérêt + miniature ; vidéos mesurées et poster extrait ; PDF servis tels quels sous un nom lisible (`v/<empreinte>-carte-des-vins.pdf`) ; suppression douce, effacement définitif la nuit si aucune version conservée ne s'en sert.
7. **Textes du JavaScript** : 57 entrées `ui.*` (module de réservation, avis, formulaires, chat, bouton du bas, bandeaux, popup), passées au navigateur dans `#site-config.i18n`.
8. **Statistiques** (niveau 1, sans cookie ni bandeau de consentement) :
   - **Script** : `track.js` (17 Ko, 6,5 Ko compressé, `web-vitals` compris) est ajouté au site publié seulement, jamais à la prévisualisation. Il ne mesure rien dans trois cas :
     - le navigateur envoie *Do Not Track* ;
     - le navigateur envoie *Global Privacy Control* ;
     - le poste a `localStorage['aston.no-stats'] = '1'` (à régler sur les ordinateurs de l'hôtel).
   - **Ce qu'il envoie** :
     - pages vues et 404, temps actif et défilement, Core Web Vitals ;
     - recherches de dates et clics vers le moteur, avec leur source (formulaire, fiche chambre, offre, bouton d'en-tête…) et le bandeau ou popup qui a mené là dans les 30 minutes ;
     - vues et clics des bandeaux et du popup ;
     - téléphone, e-mail, plan, changement de langue, liens sortants ;
     - questions du chat, demandes de devis, vidéos lues.
   - **Confidentialité** : le serveur ne garde ni l'adresse IP ni le navigateur. Un visiteur est une empreinte (sel du jour + IP + navigateur), et le sel est effacé le surlendemain. On ne peut donc pas relier une même personne d'un jour à l'autre. Les robots sont écartés.
   - **Canaux** : direct, recherche naturelle, publicité, réseaux sociaux, e-mail, comparateurs (Booking, Expedia, Trivago…), **assistants IA** (ChatGPT, Perplexity, Gemini, Copilot, Claude…), sites référents.
   - **Chaque nuit** : agrégats par jour. Les événements sont purgés après 13 mois, les agrégats après 25 mois.
   - **Pays et région** : ils demandent la base DB-IP (`geoip:update`). Sans elle, tout fonctionne, sauf le pays et la région.

## Pas encore fait

- **Base GeoIP** : pas encore téléchargée (`node server/cli.js geoip:update`, puis chaque mois). La licence CC BY 4.0 demande la mention « IP Geolocation by DB-IP » avec un lien vers db-ip.com : le tableau de bord l'affiche dès que la base est installée.
- **Politique de confidentialité** : paragraphe sur la mesure d'audience prêt dans [`docs/confidentialite-mesure-audience.md`](../docs/confidentialite-mesure-audience.md), à faire valider par l'hôtel.
- **Redirections des anciennes adresses** de hotel-aston.com : la table est prête, la liste des pages en ligne reste à relever.
- **Liens externes (YouTube, Vimeo…)** : enregistrés dans la médiathèque, affichés pour l'instant comme un simple lien (lecteur chargé au clic à venir).
- **Déploiement** : fichiers prêts dans [`deploy/`](../deploy/README.md) (Caddyfile, PM2, Dockerfile, sauvegardes) ; restent l'hébergeur et le stockage externe des sauvegardes.
