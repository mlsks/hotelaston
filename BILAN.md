# Hôtel Aston La Scala — bilan du projet

État au 26 octobre 2026. Version HTML du même document : [BILAN.html](BILAN.html).

## En bref

- **Le nouveau site est prêt en maquette fonctionnelle** : toutes les pages, le module de réservation, le chat, les formulaires, les données structurées pour Google. Il suit la revue UX (35 recommandations sur 36 appliquées).
- **Le back-office est terminé et testé en local** (`hotelaston/Backend/`) : gestion des contenus et des traductions, médiathèque, bandeaux, popup, génération du site en pages statiques, publication et retour arrière, statistiques sans cookie, interface d'administration complète.
- **Rien n'est encore en ligne.** Restent les fichiers de déploiement, quelques développements secondaires, et surtout des informations à obtenir de l'hôtel.

| Repère | Valeur |
|---|---|
| Pages générées | 35 (25 pages + 6 fiches chambre + 4 fiches service) |
| Textes gérés | 1 294, dont 57 textes affichés par le JavaScript |
| Langues | Français en ligne · anglais activé, à traduire · italien et allemand préparés |
| Tests automatiques | 44, tous réussis (1 sauté sans ffmpeg) |
| Écrans d'administration | 22 |

## 1. Ce qui est fait

### 1.1 Le site

Maquette HTML / CSS / JavaScript dans `hotelaston/` (`index.html`, `styles.css`, `remotion-vanilla.js`).

- **Pages** :
  - accueil ;
  - chambres et leurs 6 fiches ;
  - restaurant et bars : L'Horloge, Moon Bar, L'Aston Club, cartes ;
  - rooftop et piscine, Live Music ;
  - séminaires avec demande de devis, offres ;
  - services et leurs 4 fiches ;
  - accès et contact, avis, FAQ, notre histoire ;
  - pages de recherche locales (hôtel vieille ville, salle de séminaire, comité d'entreprise…), blog ;
  - page passerelle « Appartements » vers la Résidence.
- **Réservation** :
  - module visible dès l'arrivée ;
  - bouton fixe en bas d'écran sur mobile ;
  - liens directs vers le moteur D-Edge avec dates, voyageurs, chambre ou offre.
- **Revue UX** (`revue-ux-hotel-aston-relecture.pdf`) : 35 recommandations sur 36 appliquées. La dernière, des avis sur les pages L'Horloge, Moon Bar et L'Aston Club, est reportée à votre demande.
- **Hero** : photo de la piscine du toit (WebP, recadrage portrait pour mobile). La boucle vidéo est prête mais désactivée, en attendant la prise de vue définitive. Boucle du Moon Bar rendue avec Remotion.
- **Corrections demandées en cours de route** :
  - un seul bar ouvert à la fois : le Moon Bar quand le temps le permet, sinon L'Aston Club ;
  - plus de mention « jazz » ;
  - page passerelle Appartements avec liens suivis ;
  - texte du QR code en chambre ;
  - phrase de la plage.
- **Prudence sur les données** :
  - ce que le site actuel ne dit pas n'a pas été inventé : 32 passages sont marqués « à confirmer », visibles avec `?audit` ;
  - les avis de démonstration sont étiquetés « Exemple ».

### 1.2 Le back-office (`hotelaston/Backend/`)

Node.js, Fastify, SQLite. Le site public reste 100 % statique : rapide, sûr, peu coûteux à héberger.

| Brique | Contenu |
|---|---|
| 1. Base et générateur | Import du site actuel (les 34 pages françaises générées sont identiques à la maquette). Une page par adresse et par langue, prévisualisation privée, publication figée, 3 versions conservées et restauration en un clic, régénération chaque nuit. Plan du site avec dates de mise à jour fiables, IndexNow, balises hreflang, données structurées, redirections 301 automatiques quand une adresse change. |
| 2. API, rôles, médias | Connexion sécurisée (mots de passe argon2id, jeton CSRF, limite de tentatives, journal des modifications). Rôles administrateur, éditeur et traducteur. Médias : WebP en 4 tailles, recadrage portrait centré sur le point d'intérêt, poster des vidéos, doublons détectés, corbeille. Bandeaux programmés sur 4 emplacements, popup (fenêtre sur ordinateur, panneau bas sur mobile, jamais avant un geste du visiteur). Textes du JavaScript traduisibles. |
| Éditeur Live Music | Compte limité à la page Live Music, au programme des concerts, à ses bandeaux et à ses médias. Il publie sa partie sans emporter les brouillons des autres. |
| 3. Statistiques | Sans cookie ni bandeau de consentement ; ni adresse IP ni identifiant conservés. Canaux d'arrivée, dont les assistants IA et les comparateurs. Du visiteur au moteur de réservation, calendrier de la demande (dates d'arrivée recherchées), efficacité des bandeaux et du popup, vitesse ressentie (Core Web Vitals). Purge après 13 mois, exports CSV. |
| 4. Interface d'administration | 22 écrans sur `/admin/` : pages et SEO (aperçu Google, contrôles), textes, fiches, médiathèque, bandeaux, popup, traductions, langues, publication et versions, rapport SEO, statistiques, redirections, utilisateurs, réglages, journal, compte. Utilisable sur téléphone. |

