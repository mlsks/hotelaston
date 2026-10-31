# Projet Hôtel Aston La Scala — consignes pour Claude

Ce dossier vient du PC de développement (`C:\dev\Claude\Remotion\hotelaston`), copié le 26 octobre 2026 pour continuer le travail sur un autre ordinateur. La conversation d'origine n'a pas suivi : tout le contexte utile est ici.

## À lire avant de commencer
1. `.claude/memory/MEMORY.md`, puis les trois notes qu'il référence : profil de l'utilisateur, notes du projet, historique des demandes et décisions.
2. `BILAN.md` : ce qui est fait, ce qui reste à faire, ordre conseillé pour la mise en ligne.
3. `README.md` (maquette), `Backend/README.md` (commandes, rôles, écrans, API), `Backend/ARCHITECTURE.md` (architecture et modèle de données).
4. `docs/guide-utilisateur.md` : guide de l'admin pour l'utilisateur et l'hôtel. À tenir à jour quand un écran ou un usage change ; ne modifier que le Markdown, puis `node tools/md-to-html.mjs docs/guide-utilisateur.md` régénère la version HTML (un test vérifie qu'elle est à jour).

Tenir les notes de `.claude/memory/` à jour quand une décision importante est prise : elles servent de mémoire d'une session à l'autre.

## Façon de travailler
- L'utilisateur écrit en français : répondre en français ; la documentation du projet est en français.
- « Ne code pas » / « Ne code rien » : répondre ou analyser seulement, sans modifier de fichier.
- Gros chantier : quelques questions décisives ou une proposition d'architecture d'abord, attendre la validation, puis avancer seul.
- Toute modification du code ou de la documentation est commitée et poussée sur GitHub (`mlsks/hotelaston`) dans la foulée : la copie locale ne doit jamais diverger du dépôt (règle du 27/10/2026).
- Ne jamais publier le site de l'hôtel, ni un de ses écrans, en Artifact ou sur un service externe : il porte la marque d'un établissement réel.
- Ne jamais recopier dans une réponse les mots de passe de `Backend/.dev-credentials`.
- Ne rien télécharger d'externe sans l'accord de l'utilisateur (en particulier la base de géolocalisation DB-IP).
- Ne pas inventer d'informations sur l'hôtel : ce qui n'est pas confirmé reste marqué `.verify` dans la maquette ou figure dans `BILAN.md`.
- Faits confirmés : un seul bar ouvert à la fois, le Moon Bar sur le toit quand le temps le permet, sinon L'Aston Club au 7e étage ; jamais « jazz » pour L'Aston Club.

## Lancer et vérifier
- Back-office : `npm --prefix Backend start`, puis http://localhost:3020/admin/ (site publié sur `/fr/`, prévisualisation sur `/preview/fr/`, maquette d'origine sur `/legacy/` quand `SERVE_LEGACY=1` dans `Backend/.env`).
- Tests : `npm --prefix Backend test` (108 tests, tous verts au 31/10/2026 ; 1 est sauté sans ffmpeg).
- Maquette seule : `python tools/serve.py --port 8765`.
- Configurations de lancement du navigateur intégré : `.claude/launch.json` (dossier `hotelaston` ouvert comme projet).
- Ouvrir `/fr/` en local ajoute des visites aux statistiques de développement : les effacer après les tests (tables `an_events`, `an_visits`, `an_salts`, `an_daily`).

## Après la copie sur un nouvel ordinateur
- **Emplacement libre** depuis le 27/10/2026 : la base enregistre les chemins des versions et des snapshots relativement au dossier des données (`config.js`, `toVarPath` / `fromVarPath`) ; les anciens chemins `C:\…` sont réécrits au démarrage (`relativizeBuildPaths`).
- Code sur GitHub : `mlsks/hotelaston`. Ne jamais ignorer un dossier par un motif libre dans un `.gitignore` (`media/` excluait `server/media/`) : ancrer avec `/`.
- `node_modules` : s'ils n'ont pas été copiés, lancer `npm install` dans `Backend/` (et dans `video/` pour rendre les boucles Remotion). Il faut Node.js 22 ou plus ; ffmpeg pour les vidéos ; Python 3 pour la maquette et `video/make_hero_loop.py`.
- `Backend/public-dist` est un lien vers la version en ligne ; une copie Windows en fait souvent un dossier ordinaire. Rien à faire : le serveur le sert tel quel et le remplace par un lien à la prochaine publication ou restauration (`server/ssg/release.js`, `pointPublicDist`).
- Fichiers cachés à vérifier après la copie : `.claude/`, `Backend/.env`, `Backend/.dev-credentials`.
