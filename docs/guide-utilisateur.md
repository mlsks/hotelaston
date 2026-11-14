# Guide utilisateur du back-office

Hôtel Aston La Scala · Mis à jour le 2 novembre 2026

Ce guide explique comment faire vivre le site de l'hôtel depuis le back-office : modifier un texte, changer une photo, annoncer un concert, traduire, publier, revenir en arrière. Il s'adresse aux personnes qui utilisent l'admin au quotidien, sans connaissance technique.

Le guide existe en deux versions qui disent la même chose : [guide-utilisateur.md](guide-utilisateur.md) (à modifier) et [guide-utilisateur.html](guide-utilisateur.html) (à lire ou imprimer). Il se lit aussi dans l'admin : menu de gauche, rubrique **AIDE** → **Manuel d'utilisation**. Pour les mettre à jour, voir [Tenir ce guide à jour](#tenir-ce-guide-a-jour).

## L'essentiel en une minute

- **Le site public est fait de pages fixes**, générées par le back-office. Une modification enregistrée n'est donc **pas visible tout de suite** sur le site : elle l'est dans la **prévisualisation**, puis sur le site après **Publier**.
- **Prévisualiser** et **Publier** sont en haut de chaque écran.
- Les textes s'enregistrent **dès qu'on quitte le champ** (la mention « Enregistré ✓ » apparaît). Les formulaires plus longs (fiches, bandeaux, popup, réglages) ont un bouton **Enregistrer**, et l'admin prévient avant de quitter un écran non enregistré.
- **Une page n'est publiée dans une langue que si tous ses textes y sont prêts.** Sinon, seule la version française de cette page est en ligne : jamais de page à moitié traduite.
- **On peut toujours revenir en arrière** : les trois dernières versions publiées sont conservées et se restaurent en un clic.

## Où trouver quoi

Le menu de gauche est rangé sous des titres en petites capitales grises : **CONTENU**, **LANGUES**, **SITE**, **ADMINISTRATION**, **AIDE**. Sur un petit écran, il s'ouvre avec le bouton ☰ en haut à gauche. Le tableau donne le chemin exact, clic par clic.

| Je veux… | Où cliquer |
|---|---|
| Changer un texte d'une page | **CONTENU** → **Pages** → cliquer sur la page → onglet **Textes** ; le champ **Rechercher un texte…** retrouve un mot. Voir [Pages](#pages). |
| Changer une photo d'une page | Même chemin, puis **Changer l'image** à côté de la photo. Voir [Médiathèque](#mediatheque). |
| Changer un texte présent sur toutes les pages (en-tête, pied de page, chat, mentions légales du bas) | **CONTENU** → **Textes communs**. Voir [Textes communs](#textes-communs). |
| Changer un lien du menu ou du pied de page | **CONTENU** → **Menus et liens**. Voir [Menus et liens](#menus-et-liens). |
| Changer un plat ou un prix d'une carte du restaurant ou des bars | **CONTENU** → **Cartes du restaurant** → cliquer sur la carte. Voir [Cartes du restaurant](#cartes-du-restaurant). |
| Modifier une chambre, un service, une offre, un article du blog, une salle de séminaire, une réponse du chat | **CONTENU** → **Fiches et listes** → cliquer sur la carte de la liste (**Chambres**, **Services**, **Offres**, **Blog (articles)**, **Salles de séminaire**, **Réponses du chat**). Voir [Fiches et listes](#4-fiches-et-listes). |
| Ajouter un concert | **CONTENU** → **Fiches et listes** → **Programme Live Music** → **Ajouter un concert**. Voir [Live Music](#5-live-music-concerts-et-artistes). |
| Gérer les avis Google | **CONTENU** → **Avis Google**. Voir [Les avis Google](#les-avis-google). |
| Envoyer une photo, une vidéo ou un PDF | **CONTENU** → **Médiathèque** → **Envoyer des fichiers**. |
| Afficher un message en haut d'une page | **CONTENU** → **Bandeaux** → **Nouveau bandeau**. Voir [Bandeaux](#bandeaux). |
| Ouvrir une fenêtre (popup) sur le site | **CONTENU** → **Popup** → **Nouveau popup**, ou depuis une offre : **Promouvoir en popup**. Voir [Popup](#popup). |
| Régler le dégradé derrière le texte d'un grand bandeau photo | **CONTENU** → **Fiches et listes** → **Bandeaux photo (HERO)** (dernière carte). Voir [Les bandeaux photo (HERO)](#les-bandeaux-photo-hero). |
| Changer le title et la description d'une page dans Google | **CONTENU** → **Pages** → cliquer sur la page → onglet **Référencement (SEO)**. Voir [Référencement](#9-referencement-seo). |
| Traduire | L'onglet de la langue en haut de l'écran voulu, ou **LANGUES** → **Traductions** pour la liste de ce qui reste. Voir [Traduire le site](#7-traduire-le-site). |
| Mettre une langue en ligne | **LANGUES** → **Langues du site** → cliquer sur **Inactive** dans la ligne de la langue, puis **Publier**. |
| Mettre le site à jour | Bouton **Publier**, en haut à droite de chaque écran. |
| Revenir à une version précédente | **SITE** → **Publication et versions** → **Restaurer**. Voir [Publication et versions](#publication-et-versions). |
| Rediriger une ancienne adresse | **SITE** → **Redirections**. |
| Régler le moteur de réservation D-Edge ou le seuil de la note Google | **ADMINISTRATION** → **Réglages**. Voir [Réglages](#reglages). |
| Créer un compte | **ADMINISTRATION** → **Utilisateurs** → **Nouveau compte**. |
| Ne plus compter mes visites dans les statistiques | Rond avec l'initiale, en haut à droite → **Mon compte**. |
| Découvrir l'admin, ou le faire découvrir | **AIDE** → **Prise en main** → **Lancer la visite guidée**. Voir [L'aide dans l'admin](#l-aide-dans-l-admin). |
| Lire ce guide sans quitter l'admin | **AIDE** → **Manuel d'utilisation**. |

## 1. Démarrer le back-office

### Sur le PC de développement

L'installation complète (Node.js, premier lancement, problèmes courants) est décrite dans [INSTALLATION-LOCALE.md](INSTALLATION-LOCALE.md). Une fois installé :

1. Ouvrir un terminal dans le dossier du projet, puis :

   ```bash
   cd Backend
   npm start
   ```

2. Laisser ce terminal ouvert : fermer la fenêtre arrête le serveur.
3. Ouvrir http://127.0.0.1:3020/admin/ dans le navigateur.

| Adresse | Ce qu'on y trouve |
|---|---|
| http://127.0.0.1:3020/admin/ | Le back-office |
| http://127.0.0.1:3020/fr/ | Le site publié |
| http://127.0.0.1:3020/preview/fr/ | La prévisualisation (personnes connectées seulement) |

Sur le PC de développement, consulter `/fr/` ajoute des visites aux statistiques : ce n'est pas grave, mais ces chiffres ne veulent rien dire tant que le site n'est pas en ligne.

### Après une mise à jour du code

Quand une modification du back-office ou du site a été fusionnée sur GitHub, elle n'arrive sur le PC qu'en trois temps :

1. Dans le terminal du serveur, **Ctrl + C** pour l'arrêter.
2. Récupérer le code, puis relancer :

   ```bash
   git pull
   cd Backend
   npm start
   ```

   (Si `git pull` a changé `Backend/package.json`, lancer `npm install` dans `Backend` avant `npm start`.)
3. Ouvrir l'admin et cliquer sur **Publier** : le site publié est régénéré avec le nouveau code. Certaines mises à jour ajoutent des textes ou des traductions au démarrage du serveur ; ils apparaissent alors dans l'admin.

### Voir le site sur un téléphone (même Wi-Fi)

Pour regarder le site du PC sur un téléphone ou une tablette branchés sur la même box : dans `Backend/.env`, mettre `HOST=0.0.0.0`, relancer le serveur, puis ouvrir sur le téléphone `http://` suivi de l'adresse du PC sur le réseau, puis `:3020/fr/` (par exemple http://192.168.1.5:3020/fr/ ; la commande `ipconfig` du PC donne cette adresse, ligne « Adresse IPv4 »). Le back-office devient alors joignable par tout appareil du réseau : à faire seulement chez soi, pas sur un Wi-Fi public.

### Sur la démo en ligne (Render)

La démo hébergée sur Render est une copie séparée : son contenu (textes, photos, comptes) est celui qui y a été copié depuis le PC, et ce qu'on modifie dans l'admin de la démo ne revient pas sur le PC (ni l'inverse). Elle est marquée « à ne pas indexer » (`NOINDEX=1`) : Google ne la référence pas.

Après une mise à jour du code sur GitHub : dans Render, **Manual Deploy** sur le service, attendre la fin, puis ouvrir l'admin de la démo (`/admin/` au bout de son adresse) et cliquer sur **Publier**. Sur la démo, envoyer une vidéo dans la médiathèque échoue (pas de ffmpeg chez Render) ; les vidéos déjà présentes s'affichent. La mise en place est décrite dans [deploy/README.md](../deploy/README.md), section « Démo sur Render ».

### Se connecter

Saisir son e-mail et son mot de passe. Les comptes sont créés par un administrateur (voir [Utilisateurs](#utilisateurs)) ; les identifiants de développement sont dans le fichier `Backend/.dev-credentials`, qui n'est pas versionné. Après 10 tentatives manquées, la connexion est bloquée un quart d'heure. La session dure 12 heures.

Le menu du compte (rond avec l'initiale, en haut à droite) donne accès à **Mon compte** et à **Se déconnecter**.

### Ce que chacun peut faire

| Rôle | Peut |
|---|---|
| Administrateur | Tout, y compris les utilisateurs, les langues, les réglages et le journal. |
| Éditeur | Les contenus en français, les fiches, la médiathèque, les bandeaux, le popup, les redirections ; prévisualiser, publier, restaurer. |
| Traducteur | Traduire dans ses langues (les autres restent en lecture seule) et prévisualiser. Il ne publie pas. |
| Éditeur Live Music | La page Live Music, le programme des concerts, les fiches artistes, ses bandeaux et les médias du dossier `/live-music`. Il publie seulement sa partie (voir [Live Music](#5-live-music-concerts-et-artistes)). |

Le menu de gauche ne montre que les écrans autorisés pour le compte connecté.

## 2. Se repérer dans l'admin

Le menu de gauche est rangé en six groupes (sur un petit écran, il s'ouvre avec le bouton ☰ en haut à gauche) :

| Groupe | Écrans |
|---|---|
| (en haut) | **Accueil** : version en ligne, prévisualisation, statistiques de la semaine, avancement des traductions, rapport SEO. |
| Contenu | **Pages**, **Textes communs**, **Menus et liens**, **Cartes du restaurant**, **Textes de l'interface**, **Fiches et listes**, **Avis Google**, **Médiathèque**, **Bandeaux**, **Popup**. |
| Langues | **Traductions**, **Langues du site**. |
| Site | **Publication et versions**, **Rapport SEO**, **Statistiques**, **Redirections**. |
| Administration | **Utilisateurs**, **Réglages**, **Journal des modifications**. |
| Aide | **Prise en main**, **Manuel d'utilisation** (pour tous les rôles). |

### L'aide dans l'admin

La rubrique **AIDE**, tout en bas du menu, est la même pour tous les comptes :

- **Prise en main** :
  - **Lancer la visite guidée** : une bulle montre tour à tour chaque entrée du menu (seulement celles du compte connecté), puis les boutons **Prévisualiser**, **Publier** et **Mon compte**, avec ce qu'on y fait. **Suivant** et **Précédent** (ou les flèches du clavier) pour avancer, **Quitter** (ou Échap) pour arrêter. Sur un petit écran, le menu s'ouvre tout seul pendant la visite.
  - **Votre première modification** : cinq étapes (ouvrir une page, modifier un texte, prévisualiser, publier, savoir revenir en arrière), chacune avec une case **Fait**. Les cases cochées sont retenues dans ce navigateur seulement.
  - **Cinq règles à retenir** et des liens vers les sections utiles de ce guide.
- **Manuel d'utilisation** : ce guide, affiché dans l'admin. **Ouvrir dans un onglet (imprimer)** l'ouvre en pleine page. Il suit toujours la dernière version du guide présente sur le serveur : après un `git pull`, rien d'autre à faire.

Sur l'**Accueil**, une carte « Nouveau dans le back-office ? » propose la visite guidée et la prise en main, jusqu'à ce qu'on clique sur **Masquer** (retenu dans ce navigateur). La rubrique **AIDE** reste toujours dans le menu.

### La langue de travail

Les écrans qui contiennent du texte (pages, textes, fiches, bandeaux, popup) ont une rangée d'**onglets de langue** en haut. Le français est la langue d'origine. Dans une autre langue, le texte français est affiché en regard, pour traduire (voir [Traduire le site](#7-traduire-le-site)).

### Le cycle d'une modification

1. **Modifier** dans l'écran voulu ; c'est enregistré dans la base de travail.
2. **Prévisualiser** (bouton en haut) : le site est généré tel qu'il sera publié, brouillons et langues incomplètes compris. Un bandeau « Prévisualisation » est affiché en bas à gauche, et les textes non traduits sont entourés en orange.
3. **Publier** : le site est figé et mis en ligne.

## 3. Modifier les textes

### Pages

**Pages** liste toutes les pages du site avec leur adresse et l'état de chaque langue. Une recherche permet de filtrer. Chaque page a trois onglets, et quatre pour les pages qui ont des [blocs](#blocs-d-une-page) :

- **Textes** : tous les textes de la page, rangés par section, et ses photos (bouton **Changer l'image**). Les textes enrichis (gras, liens) ont une petite barre d'outils. Le champ de recherche en haut retrouve un texte précis.

Dans un texte enrichi (pages, fiches, popup), un texte copié depuis Word ou un e-mail est collé sans sa mise en forme, à refaire avec la barre d'outils. Du **code HTML** collé (qui commence par une balise, comme `<p>` ou `<div>`) est au contraire appliqué : titres `h2` à `h4`, paragraphes, listes, gras, italique et liens sont gardés, le reste (blocs `div`, classes, styles, images) est retiré. Le bouton **HTML** de la barre montre et modifie directement le code.
- **Blocs** (Restaurant & bar, L'Horloge, Moon Bar, Aston Club, Séminaires et ses trois pages guides) : voir [Blocs d'une page](#blocs-d-une-page).
- **Référencement (SEO)** : voir [Référencement](#9-referencement-seo).
- **Réglages** :
  - **Page active** : une page désactivée n'est plus générée ni publiée ;
  - **Dans le plan du site (sitemap.xml)** ;
  - **Page parente** et **Ordre** (place dans le menu et le fil d'Ariane) ;
  - **Priorité dans le plan du site** (laisser « Automatique » en cas de doute) ;
  - **Dégradé derrière le texte du bandeau photo** (Accueil, Séminaires et Moon Bar) : un voile léger part de la gauche (du bas sur mobile) et une ombre douce détache le texte blanc, sans assombrir le reste de la photo. **Opacité** (50 % au départ) et **Étendue vers la droite** (70 %) se règlent au curseur ; **Revenir au réglage d'origine** remet ceux du site. Décoché, le bandeau de l'accueil et la photo du Moon Bar gardent leur voile d'origine. Enregistrer, puis vérifier dans la prévisualisation. Tous les bandeaux se règlent aussi sur un seul écran : voir [Les bandeaux photo (HERO)](#les-bandeaux-photo-hero).

### Blocs d'une page

L'onglet **Blocs** liste les sections de la page et, en retrait sous chacune, ses lignes : photos du bandeau, paragraphes, infos pratiques (horaires, capacité…), questions fréquentes, lieux de la page Restaurant & bar, chiffres clés et photos des pauses de la page Séminaires, lignes des listes des pages guides. Pour chaque bloc :

- **↑ ↓** : le monter ou le descendre (une ligne reste dans sa section) ;
- **Masquer** / **Afficher** : un bloc masqué reste dans la liste, barré, et disparaît du site ;
- **Dupliquer** : ajoute une copie juste après, marquée « copie », avec les mêmes textes, photos et traductions. Le bouton **Textes** de la copie ouvre l'onglet Textes sur ses seuls textes (leur clé finit par `~` suivi d'un numéro) : les modifier comme les autres. Dupliquer une section copie aussi ses lignes ;
- **Supprimer** (copies seulement) : retire la copie et ses textes. Un bloc d'origine se masque.

Une copie d'un lieu de la page Restaurant & bar a son propre **Lien** dans l'onglet Textes (`#/` suivi du nom d'une page, par exemple `#/live-music`). Les chiffres clés de la page Séminaires se modifient aussi dans l'onglet Textes ; le compteur animé suit le nouveau chiffre. Liens et chiffres valent pour toutes les langues.

Les changements de blocs apparaissent dans la prévisualisation, puis sur le site à la publication. Le tableau des salles de la page Séminaires ne se règle pas ici mais dans les fiches : voir [Les salles de séminaire](#les-salles-de-seminaire).

### Textes communs

L'en-tête, le pied de page, le fil d'Ariane des fiches, le bouton du bas sur mobile, le chat : les textes présents sur toutes les pages. Une modification ici change toutes les pages à la prochaine publication. Les liens des menus et du pied de page ne sont plus ici : voir [Menus et liens](#menus-et-liens).

Les **mentions légales** du bas du pied de page (codes GDS, nom de la société, SIRET, SIREN, RCS, APE, TVA intracommunautaire, médiateur de la consommation) sont ici aussi, dans le groupe **Pied de page · Mentions légales** : trois textes, un par paragraphe. Elles sont livrées traduites dans toutes les langues : seuls les libellés (« Nom », « Adresse », « Site internet », « Médiateur de la consommation »…) changent d'une langue à l'autre ; les numéros, les noms propres et l'adresse restent identiques. Si un numéro change, le corriger en français puis dans chaque langue (onglets de langue), sinon les autres langues gardent l'ancien.

### Page Mentions légales

La page **Mentions légales** (lien en bas du pied de page, dans toutes les langues) reprend celle de l'ancien site : éditeur, hébergeur, propriété intellectuelle, disponibilité du site, médiateur de la consommation, Bloctel, litiges, droit de rétractation. Elle se modifie comme les autres dans **Pages → Mentions légales → Textes**, une section par rubrique. Ses textes sont livrés traduits dans les 17 langues.

- **Hébergeur** : quatre champs à remplir une fois l'hébergeur choisi : **raison sociale**, **adresse postale**, **téléphone** et **site internet** (adresse complète, `https://…`). Ils valent pour toutes les langues : les saisir en français suffit. Tant qu'ils sont vides, la rubrique Hébergeur n'apparaît pas sur le site et la publication le rappelle dans ses avertissements ; un champ laissé vide masque seulement sa ligne. La loi demande le nom, l'adresse et le téléphone de l'hébergeur : à remplir avant la mise en ligne.
- **Directeur de la publication** : même principe (nom à saisir en français, ligne masquée tant qu'il est vide).
- **Société** (nom, SIRET, SIREN, RCS, APE, TVA) : c'est le même texte que dans le pied de page, modifiable dans **Textes communs → Pied de page · Mentions légales**. Le corriger là change la page et le pied de page.
- Les libellés (« Société : », « Adresse : »…) et les paragraphes se traduisent comme le reste ; changer un paragraphe en français fait passer ses traductions « à revoir ».

### Page Politique de confidentialité

La page **Politique de confidentialité** (lien « Confidentialité » en bas du pied de page et lien sous le formulaire de devis, dans toutes les langues) décrit ce que fait réellement le nouveau site : responsable du traitement, formulaires de devis et de contact et chat, réservation sur D-Edge, mesure d'audience, cookies et stockage dans le navigateur, services d'autres sociétés (Google Maps, liens externes), destinataires, transferts hors UE, durées de conservation, droits des visiteurs. Elle se modifie dans **Pages → Politique de confidentialité → Textes**, une section par rubrique (un titre et un texte), livrée traduite dans les 17 langues.

- **Date de mise à jour** : champ **Date de la dernière mise à jour** (section En-tête), au format 30/10/2026. Elle vaut pour toutes les langues : la saisir en français suffit. Tant qu'elle est vide, la ligne « Dernière mise à jour » n'apparaît pas et la publication le rappelle dans ses avertissements. La changer à chaque modification importante du texte.
- **Bouton « Ne plus compter mes visites »** (rubrique Mesure d'audience) : il permet au visiteur de refuser la mesure d'audience sur son appareil ; un second clic la rétablit. Ses libellés et le message « Vos visites ne sont pas comptées » se modifient dans la même section. Le bouton n'apparaît pas si le navigateur demande déjà à ne pas être suivi.
- **À revoir si le site change** : un formulaire qui enverrait ses données au serveur au lieu de préparer un e-mail, des polices chargées depuis un service externe (Google Fonts…), une newsletter, un nouveau service externe (vidéo, avis, carte…) ou l'option « visiteurs récurrents » des statistiques. Le texte décrit le site tel qu'il est : il faut le corriger en français, puis faire relire les traductions, qui passent « à revoir ».

### Menus et liens

**Menus et liens** regroupe toutes les listes de liens du site :

- **Sur toutes les pages** : le menu principal (en-tête sur ordinateur), le menu mobile (bouton ☰) et les trois colonnes du pied de page ;
- **Dans une page** : les cartes de L'Horloge, les cartes du Moon Bar, les liens « pour aller plus loin » de la page Séminaires. Le lien à droite du titre ouvre la page concernée.

Pour chaque lien :

- **Libellé** : le texte affiché, enregistré dès qu'on quitte le champ ;
- **Le lien mène à** : **une page du site** (choisie dans la liste : son adresse suit la langue du visiteur), **un document (PDF)** choisi dans la médiathèque (il s'ouvre dans un nouvel onglet) ou **une adresse internet** (`https://…`, `mailto:…` ou `tel:…`) ;
- **↑ ↓** : change l'ordre ;
- **→ Sous-menu** (menu mobile seulement) : range le lien sous le lien principal du dessus, comme Restaurant L'Horloge sous Restaurant & bar ; **← Sortir** le remet au premier niveau ;
- **Masquer** / **Afficher** : retire le lien du site sans le perdre ;
- **Supprimer** : définitif ; un lien principal emporte ses sous-liens.

**+ Ajouter un lien** ajoute un lien en fin de liste, vers l'accueil : changer son libellé et sa cible. Dans une autre langue que le français, seuls les libellés se traduisent ; l'ordre et les cibles valent pour toutes les langues. Un libellé pas encore traduit s'affiche en français.

Pour un document à télécharger (plaquette, menu de groupe en PDF) : l'envoyer dans la **Médiathèque** (ou directement depuis **Choisir…**), puis choisir **Un document (PDF)** sur le lien. Les cartes du restaurant et des bars, elles, sont des pages du site : voir [Cartes du restaurant](#cartes-du-restaurant).

### Cartes du restaurant

**Cartes du restaurant** liste les cartes, rangées par lieu (L'Horloge, Moon Bar, L'Aston Club). Chaque carte est une page du site, avec ses rubriques et ses plats. Les trois cartes de L'Horloge (la carte, les vins, les desserts) ont été reprises de l'ancien site, aux mêmes adresses (`/fr/menu-restaurant-horloge/`, `/fr/carte-vin-restaurant-horloge/`, `/fr/carte-dessert/`) : Google et les liens existants y mènent toujours. Leur traduction anglaise est préparée en **brouillon** : à relire dans chaque carte (onglet EN), puis à enregistrer sans cocher « brouillon » pour qu'elle soit publiée. Les libellés anglais des liens « Les cartes » sont aussi en brouillon, dans [Menus et liens](#menus-et-liens) (liste « Les cartes de L'Horloge », onglet EN).

- **Créer une carte** : en bas de l'écran, donner son nom, son lieu et l'adresse de sa page (proposée à partir du nom), puis **Créer la carte**. Elle est ajoutée aux liens « Les cartes » de la page du lieu (modifiables dans [Menus et liens](#menus-et-liens)).
- **Modifier une carte** : cliquer dessus.
  - **En-tête** : nom (titre de la page), sous-titre, lieu, texte du lien de retour vers le lieu, note en bas de carte (allergènes, prix nets…). Les champs facultatifs vides n'apparaissent pas.
  - **Rubriques** (Entrées, Vins rouges…) : renommer, monter ou descendre avec ↑ ↓, **Supprimer la rubrique**, **+ Ajouter une rubrique**.
  - **Plats** : nom, prix (texte libre : « 12 € », « 6 € / 32 € »), description facultative ; ↑ ↓ pour l'ordre, ✕ pour retirer, **+ Ajouter un plat**. Un plat sans nom n'est pas enregistré.
  - **Enregistrer** : rien n'est enregistré avant ce bouton ; l'admin prévient si on quitte l'écran avec des modifications en cours.
- **Masquer la carte** : sa page et les liens qui y mènent disparaissent du site à la prochaine publication ; **Réafficher la carte** les remet. Une carte ne se supprime pas.
- **Référencement (Google)** : title et description de la page, dans la carte elle-même, enregistrés avec elle. Les autres réglages (adresse, partage sur les réseaux) restent sous le lien **Référencement de la page**.

Dans une autre langue, la carte se traduit au même endroit : le français est en regard, seuls les libellés se traduisent (les prix et l'ordre valent pour toutes les langues). Le title et la description se traduisent dans la même page : **une carte n'est publiée dans une langue que si sa carte et son référencement sont « prêts »**, d'où les deux pastilles en haut. **Enregistrer** passe les deux au même état. Un plat pas encore traduit s'affiche en français. Supprimer ou déplacer un plat en français fait repasser la traduction « à revoir ».

### Textes de l'interface

Les textes affichés par le JavaScript du site : module de réservation, avis, formulaires, chat, bandeaux, popup. Les éléments entre accolades, comme `{count}`, sont remplacés par une valeur au moment de l'affichage : **il faut les garder tels quels**, y compris dans les traductions.

Ces textes ne retiennent pas une page : tant qu'un d'eux n'est pas traduit dans une langue, il s'affiche en anglais si l'anglais est prêt, sinon en français, et la page reste publiée dans cette langue.

## 4. Fiches et listes

**Fiches et listes** (menu de gauche, rubrique **CONTENU**) regroupe les contenus répétés du site, chacun avec un formulaire adapté. L'écran montre une carte par liste, avec son nombre d'éléments : cliquer sur la carte ouvre la liste, puis cliquer sur un élément ouvre sa fiche.

| Liste | Contenu |
|---|---|
| Chambres | Une fiche par catégorie : nom, titre, description, points clés, équipements, variantes, photos, thème des avis affichés, et ce qui s'affiche sur la page Chambres et dans le carrousel de l'accueil. Chaque fiche a sa propre page. Voir [Les chambres](#les-chambres). |
| Services | Une fiche par service : chapeau, texte, informations pratiques, questions fréquentes, photos. Chaque fiche a sa propre page. |
| Offres | Une fiche par offre : famille, photo, prix, ce qui est compris, économie, conditions, bouton, présence sur l'accueil. Voir [Les offres](#les-offres). |
| Blog (articles) | Un article par fiche : titre, rubrique, date, photo ou vidéo, résumé, texte, réglages Google. Chaque article a sa propre page sous la page Blog. Voir [Le blog](#le-blog). |
| Salles de séminaire | Une fiche par salle : nom, précisions, photo, surface et capacités. Voir [Les salles de séminaire](#les-salles-de-seminaire). |
| Équipements (pictogrammes) | Les pictogrammes et libellés utilisés par les fiches chambre, avec un **Libellé court** pour les cartes de l'accueil. |
| Réponses du chat | Les mots déclencheurs (si la question du visiteur en contient un, le chat donne cette réponse) et la réponse. Le chat ne propose pas de rappel téléphonique (retiré le 31/10/2026) : l'ancienne réponse « rappel » est désactivée, la réactiver ici la remet en service. Les pastilles du chat sont des raccourcis vers ces réponses : Parking (`parking`), Arrivée / départ (`horaires`), Depuis l'aéroport (`aeroport`), Petit-déjeuner (`petit-dejeuner`), Piscine (`piscine`), Restaurant (`restaurant`), Bars (`moonbar`), Séminaire (`devis`), Animaux (`animaux`). Pour changer ce que répond une pastille, modifier la réponse dont l'identifiant est entre parenthèses ; son libellé se change dans **Textes communs**, section **Toutes les pages · Réception · Aston La Scala**. En ajouter une demande une modification du gabarit. |
| Programme Live Music, Artistes (Live Music) | Voir [Live Music](#5-live-music-concerts-et-artistes). |
| Menus et liens, Cartes du restaurant et des bars | Raccourcis vers les écrans du même nom : voir [Menus et liens](#menus-et-liens) et [Cartes du restaurant](#cartes-du-restaurant). |
| Bandeaux photo (HERO) (dernière carte) | Le dégradé derrière le texte du grand bandeau en haut de l'Accueil, des Séminaires et du Moon Bar. Voir [Les bandeaux photo (HERO)](#les-bandeaux-photo-hero). |

Dans une fiche :

- **Visible sur le site** : décocher pour masquer la fiche sans la supprimer.
- **Afficher seulement entre deux dates** : pour une offre ou un contenu temporaire (heure de Paris).
- **Enregistrer** ; les modifications sont visibles dans la prévisualisation, puis sur le site après publication.
- **Supprimer** : définitif pour la fiche (mais une version publiée plus ancienne peut encore être restaurée).

### Les chambres

La page **Chambres** et le carrousel de l'accueil sont construits à partir des fiches **Chambres**, dans l'ordre de la liste (flèches ↑ ↓ pour le changer). En bas de chaque fiche :

- **Photo de couverture** : la photo de la chambre sur la page Chambres et dans le carrousel. Vide : la première photo de la fiche ;
- **Nom sur la page Chambres** (en gras) et **Résumé sur la page Chambres** (la suite de la ligne, par exemple « 23 m² + terrasse · 6e étage ») ;
- **Afficher dans le carrousel de l'accueil** : décocher pour garder la chambre sur la page Chambres seulement ;
- **Titre sur l'accueil** et **Infos de la carte d'accueil** : trois infos courtes avec leur pictogramme (surface, lits, vue). La carte montre aussi les six premiers **Pictogrammes affichés** de la fiche, avec leur **libellé court** (réglé dans la liste **Équipements**, par exemple « Clim »).

Pour **ajouter une chambre**, cliquer sur **Ajouter une chambre** et remplir la fiche : elle apparaît sur la page Chambres, dans le carrousel, dans « Les autres chambres » des fiches, dans la liste **Chambre concernée** des avis et, sous son nom, dans la fenêtre de réservation. Si D-Edge lui donne un code, l'ajouter dans les [Réglages](#reglages) (codes chambre).

**Masquer** une chambre (case **Visible sur le site**) la retire partout ; les liens qui la citent dans les textes mènent alors à la page Chambres. **Supprimer** une chambre fait de même et ajoute une redirection de son ancienne adresse vers la page Chambres, visible dans [Redirections](#redirections) : les favoris et Google suivent. Si une chambre est recréée plus tard à la même adresse, la redirection cesse de s’appliquer.

Les textes des pages qui comptent les chambres (« Six catégories, de 18 à 50 m² » sur la page Chambres, par exemple) ne changent pas seuls : les revoir dans **Pages** après un ajout ou une suppression.

### Les offres

La page **Offres** et les aperçus « Offres spéciales » de l'accueil sont construits à partir des fiches **Offres**, dans l'ordre de la liste (flèches ↑ ↓). Une offre n'a pas de page à elle : c'est une carte de la page Offres. Dans une fiche :

- **Famille** : Séjour, Restaurant ou Séminaires, pour les filtres de la page Offres. Un filtre sans offre disparaît ;
- **Étiquette**, **Titre**, **Photo** et sa **description** ;
- **Prix** en grand (« À partir de 239 € ») et **Précision du prix** en petit (« la nuit pour 2 ») ;
- **Ce qui est compris** (une ligne par élément), **Économie**, **Conditions** ;
- **Prix et conditions à confirmer par l'hôtel** : à cocher tant que l'hôtel ne les a pas validés (ces informations ne sont alors pas reprises dans les données lues par Google et les assistants IA) ;
- **Bouton** et **Texte du bouton** (« Réserver cette offre » par défaut) :
  - **Réserver** ouvre le moteur avec le code de l'offre, et les dates des champs **Arrivée proposée** et **Départ proposé** si elles sont remplies ;
  - **Demander un devis** ouvre le formulaire de devis, l'offre déjà choisie dans sa liste (une offre ajoutée y figure aussi) ;
  - **Lien** mène à l'**Adresse du lien** : une page du site (`#/restaurant-horloge?a=reserver-horloge` pour réserver une table à L'Horloge) ou une adresse complète ;
  - **Pas de bouton** : la carte n'a pas de bouton ;
- **Afficher sur l'accueil**, avec un **Titre** et une **Phrase** propres à l'accueil. Sans aucune offre cochée, la rubrique disparaît de l'accueil.

Pour une offre saisonnière, régler **Afficher seulement entre deux dates** (à droite) : elle apparaît et disparaît seule, à la régénération de chaque nuit. **Masquer** ou **Supprimer** la retire aussi de partout.

Pour mettre une offre en avant, le bouton **Promouvoir en popup** (à droite, sous **Enregistrer**) crée un popup qui la reprend : voir [Popup d'une offre](#popup-d-une-offre). Une fois le popup créé, le bouton devient **Voir son popup**.

Une offre réservable apparaît aussi dans le choix **Le moteur de réservation** des bandeaux et du popup. Son identifiant (sous la case **Visible sur le site**) est envoyé à D-Edge. Si D-Edge lui donne un autre code, l'ajouter dans les [Réglages](#reglages) (codes tarif). Pour les trois offres d'origine, le nom affiché dans la fenêtre de réservation se règle dans **Textes de l'interface** (`ui.offer.…`) ; pour les autres, c'est le titre de la fiche.

### Le blog

La page **Blog** (« Le journal de l'Aston ») liste les articles de **Fiches et listes** → **Blog (articles)**, dans l'ordre de la liste (flèches ↑ ↓). Chaque article a sa propre page, à l'adresse `/fr/blog/identifiant-de-l-article/`. Le lien **Blog** du menu (en-tête, après Accès, et menu mobile) mène à la page Blog ; il se modifie dans [Menus et liens](#menus-et-liens) comme les autres.

**Ajouter un article** crée une fiche, placée en tête de la liste. Dans une fiche :

- **Titre de l'article** (le titre de sa page et de sa carte) et **Rubrique** (le petit titre doré au-dessus : Quartier, Histoire, Événement…) ;
- **Date de publication** : facultative, affichée sous le titre (« 31 octobre 2026 ») ;
- **Photo ou vidéo**, choisie dans la médiathèque, et sa **description** (vide : celle de la médiathèque). Une photo s'affiche en haut de l'article et sur sa carte. Une vidéo se lance quand le visiteur clique dessus, avec le son et les commandes de lecture ; sur la carte de la page Blog, son image d'attente porte un bouton ▶ ;
- **Résumé** : le texte de la carte sur la page Blog. Vide : le début du texte de l'article ;
- **Texte de l'article** : texte mis en forme (intertitres, gras, listes, liens). Un lien vers une page du site s'écrit `#/nom-de-la-page` (par exemple `#/notre-histoire`) : son adresse suit la langue du visiteur ;
- **Title** et **Description pour Google** : vides, ce sont le titre et le résumé.

L'identifiant (créé à partir du titre) donne l'adresse de la page ; dans une autre langue, l'**Adresse de la fiche** peut être traduite. **Masquer** un article le retire de la page Blog et supprime sa page ; **Supprimer** fait de même et redirige son ancienne adresse vers la page Blog.

Un article **non traduit** s'affiche quand même dans toutes les langues du site : en **anglais** si sa traduction anglaise est prête, sinon en **français**. Sa page indique alors aux moteurs de recherche que la version d'origine est la version anglaise (ou française) : Google ne la compte pas deux fois. Pour traduire un article, ouvrir la fiche dans la langue voulue, comme toute fiche (voir [Traduire dans l'admin](#traduire-dans-l-admin)).

Les trois articles de la maquette (la Vieille Ville à pied, le coup de canon de midi, le Carnaval) sont repris tels quels, avec leurs traductions ; ils n'ont ni date ni photo.

### Les salles de séminaire

Le tableau « Nos salles et leurs configurations » de la page **Séminaires** et la liste **Offre ou salle** du formulaire de devis sont construits à partir des fiches **Salles de séminaire**, dans l'ordre de la liste (flèches ↑ ↓). Dans une fiche :

- **Nom de la salle** et **Précisions** (la ligne sous le nom, par exemple « 1er étage · lumière du jour · sonorisation ») ;
- **Photo** (la vignette du tableau) ;
- **Surface** en m² (un nombre ; vide : « À préciser ») ;
- **Théâtre**, **Classe**, **En U**, **Cabaret**, **Banquet** : un nombre de personnes, `—` si la configuration n'existe pas dans cette salle, vide pour « Sur demande ». Une valeur vide est repérée « à confirmer » et n'est pas reprise dans les données lues par Google.

Le lien « Devis pour cette salle » ouvre le formulaire de devis avec la salle déjà choisie. **Ajouter**, **Masquer** ou **Supprimer** une salle met à jour le tableau et le formulaire à la prochaine publication. La liste « Les chiffres clés » de la page guide *Salle de séminaire à Nice* et les chiffres de la page Séminaires (« 7 espaces modulables ») ne changent pas seuls : les revoir dans **Pages**.

Les avis clients ont leur propre écran : voir [Les avis Google](#les-avis-google).

### Les bandeaux photo (HERO)

**Fiches et listes** → **Bandeaux photo (HERO)** montre, sur un seul écran, chaque page qui a un grand bandeau réglable : Accueil, Séminaires et Moon Bar. Pour chacune :

- **Dégradé derrière le texte** : un voile léger part de la gauche (du bas sur mobile) et une ombre douce détache le texte blanc, sans assombrir le reste de la photo. Décoché, le bandeau garde son voile d'origine.
- **Opacité** (50 % au départ) et **Étendue vers la droite** (70 %) se règlent au curseur.
- **Revenir au réglage d'origine** remet ceux du site (activé sur Séminaires et Moon Bar, désactivé sur l'Accueil).
- **Enregistrer**, puis **Prévisualiser** ouvre la page dans la prévisualisation.

Le même réglage se trouve aussi dans l'onglet **Réglages** de la page.

### Les avis Google

**Contenu** → **Avis Google** rassemble les avis de la fiche Google de l'hôtel, repris sur l'accueil, la page Avis clients et les fiches chambres.

**Ce que le site affiche.** Seulement les avis **visibles** et **notés 4 ou 5 étoiles**, du plus récent au plus ancien. Chaque avis montre le nom et la photo de l'auteur (son initiale s'il n'a pas de photo), sa note, son texte, la réponse de l'hôtel et le logo Google. Sous les avis, la mention « Sélection d'avis Google récents notés 4 ou 5 étoiles » et un lien vers tous les avis sur Google Maps. Ces règles viennent de Google et du droit de la consommation (art. L111-7-2) : un site qui ne montre qu'une partie des avis doit dire comment il les choisit. Elles ne se désactivent pas.

**Fiche Google de l'hôtel** (en haut de l'écran : **Note globale**, **Nombre d'avis**, **Lien vers la fiche Google Maps**, puis **Enregistrer**). Le lien sert à « Voir tous les avis sur Google Maps » et à la note sur le site. La **note globale** et le **nombre d'avis** sont ceux de la fiche, sur tous les avis : les recopier depuis Google Maps, jamais calculés sur les seuls avis affichés. Vide, la note n'est pas affichée. Elle n'est affichée (chiffre et étoiles), sur toutes les pages, qu'à partir du seuil fixé dans les [Réglages](#reglages) : 4,2 par défaut. En dessous, seuls les avis apparaissent.

**La liste.** Elle s'ouvre sur **4 et 5 étoiles** ; les onglets **Toutes les notes**, **1 à 3 étoiles** et **Masqués** montrent le reste. Pour chaque avis :

- **Afficher** : décoché, l'avis n'est plus sur le site (un avis de moins de 4 étoiles n'y est de toute façon jamais) ;
- **Modifier** : thèmes (les filtres de la page Avis clients ; sans thème, l'avis compte comme un avis sur le séjour) et chambre concernée (l'avis passe en tête sur sa fiche chambre). Le texte d'un avis venu de l'API Google ne se modifie pas ;
- **Supprimer**.

**Ajouter un avis** : recopier un avis de la fiche Google tel quel (auteur, note, date, texte, réponse). Le **Lien de l'avis sur Google Maps** (bouton « Partager » de l'avis sur Google Maps) est facultatif : il sert seulement dans l'admin (lien **Voir sur Google Maps** sous l'avis) ; le site, lui, n'affiche plus de lien par avis, seulement le lien vers tous les avis de la fiche (31/10/2026).

**Importer un JSON** : un fichier, ou son contenu collé. Sont acceptés une liste d'avis avec les champs de l'écran (`author_name`, `rating`, `comment`, `published_at`, `review_url`, `author_photo_url`, `reply_comment`, `is_visible`, `topics`, `room`), la réponse de l'API Google Business Profile (`reviews`, `averageRating`, `totalReviewCount` : la note et le nombre d'avis de la fiche sont repris) et les avis de l'API Places. Un avis déjà présent (même identifiant) est mis à jour. Cocher **Ce sont des exemples** pour des avis de démonstration.

**Préparer le fichier depuis Google Maps** : ouvrir `tools/avis-google-extracteur.html` dans Chrome ou Edge (double-clic). Le plus simple est le **mode automatique** : glisser une fois le bouton **⭐ Extraire les avis** dans la barre des favoris, ouvrir la fiche Google Maps de l'hôtel et cliquer sur ce favori. Il ouvre l'onglet Avis, trie par « Plus récents », fait défiler la liste et déplie les textes jusqu'à avoir les avis voulus (8 notés 4 ou 5 étoiles par défaut), puis télécharge `reviews-seed.json` avec la note globale et le nombre d'avis de la fiche, à importer ici. Si Google a changé sa page et que le favori ne trouve rien, le mode manuel de l'outil lit le code de la page collé. Les dates « il y a 3 semaines » deviennent des dates approximatives.

**Les exemples.** Les huit avis de la maquette sont des exemples : marqués « Exemple » sur le site et repérés en orange dans l'écran, à supprimer (**Supprimer les exemples**) dès que les vrais avis sont là. Leur fichier, `Backend/server/db/seeds/avis-google-exemples.json`, permet de les réimporter.

**Récupérer depuis Google en un clic.** Le bouton **Récupérer depuis Google (Start)** ouvre une page avec un bouton **Start** : connexion avec le compte Google qui gère la fiche de l'hôtel, lecture des vrais avis par l'API Google Business Profile, sélection des 8 plus récents notés 4 ou 5 étoiles, téléchargement de `reviews-seed.json`, import ici avec la note globale et le nombre d'avis, puis un résumé (avis lus, écartés, gardés, période couverte). Il reste à publier. Elle demande, une seule fois, l'identifiant client OAuth du projet Google Cloud (voir `Backend/README.md`, « Avis Google ») et ne fonctionne qu'une fois l'accès à la fiche et à l'API accordé.

**Synchronisation automatique.** Dès que l'hôtel aura donné l'accès à sa fiche, les avis et la note arriveront seuls par l'API Google Business Profile, chaque matin, et seront publiés sans le reste du site. La visibilité, les thèmes et la chambre choisis ici sont gardés. La mise en place (identifiants dans `Backend/.env`) est décrite dans `Backend/README.md`.

## 5. Live Music : concerts et artistes

Un seul bar est ouvert à la fois : le Moon Bar sur le toit quand le temps le permet, sinon L'Aston Club au 7e étage.

### Ajouter un concert

**Fiches et listes** → **Programme Live Music** (ou **Programme des concerts** dans le menu de l'éditeur Live Music), puis **Ajouter un concert**. Pour l'éditeur Live Music, l'**Accueil** de l'admin montre aussi les prochains concerts et un bouton **Ajouter un concert**.

| Champ | À savoir |
|---|---|
| Date, Heure | Obligatoire pour la date ; 21:00 proposé par défaut. |
| Lieu | **Selon la météo** (Moon Bar sur le toit si le temps le permet, sinon L'Aston Club), **Moon Bar (rooftop)** ou **L'Aston Club (7e étage)**. |
| Artiste ou groupe | Obligatoire. Se choisit dans la liste, ou se crée sur place avec **+ Nouvel artiste**. Le style, la présentation, la photo et le site viennent de la fiche artiste. |
| Précisions sur la soirée | Facultatif. Vide : la présentation de l'artiste est affichée. |
| Style de cette soirée | N'apparaît que sur d'anciens concerts qui en ont un : remplace le style de la fiche artiste ; le vider reprend celui de la fiche. |

Les concerts à venir apparaissent sur la page Live Music avec la photo et le lien de l'artiste, et sont signalés à Google comme événements. Les concerts passés disparaissent seuls : le site est régénéré chaque nuit.

### Fiches artistes

**Fiches et listes** → **Artistes (Live Music)** (ou le lien **Gérer les fiches artistes →** depuis le programme) :

- **Nom de l'artiste ou du groupe** (obligatoire) ;
- **Style** et **Présentation** (traduits) ;
- **Site internet** (facultatif, commence par `https://`) ;
- **Photo**, choisie dans la médiathèque, affichée en vignette ronde.

Un artiste programmé ne peut pas être supprimé. Masquer un artiste retire ses concerts du site.

### Le compte Live Music

L'éditeur Live Music voit un menu réduit : sa page, le programme, les artistes, la médiathèque (dossier `/live-music`) et les bandeaux de sa page. Quand il publie, **seule la partie Live Music part en ligne** : les brouillons des autres écrans restent en attente. Il ne peut pas restaurer une version.

## 6. Médiathèque, bandeaux et popup

### Médiathèque

- **Envoyer** : glisser-déposer des fichiers sur l'écran (ou **Envoyer des fichiers**), en choisissant le dossier d'envoi. Les photos sont optimisées automatiquement : WebP et AVIF (plus léger, lu par les navigateurs récents) en plusieurs tailles, recadrage portrait pour mobile en trois tailles, miniature. Les photos envoyées avant le 14/11/2026 reçoivent ces nouvelles tailles toutes seules au démarrage du serveur : le **Journal** affiche alors « Photos allégées (AVIF, téléphones) », et il faut **Publier** pour que le site en profite. Un doublon est signalé.
- **Documents PDF** (cartes du restaurant, plaquettes…) : jusqu'à 20 Mo, au-delà de 5 Mo un avertissement signale qu'il sera long à ouvrir sur un téléphone. Le fichier garde un nom lisible tiré de son nom d'origine. On s'en sert dans [Menus et liens](#menus-et-liens).
- **Liens externes** : coller une adresse YouTube, Vimeo, Spotify… puis **Ajouter**.
- **Retrouver** : dossiers, filtre par type (images, vidéos, sons, documents PDF, liens externes), recherche par nom ou texte alternatif.
- **Dans la fiche d'un média** :
  - cliquer sur le **sujet principal** de la photo : le recadrage portrait utilisé sur mobile se centre sur ce point ;
  - **Texte alternatif** dans chaque langue : il décrit l'image pour les personnes malvoyantes et pour Google (une pastille signale ceux qui manquent) ;
  - titre, légende, dossier, **Crédit photo** ;
  - **Utilisé par** : les pages et fiches qui s'en servent.
- **Mettre à la corbeille** : le média est effacé définitivement la nuit suivante, sauf si une version conservée du site l'utilise encore. La case **Corbeille** affiche les médias en attente d'effacement ; l'admin ne propose pas de les récupérer.

Pour changer la photo d'une page : onglet **Textes** de la page, **Changer l'image**. Pour une fiche : champ **Photo** de la fiche.

Sur l'accueil, les vignettes **Conciergerie** et **Bagagerie gratuite** (section « Tout ce qu'un 4 étoiles doit faciliter ») montrent un pictogramme tant qu'aucune photo n'est choisie : **Pages** → **Accueil** → onglet **Textes**, ligne **Photo** juste sous le titre de la vignette, **Changer l'image**. **Retirer l'image** remet le pictogramme. La photo de la page Conciergerie elle-même se change dans **Fiches et listes** → **Services** → **Conciergerie**, champ **Photos**.

D'autres images d'origine se remplacent de la même façon ; tant qu'aucune n'est choisie, l'image d'origine reste, et **Retirer l'image** la fait revenir :

| Image | Où la changer (taper le mot dans **Rechercher un texte…**) |
|---|---|
| Grand bandeau en haut de l'accueil (la piscine) | **Pages** → **Accueil** → **Textes**, rechercher **bandeau** |
| Fond de la section « Restaurant & bars » de l'accueil | **Pages** → **Accueil** → **Textes**, rechercher **fond** |
| Logo blanc de l'en-tête (sur le bandeau de l'accueil, grand écran) | **Textes communs**, rechercher **logo** |
| Logo or de l'en-tête (sur fond clair, grand écran) | **Textes communs**, rechercher **logo** |
| Photo du bandeau de la page Moon Bar (le rooftop au crépuscule) | **Pages** → **Le Moon Bar** → **Textes**, rechercher **bandeau**, puis **Changer l'image** |

Pour ces images, la description lue par Google et les lecteurs d'écran est celle de la **Médiathèque** : la remplir en ouvrant la photo. Les logos de l'en-tête doivent avoir un fond transparent (PNG). La photo du bandeau du Moon Bar avance d'un zoom très lent (coupé si le visiteur a demandé de réduire les animations) ; elle remplace l'ancienne vidéo, trop lourde sur téléphone. Chaque ligne **Photo** de l'onglet **Textes** indique maintenant où elle s'affiche.

### Bandeaux

Des messages placés en haut des pages, sous le module de réservation, entre deux sections ou avant le pied de page. Ils s'affichent et disparaissent seuls aux dates choisies.

**Bandeaux** → **Nouveau bandeau**, puis :

- **Texte du bandeau** par langue : message, texte du bouton, et si besoin une adresse propre à la langue ;
- **Réglages** : nom interne (pour s'y retrouver), style, pictogramme, couleurs ;
- **Bouton vers** : une page, une fiche, le moteur de réservation ou une adresse ;
- **Afficher à partir du / Jusqu'au** (heure de Paris ; sans date, le bandeau reste affiché tant qu'il est actif) ;
- **Actif**, **Le visiteur peut le fermer**, **Priorité** (une zone n'affiche qu'un nombre limité de bandeaux à la fois : le plus prioritaire passe devant) ;
- **Emplacements** : la zone, puis **Nulle part**, **Toutes les pages** ou **Pages choisies** ;
- **Enregistrer**, puis publier.

### Popup

Une fenêtre au plus par page (la plus prioritaire). Sur mobile, elle ne s'ouvre jamais avant un geste du visiteur et s'affiche en panneau bas.

**Popup** → **Nouveau popup**, puis :

- **Contenu** par langue : titre, texte, **Bouton vers** (une page, une fiche, le moteur de réservation ou une adresse) et texte du bouton ; une image, une vidéo ou un son ;
- **Réglages** : **Nom interne** (pour s'y retrouver dans la liste) ;
- **S'ouvre sur ordinateur** : après un délai, après un défilement, ou quand le visiteur s'apprête à partir ;
- **Sur mobile** : après un défilement, après un délai, ou jamais ;
- **Fréquence** : une seule fois par visiteur, une fois par visite, ou au plus tous les N jours ;
- **Du** / **Au** : dates d'affichage (heure de Paris ; sans date, le popup reste affiché tant qu'il est actif) ;
- **Actif**, **Priorité**, **Le montrer à nouveau aux visiteurs qui l'avaient déjà fermé** ;
- **Pages** : toutes, seulement sur…, ou partout sauf… ;
- **Enregistrer**, puis publier.

#### Popup d'une offre

Dans **Fiches et listes** → **Offres**, ouvrir l'offre, puis **Promouvoir en popup**. Le popup est créé **inactif** et s'ouvre dans l'écran Popup, avec tous les réglages ci-dessus (déclenchement, fréquence, dates, pages, priorité). Cocher **Actif**, **Enregistrer**, puis publier.

- Le **titre**, le **texte** (prix, ce qui est compris, économie, conditions), la **photo** et le **bouton** sont ceux de la fiche, dans toutes ses langues traduites. Modifier l'offre modifie le popup.
- Pour une accroche différente, remplir le **Titre**, le **Texte**, le **Bouton vers** ou l'**image** du popup : ce champ remplace celui de l'offre, le reste vient toujours de la fiche. Vider le champ revient à celui de l'offre.
- Le popup s'affiche seulement aux dates communes au popup et à l'offre. Une offre **masquée** ou hors de ses dates emporte son popup ; une offre **supprimée** le supprime.

#### Conflits entre popups

Une seule fenêtre s'ouvre par page. Deux popups **actifs** qui se chevauchent (mêmes dates, au moins une page en commun) sont en **conflit**. À l'enregistrement, l'admin le signale : « Conflit avec le popup X, du … au …, sur … », et demande **lequel afficher** pendant la période commune.

- Le popup choisi passe devant pendant le chevauchement ; l'autre reste actif et **reprend tout seul ensuite**. Exemple : une offre de Noël en décembre devant la Newsletter, qui revient en janvier.
- La question revient à chaque enregistrement d'un popup actif en conflit, même déjà réglé : la fenêtre indique alors lequel s'affiche, et **Garder ce réglage** n'y change rien.
- **Décider plus tard** laisse le conflit ouvert : la liste des popups affiche alors un badge **Conflit**.
- Dans la liste, un popup qui cède la place porte le badge **Masqué par « X »**, avec la période.
- L'écran d'un popup liste ses chevauchements et celui qui s'affiche ; le bouton **Choisir lequel afficher** permet de changer d'avis. Le choix passe par la **Priorité** : changer la priorité à la main change aussi le gagnant.

### Bandeaux, popup, liens et cartes dans les autres langues

Un bandeau, un popup, un lien des menus, une carte du restaurant, un article du blog ou une fiche **n'est jamais masqué** faute de traduction. Dans une langue où son texte n'est pas prêt, il s'affiche :

1. en **anglais**, si sa version anglaise est prête ;
2. sinon en **français**.

Il vaut quand même mieux les traduire : c'est plus agréable pour le visiteur.

## 7. Traduire le site

### États d'une traduction

| État | Signification | Publié ? |
|---|---|---|
| À traduire | Rien n'est saisi dans cette langue. | Non |
| Brouillon | Saisi, mais à relire. | Non |
| Prêt | Validé. | Oui |
| À revoir | Le texte français a changé depuis la traduction. | La traduction précédente reste en ligne ; la mettre à jour puis la marquer prête. |

### Traduire dans l'admin

1. Ouvrir l'écran (page, textes communs, fiche…) et choisir la langue dans les **onglets de langue**.
2. Le texte français est affiché à gauche. Cocher **Seulement les textes à traduire ou à revoir** pour ne voir que le travail restant.
3. Saisir la traduction. **Reprendre le texte français** copie l'original (utile pour un nom propre ou une adresse).
4. Si la case **Enregistrer en brouillon (à relire)** est cochée, le texte part en brouillon. Une fois relu, cliquer sur **Marquer comme prêt** sous le texte.

Le titre, la description et l'adresse de la page dans cette langue se traduisent dans l'onglet **Référencement (SEO)**. Une case y indique si la traduction est encore un brouillon.

L'écran **Traductions** montre l'avancement de chaque langue (prêts, brouillons, à revoir, à traduire), puis, par module (textes, pages, fiches, médias, bandeaux, popup), la liste de ce qui reste, chaque ligne menant au bon écran.

### Passer toute une langue en « prêt »

Après une traduction importée et relue, on peut passer d'un coup tous les brouillons d'une langue en « prêt ». Serveur lancé, dans un second terminal :

```bash
cd Backend
node scripts/i18n-ready.mjs it --dry   # montre ce qui changerait, sans rien modifier
node scripts/i18n-ready.mjs it         # passe les brouillons de l'italien en « prêt »
```

Seul le statut change, le texte reste le même, et chaque modification figure au **Journal**. Rien n'est publié : il reste à activer la langue et à publier.

### Mettre une langue en ligne

1. **Langues du site** (administrateur) : la langue doit figurer dans la liste. **Ajouter une langue** demande son code (`es`), son nom, son nom dans la langue, sa locale (`es-ES`) et la langue du moteur de réservation.
2. Une langue **Inactive** se prépare (ses textes se traduisent et se prévisualisent) sans apparaître sur le site. Cliquer sur l'état pour la passer **En ligne**. Les flèches règlent l'ordre des langues.
3. **Publier.**

Même en ligne, une langue n'apparaît que sur les pages entièrement prêtes. Les autres pages restent en français seulement.

### Finnois, polonais, thaï et indonésien

Ces quatre langues sont **livrées toutes traduites** (31/10/2026) : textes communs, pages, référencement (title, description, adresse), fiches (chambres, services, offres, salles, blog, réponses du chat), cartes du restaurant et des bars, données structurées, mentions légales, politique de confidentialité, textes des photos et bandeau. Au premier démarrage du serveur après la mise à jour, elles apparaissent dans **Langues du site**, à l'état **Inactive**, avec leurs traductions déjà **prêtes**. Pour les mettre en ligne :

1. Dans le menu de gauche, rubrique **Langues**, cliquer sur **Langues du site**.
2. Sur la ligne **Suomi** (finnois), cliquer sur **Inactive** pour la passer **En ligne**. Faire de même pour **Polski** (polonais), **ไทย** (thaï) et **Bahasa Indonesia** (indonésien).
3. **Prévisualiser** pour vérifier, puis **Publier**.

Leurs adresses sont traduites (`/fi/huoneet/`, `/pl/pokoje/`, `/id/kamar/`) ; en thaï, elles sont en anglais (`/th/rooms/`), comme pour le grec, le russe, le japonais, le chinois et le coréen. Les noms des chambres (Confort, Privilège…), des appartements, des bars et des lieux de Nice restent en français, comme dans les autres langues.

Les traductions sont faites à partir du texte français : un texte français modifié dans l'admin avant la mise à jour n'est pas reconnu et reste **à traduire** (il s'affiche en anglais en attendant). L'écran **Traductions** liste ces textes, s'il y en a ; le terminal du serveur en donne le nombre au démarrage. Les fiches artistes et les concerts du Live Music, saisis dans l'admin, sont aussi à traduire. Une traduction déjà présente n'est jamais remplacée, et une traduction supprimée ne revient pas au redémarrage.

### Arabe

L'arabe est livré tout traduit de la même façon (13/11/2026), à l'état **Inactive** dans **Langues du site**, sur la ligne **العربية**. Pour le mettre en ligne : **Langues** → **Langues du site** → cliquer sur **Inactive** sur la ligne **العربية** pour la passer **En ligne**, **Prévisualiser**, puis **Publier**. Ses adresses sont en anglais (`/ar/rooms/`), comme pour le thaï.

L'arabe s'écrit **de droite à gauche** : sur les pages arabes, tout le site se retourne tout seul (menus, en-tête, logo à droite, blocs, carrousels, menu mobile qui s'ouvre depuis la gauche, chat en bas à gauche, bandeaux, popups, pied de page, module de réservation, flèches). Les noms en lettres latines (Moon Bar, L'Horloge, Confort…), les numéros de téléphone et les adresses gardent leur ordre de lecture. Le texte s'affiche avec la police arabe de chaque appareil (Geeza Pro sur iPhone et Mac, Segoe UI sur Windows, Noto sur Android) : rien n'est téléchargé.

Dans l'admin, les champs de texte s'alignent à droite dès qu'on y écrit en arabe ; il n'y a rien à régler. Le moteur de réservation D-Edge reçoit la langue `ar-AE` : vérifier, en cliquant sur **Voir les disponibilités** depuis une page arabe, qu'il s'ouvre bien. S'il affiche une erreur, remplacer la locale par `en-GB` dans **Langues du site** (le moteur s'ouvrira en anglais).

### Hongrois

Le hongrois est livré tout traduit de la même façon (13/11/2026), à l'état **Inactive** dans **Langues du site**, sur la ligne **Magyar**. Pour le mettre en ligne : **Langues** → **Langues du site** → cliquer sur **Inactive** sur la ligne **Magyar** pour la passer **En ligne**, **Prévisualiser**, puis **Publier**. Ses adresses sont en hongrois sans accents (`/hu/szobak/` pour les chambres). Le moteur de réservation D-Edge reçoit la langue `hu-HU` : vérifier, en cliquant sur **Voir les disponibilités** depuis une page hongroise, qu'il s'ouvre bien ; sinon, remplacer la locale par `en-GB` dans **Langues du site**.

### Turc

Le turc est livré tout traduit de la même façon (13/11/2026), à l'état **Inactive** dans **Langues du site**, sur la ligne **Türkçe**. Pour le mettre en ligne : **Langues** → **Langues du site** → cliquer sur **Inactive** sur la ligne **Türkçe** pour la passer **En ligne**, **Prévisualiser**, puis **Publier**. Ses adresses sont en turc sans accents (`/tr/odalar/` pour les chambres). Le moteur de réservation D-Edge reçoit la langue `tr-TR` : vérifier, en cliquant sur **Voir les disponibilités** depuis une page turque, qu'il s'ouvre bien ; sinon, remplacer la locale par `en-GB` dans **Langues du site**.

### Le sélecteur de langue du site

Le sélecteur de langue du site propose **les langues publiées sur le site**. Il mène à la même page dans l'autre langue ; si cette page n'y est pas encore traduite, il mène à la page parente la plus proche qui l'est (par exemple, depuis la carte des desserts, au restaurant L'Horloge en anglais), à défaut à l'accueil. Il n'est masqué que si le site n'est publié que dans une seule langue.

### Traduire hors de l'admin

Pour confier une traduction à un prestataire, `node scripts/i18n-export.mjs` exporte tous les textes français dans un fichier JSON, et `node scripts/i18n-import.mjs <fichier.json>` le réimporte : tout arrive en brouillon. Les détails sont dans [Backend/README.md](../Backend/README.md).

## 8. Publier et revenir en arrière

### Prévisualiser

Le bouton **Prévisualiser** génère le site dans toutes les langues actives, brouillons compris, et l'ouvre. L'accueil propose aussi **Générer et ouvrir** et **Ouvrir la dernière**. La prévisualisation est réservée aux personnes connectées et n'est jamais indexée par Google ni comptée dans les statistiques.

### Publier

Le bouton **Publier** fige le contenu enregistré, génère le site et le met en ligne. Si rien n'a changé depuis la dernière publication, aucune version n'est créée. Le site est aussi régénéré chaque nuit à minuit, pour les bandeaux, popups et fiches programmés et les concerts passés.

### Publication et versions

L'écran montre la version en ligne (numéro, date, nombre de pages, langues) et l'historique des générations (**Afficher les prévisualisations** pour les voir aussi). Les trois dernières versions publiées sont conservées.

**Restaurer** (sur la ligne de la version) remet en ligne le site tel qu'il était ; la version actuelle reste disponible. La fenêtre de confirmation a une case **Restaurer aussi le contenu dans le back-office** :

- **décochée** (par défaut) : seul le site en ligne change ; les modifications en cours dans l'admin sont gardées et repartiront à la prochaine publication ;
- **cochée** : le contenu de l'admin revient lui aussi à cette version (une sauvegarde de la base est faite automatiquement avant).

## 9. Référencement (SEO)

### Onglet Référencement d'une page

Pour chaque page et chaque langue :

- **Adresse de la page** : minuscules, chiffres et tirets. Changer l'adresse d'une page déjà publiée crée automatiquement une redirection 301 depuis l'ancienne ;
- **Libellé dans le menu et le fil d'Ariane** ;
- **Title** et **Description** avec compteurs de longueur ;
- **Mot-clé principal** : l'expression que la page doit porter dans Google. Les contrôles vérifient sa présence dans le title, le titre principal, la description, l'adresse et le premier paragraphe ;
- **Partage sur les réseaux sociaux** (facultatif) : titre, description, image (1200 × 630 px conseillés ; sinon l'image par défaut du site) ;
- **Ne pas faire apparaître cette page dans Google** (`noindex`).

À droite : l'**aperçu dans Google** et les **contrôles sur la page générée** (bouton **Relancer**). Les contrôles portent sur le contenu enregistré, brouillons compris.

### Rapport SEO

Les points relevés à chaque génération : longueur des titles et descriptions, doublons, liens cassés, textes non traduits… regroupés par page, pour le site en ligne ou la prévisualisation. **Corriger** mène au bon écran. Le rapport est vide tant qu'aucune prévisualisation ni publication n'a été faite.

### Données structurées (JSON-LD)

Chaque page porte, invisible pour le visiteur, une fiche lue par Google et les assistants IA : l'hôtel (adresse, téléphone, étoiles, horaires d'arrivée et de départ, équipements), le restaurant L'Horloge, le Moon Bar, L'Aston Club, et ce qui vient de la page elle-même (fil d'Ariane, questions fréquentes, chambre, concerts). Elle est écrite dans la langue de la page, avec les adresses de cette langue (`/en/…`, `/es/…`) et la langue indiquée (`inLanguage`).

- **Les textes** (description de l'hôtel, équipements, description du restaurant et des bars, cuisine, gamme de prix) se modifient et se traduisent comme les autres : **Pages** → carte **Données structurées (JSON-LD)**, avec les onglets de langue. Ils apparaissent aussi dans **Traductions**. Une langue sans traduction prête reprend l'anglais s'il est prêt, sinon le français ; elle n'est jamais bloquée pour autant.
- **La structure** (types, adresse, coordonnées GPS, téléphones, horaires, `@id`) ne se traduit pas : elle se règle une seule fois dans **Réglages** → **Données structurées (JSON-LD)**. Les clés Schema.org y restent en anglais. Dans ce modèle, `{{jsonld.hotel.description}}` désigne un texte traduit, `{{url:moon-bar}}` l'adresse d'une page dans la langue (par son nom interne : `accueil`, `restaurant-horloge`, `moon-bar`, `aston-club`, `menu-restaurant-horloge`, `carte-moon-bar`…), `{{inLanguage}}` la langue de la page. Une page inconnue ou un texte vide retire la ligne concernée et le signale dans le rapport de la prévisualisation.
- Les noms propres (Hôtel Aston La Scala, L'Horloge, L'Aston Club) ne se traduisent pas. Les cartes du restaurant et du Moon Bar sont liées par leur page (`hasMenu`), sans recopier les plats.

### Redirections

Une ancienne adresse renvoie vers une page du site ou une adresse externe, pour que les favoris, les liens et Google suivent. Saisir l'ancienne adresse (par exemple `/fr/ancienne-page.html`), choisir la page ou l'adresse de destination, le type (**Définitive (301)** en général), puis **Ajouter**.

## 10. Statistiques

Les statistiques mesurent les visites du site publié, sans cookie ni bandeau de consentement : ni adresse IP ni identifiant ne sont conservés.

- **Période** : semaine, mois ou année, comparée à la période précédente.
- **Filtres** : canal, appareil, langue, pays.
- **Rapports** : canaux d'arrivée (dont les assistants IA et les comparateurs), entonnoir jusqu'au moteur de réservation, calendrier des dates recherchées, efficacité des bandeaux et du popup, pages, contacts, chat, pages introuvables (404), vitesse ressentie (Core Web Vitals). Chaque rapport s'exporte en CSV.
- **Pays** : le serveur télécharge tout seul la base de géolocalisation gratuite DB-IP au premier démarrage, puis la nouvelle chaque mois, la nuit. Rien à faire : après la mise à jour du code et un redémarrage, le message « Pays non mesurés » disparaît en quelques secondes et les pays des visites suivantes s'affichent (les visites passées ne sont pas recalculées). Sur le PC, les visites viennent du PC lui-même ou du Wi-Fi de la maison : elles n'ont pas de pays, la carte y reste donc presque vide. Pour avoir aussi la région, ajouter `GEOIP_EDITION=city` dans `Backend\.env` avant le premier téléchargement (fichier d'environ 130 Mo).

Sur les ordinateurs de l'hôtel (réception, bureaux), cocher dans **Mon compte** : **Ne pas compter mes visites sur le site depuis ce navigateur**, pour ne mesurer que les vrais visiteurs.

## 11. Administration

### Utilisateurs

**Nouveau compte** : nom, e-mail, rôle, langues traduites (traducteur), et si besoin **Limiter à une partie du site** (par exemple Live Music, pour un éditeur), puis **Créer le compte**. Un mot de passe est généré et **affiché une seule fois** : le transmettre à la personne, qui pourra le changer dans **Mon compte** (12 caractères au moins). **Modifier** permet de changer le nom, le rôle, les langues ou de décocher **Compte actif** (le compte reste dans la liste, marqué « désactivé ») ; **Mot de passe** en génère un nouveau ; **Supprimer** retire le compte (pas le sien).

### Réglages

Paramètres communs à tout le site, appliqués à la prochaine publication :

- **Site** : nom du site, langue proposée aux visiteurs dont la langue n'est pas proposée (x-default), image de partage par défaut, adresse des photos encore hébergées par l'ancien site (à ne pas changer) ;
- **Moteur de réservation (D-Edge)** : adresse du moteur (`{locale}` y devient `fr-FR`, `en-GB`…, `{lang}` devient `fr`, `en`…), début commun des adresses du moteur (pour reconnaître les liens vers le moteur dans les textes), noms des paramètres qui transmettent l'arrivée, le départ, le nombre de nuits, les adultes, les enfants, le total des voyageurs, la chambre et l'offre (laisser un nom vide pour ne pas envoyer l'information), codes chambre et codes tarif de D-Edge (une ligne par chambre ou offre : `privilege = code D-Edge`). Ces noms et codes sont fournis par D-Edge ; s'ils sont faux, le moteur s'ouvre sans les choix du visiteur ;
- **Avis clients** : **Note moyenne affichée à partir de** (4,2 par défaut) ; en dessous, la note de la fiche Google n'apparaît sur aucune page, les avis restent affichés (les avis eux-mêmes : [Les avis Google](#les-avis-google)) ;
- **Données structurées (JSON-LD)** : le modèle unique, pour toutes les langues, des informations lues par Google et les assistants IA (voir [Données structurées (JSON-LD)](#donnees-structurees-json-ld)). Réservé aux personnes à l'aise avec le format ;
- **Enregistrer** en bas des réglages ;
- **Maintenance** : **Effacer la corbeille maintenant**.

### Journal des modifications

Qui a modifié quoi, et quand : les 500 dernières actions. Le champ **Filtrer (personne, action…)** en haut à droite réduit la liste.

## 12. Sauvegarder

Le contenu du site (textes, traductions, fiches, réglages, comptes, versions) **n'est pas dans GitHub** : il est dans la base locale. Les photos non plus. Deux dossiers sont à sauvegarder régulièrement, serveur arrêté de préférence :

| Dossier | Contenu |
|---|---|
| `Backend/storage/` | La base de données (`db/aston.sqlite`), les contenus figés de chaque version publiée, les sauvegardes faites avant une restauration. |
| `Backend/media/` | Les photos, vidéos et sons de la médiathèque, avec leurs tailles optimisées. |

Le dossier `Backend/releases/` (sites générés) peut être copié aussi, mais il se reconstruit à partir de `storage/`.

Sur le futur serveur, des scripts de sauvegarde automatique sont prêts dans [deploy/](../deploy/README.md) (`backup-db.sh` pour la base, `sync-media.sh` pour les médias).

## 13. En cas de problème

| Problème | Que faire |
|---|---|
| Ma modification n'apparaît pas sur le site. | Elle est enregistrée mais pas publiée : **Publier**. Si c'est une traduction, vérifier qu'elle est **prête** et que toute la page l'est (écran **Traductions**). |
| Une langue n'apparaît pas sur une page. | La page a encore des textes non prêts dans cette langue, ou la langue est **Inactive** dans **Langues du site**. |
| Une publication a cassé quelque chose. | **Publication et versions** → **Restaurer** la version précédente. |
| La photo est mal cadrée sur mobile. | Médiathèque → ouvrir la photo → cliquer sur le sujet principal → publier. |
| « Non enregistré » s'affiche à côté d'un texte. | Le serveur n'a pas répondu ou la session a expiré : recharger la page, se reconnecter, ressaisir. |
| L'admin ne s'ouvre pas. | Vérifier que le terminal `npm start` est toujours ouvert et sans erreur ; voir [INSTALLATION-LOCALE.md](INSTALLATION-LOCALE.md). |

## Tenir ce guide à jour

Le fichier de référence est **`docs/guide-utilisateur.md`**. On ne modifie que lui, puis on régénère la version HTML :

```bash
node tools/md-to-html.mjs docs/guide-utilisateur.md
```

La commande écrit `docs/guide-utilisateur.html` à côté ; c'est cette version que montre l'admin (**AIDE** → **Manuel d'utilisation**). `--check` vérifie seulement que la version HTML est à jour (elle échoue sinon). Penser à changer la date en haut du guide, puis à commiter les deux fichiers ensemble.
