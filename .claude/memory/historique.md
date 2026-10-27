---
name: historique
description: Demandes et décisions de l'utilisateur sur le projet Hôtel Aston, dans l'ordre (25–26 octobre 2026)
type: project
---

La conversation d'origine est restée sur le PC de développement ; voici ce qu'il faut en retenir.

## 25 octobre 2026 — maquette du site
- Refonte complète d'après la revue UX (PDF) : HTML / CSS / JS sans framework, boucles vidéo rendues avec Remotion.
- Choix : photos lues sur le CDN actuel de l'hôtel ; données non confirmées marquées `.verify` ; avis de démonstration étiquetés.
- Le Hero est revenu à la photo de la piscine ; la vidéo attend la prise de vue définitive.

## 26 octobre 2026 — corrections de la maquette
1. Retirer « jazz » de L'Aston Club ; règle des bars : le Moon Bar quand le temps le permet, sinon L'Aston Club (un seul ouvert à la fois).
2. Le lien vers la Résidence faisait quitter le site : page passerelle `#/appartements` créée, les trois liens « Nos appartements » y mènent, les liens vers la Résidence s'ouvrent dans un nouvel onglet avec suivi utm.
3. Texte : « ou scannez le QR code dans votre chambre ».
4. Parenthèses et phrase de la plage corrigées (CSS de `.extras li`).
5. Question « Que faut-il faire pour que le site soit multilingue ? » avec « Ne code pas » : réponse seulement.
6. « Tu as bien suivi la revue UX ? Ne code rien ! » : rapport, 35 règles sur 36. Avis sur les pages restaurant et bars : **« Pas maintenant, on garde ça pour plus tard »**.

## 26 octobre 2026 — back-office
7. Demande : créer `Backend/` avec un cahier des charges (CMS, générateur statique avec prévisualisation et dist, retour aux 3 derniers builds, cron de nuit ; 6 modules ; Node + Fastify + Cheerio + SQLite WAL + sharp + node-cron ; admin Tailwind CDN + Alpine + Chart.js ; Caddyfile + PM2 / Docker). Méthode imposée : architecture, **validation**, puis 4 briques.
8. Retours sur l'architecture : plan du site toujours à jour ? SEO ? statistiques plus fines « comme dans l'industrie » ? → ARCHITECTURE v2 (sitemap à lastmod fiable, IndexNow, section SEO, statistiques en 3 niveaux).
9. « Je retiens seulement le niveau 1 des statistiques pour l'instant, avec tes réponses par défaut aux autres questions » → brique 1.
10. Brique 2 lancée (API, connexion et rôles, médias, bandeaux et popup, textes du JavaScript traduisibles).
11. Avant la brique 3 : **ajouter un éditeur qui n'a accès qu'au Live Music**, puis brique 3 (statistiques niveau 1).
12. Brique 4 (interface d'administration). Écart assumé avec le cahier des charges : Tailwind, Alpine et Chart.js servis par le serveur depuis node_modules plutôt que par un CDN (plus sûr, versions figées).
13. **« No stop here »** : ne pas enchaîner sur les fichiers de déploiement. Bilan demandé : `BILAN.md` et `BILAN.html` à la racine de `hotelaston/`.
14. L'utilisateur ferme le PC et copie `hotelaston/` sur son portable : mémoire et consignes recopiées dans `hotelaston/.claude/`.
15. 27/10/2026 : code mis sur GitHub (`mlsks/hotelaston`), travail depuis le dépôt. Intégrés par PR : fichiers de déploiement (`deploy/`), questions pour l'hôtel et paragraphe de confidentialité (`docs/`), chemins relatifs en base. `Backend/server/media/` manquait (exclu par le `.gitignore`).
16. 27/10/2026 : copie locale de foupax2 vérifiée identique à `origin/main` (rien à supprimer, seules les données locales ignorées restent : `.env`, `.dev-credentials`, `media/`, `storage/`, `releases/`, `preview/`, `public-dist/`). Règle : toute modification est poussée sur GitHub.
17. 28/10/2026 : **fiches artistes du Live Music** (collection `artists` : nom, style, présentation, site internet facultatif, photo de la médiathèque). Le concert choisit son artiste dans la liste ou le crée sur place ; photo, lien et `performer` MusicGroup sur le site. L'affiche d'octobre 2026 (Moana Folks, The Soulmate, Alex Tales, Habanita, Festival de Forrò, Jude Todd, Romain & Cley…) montrée en exemple : **pas importée**, à proposer à l'utilisateur.

## En attente d'une décision de l'utilisateur
- Déploiement : choisir l'hébergeur, le stockage externe des sauvegardes et l'adresse des alertes Let's Encrypt.
- Téléchargement de la base DB-IP (géolocalisation) : son accord est nécessaire.
- Avis sur L'Horloge, Moon Bar, L'Aston Club : reportés à sa demande.
- Informations à obtenir de l'hôtel : liste dans `BILAN.md`, section 2.1.

Voir [[hotel-aston-site]] et [[user-profile]].
- 27/10/2026 : « ok on importe dans la médiathèque » : photos du site actuel téléchargées dans la médiathèque locale et gabarits basculés (point « Photos du site » du BILAN). Sauvegarde de la base avant l'import : `Backend/storage/backups/avant-photos-2026-10-27.sqlite`.
- 27/10/2026 : « on attaque le SEO, mais également le GEO car aujourd'hui il est primordial ! » : 54 remarques SEO corrigées (titles et descriptions raccourcis dans la base par l'API, aucun fait ajouté), GEO : robots.txt nommant les robots IA (tous autorisés, entraînement compris), `llms.txt` généré, nœud `WebPage` par page, FAQ sans réponses « à confirmer », balise robots max-snippet. Relecture et suite : `docs/seo-geo.md` ; questions 25 à 31 ajoutées pour l'hôtel.