**Vérifié** :
- **Tests automatiques** : 36 tests (connexion et droits, traductions, médias, bandeaux, popup, publication et restauration, éditeur Live Music, statistiques, sécurité de l'admin).
- **Dans le navigateur, parcours complet** : modifier un texte, le traduire, prévisualiser, publier, puis revenir à la version précédente.
- **Dans le navigateur, autres essais** :
  - ajout d'un concert ;
  - envoi d'une photo ;
  - compte traducteur et compte Live Music ;
  - affichage sur téléphone.
- **Sécurité** : les bibliothèques de l'admin (Alpine.js 3.17.4, Tailwind 4.3.3, Chart.js 4.5.1) sont servies par le serveur lui-même, sans CDN tiers, avec une politique de sécurité stricte.

Documentation : [Backend/README.md](Backend/README.md) (commandes, rôles, écrans, API) et [Backend/ARCHITECTURE.md](Backend/ARCHITECTURE.md) (architecture et modèle de données).

## 2. Ce qu'il reste à faire

### 2.1 À obtenir ou à décider côté hôtel

| # | Sujet | Détail |
|---|---|---|
| 1 | Données « à confirmer » | Prix, économies et conditions des offres (séjour, séminaire) ; politique d'annulation et moyens de paiement ; capacités des salons (cabaret, banquet), de Matisse et de L'Aston Club ; itinéraire en tram depuis la gare ; programme Live Music. |
| 2 | Incohérences du site actuel | Saison du Moon Bar (mai–octobre ou juin–septembre) ; heure de fermeture (00 h 30 ou minuit) ; étage (7e ou 8e) ; numéro de réservation du rooftop (04 92 17 53 09 ou 04 89 22 20 06). |
| 3 | Moteur de réservation D-Edge | Lien profond trouvé le 28/10/2026 (dates, adultes et enfants transmis). Reste à confirmer avec D-Edge les langues autres que le français et, en option, un paramètre d'offre. |
| 4 | Avis clients | Passer aux avis réels (fiche Google), puis basculer le réglage « Avis affichés » sur « Avis réels ». |
| 5 | Vidéo du Hero | Fournir la prise de vue définitive : elle sera traitée en boucle et la vidéo réactivée. |
| 6 | Résidence Aston La Scala | Ajouter sur residenceastonlascala.com le lien vers l'hôtel (extrait prêt en bas de `index.html`). 17 appartements annoncés, 16 détaillés. Les clients de la Résidence ont-ils accès à la piscine ? Valider son moteur de réservation (D-Edge `J1P3`, `hotelId=29961`). |
| 7 | Géolocalisation des statistiques | Donner l'accord pour télécharger la base gratuite DB-IP (pays et régions), à renouveler chaque mois. |
| 8 | Politique de confidentialité | Faire valider et ajouter le paragraphe sur la mesure d'audience, prêt dans [docs/confidentialite-mesure-audience.md](docs/confidentialite-mesure-audience.md). |
| 9 | Traductions | L'anglais est activé mais aucune page n'est encore entièrement traduite : seul le français sera publié tant que ce n'est pas fait. Désigner les traducteurs (comptes à créer), puis l'italien et l'allemand. |
| 10 | Anciennes adresses | Relever les adresses actuelles de hotel-aston.com pour créer les redirections 301 et ne pas perdre le référencement. |
| 11 | Cartes de L'Horloge | Corrigées le 28/10/2026 (menu, vins, desserts), mais les liens pointent encore vers les pages de l'ancien site hotel-aston.com, qui disparaîtront à la mise en ligne. Reprendre leur contenu dans l'écran **Cartes du restaurant** (une page par carte). Vérifier aussi les cartes du Moon Bar. |

### 2.2 Développement restant

| Priorité | Sujet | Détail |
|---|---|---|
| Fait (27/10) | Fichiers de déploiement | Caddyfile, PM2, Dockerfile dans [deploy/](deploy/README.md). Restent l'hébergeur et l'adresse des alertes Let's Encrypt. |
| Fait (27/10) | Sauvegardes | `deploy/backup-db.sh` (base et snapshots, 7 jours) et `deploy/sync-media.sh` (rclone). Reste à choisir le stockage externe. |
| Fait (27/10) | Chemins en base | Chemins des versions et des snapshots relatifs au dossier des données : la base passe du PC Windows au serveur Linux sans retouche. |
| Fait (27/10) | Photos du site | 72 photos du site actuel dans la médiathèque (WebP en plusieurs tailles), 63 emplacements des gabarits, photos des fiches, image de partage (JPEG 1200×630, lu par tous les réseaux sociaux) et JSON-LD basculés : plus aucun appel à l'ancien CDN. Photos modifiables dans l'admin (onglet Textes de chaque page, fiches). Commande `media:import-site` à relancer sur une base neuve. |
| Avant mise en ligne | Comptes | Créer les vrais comptes sur le serveur ; les comptes de développement restent en local. |
| Fait (27/10) | SEO et GEO | 54 remarques corrigées (titles et descriptions raccourcis, sans fait nouveau). Visibilité dans les assistants IA : robots.txt qui autorise les robots IA, `llms.txt` généré depuis la base, nœud `WebPage` relié à l'hôtel sur chaque page, FAQ balisée sans les réponses « à confirmer ». Textes à relire et suite : [docs/seo-geo.md](docs/seo-geo.md) ; questions 25 à 31 pour l'hôtel. |
| En cours (28/10) | Tout modifier dans l'admin | Plan en 4 étapes validé le 28/10/2026. **Étape 1 faite** : écran **Menus et liens** (menu principal, menu mobile avec sous-menus, pied de page, cartes du restaurant et du bar, liens de la page Séminaires : ajouter, retirer, renommer, réordonner, masquer ; cible page, PDF ou adresse) et documents PDF dans la médiathèque. Écran **Cartes du restaurant** : une page par carte, rubriques et plats (nom, prix, description) modifiables et traduits, création et masquage d'une carte. Étapes suivantes : 2) catégories de chambres (ajouter, supprimer, réordonner), 3) offres en fiches, 4) blocs des pages Restaurant & bar et Séminaires. |
| Ensuite | Avis sur les pages restaurant et bars | Reporté à votre demande : L'Horloge, Moon Bar, L'Aston Club. |
| Ensuite | Vidéos externes | Lecteur YouTube / Vimeo chargé au clic (aujourd'hui un simple lien). |
| Option | Statistiques niveau 2 | Visiteurs qui reviennent (identifiant de 13 mois avec possibilité de refus). |
| Option | Statistiques niveau 3 | Import des réservations D-Edge et de Google Search Console : chiffre d'affaires par canal, positions dans Google. |
| Option | Rapport hebdomadaire | Résumé des statistiques par e-mail (il faut un serveur d'envoi). |

## 3. Ordre conseillé pour la mise en ligne

1. Réponses de l'hôtel sur les points 1 à 4 de la section 2.1, corrections dans l'admin.
2. Fichiers de déploiement et sauvegardes, installation du serveur (Node.js 24, ffmpeg, Caddy).
3. Import des photos, création des comptes, redirections des anciennes adresses.
4. Prévisualisation complète, puis publication.
5. Bascule du nom de domaine, déclaration du plan du site dans Google Search Console, clé IndexNow.
6. Traductions anglaises au fil de l'eau (publiées page par page dès qu'elles sont complètes), puis italien et allemand.

## 4. Pour reprendre le travail

```bash
npm --prefix hotelaston/Backend start
```

L'admin est sur http://localhost:3020/admin/. Les identifiants de développement sont dans `Backend/.dev-credentials` (non versionné).

```bash
npm --prefix hotelaston/Backend test
```

La maquette d'origine se lance avec `python -m http.server 8765 --directory hotelaston`.

Le code est sur GitHub (`mlsks/hotelaston`). La base n'enregistre plus de chemins absolus : le projet peut vivre dans n'importe quel dossier, y compris sur le serveur Linux. Les questions à envoyer à l'hôtel sont dans [docs/questions-hotel.md](docs/questions-hotel.md). Le contexte pour Claude (consignes et mémoire du projet) est dans `.claude/`.
