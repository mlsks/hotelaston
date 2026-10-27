# Installer et tester le site sur un PC Windows

Le back-office (Node.js) fait tout tourner : l'admin, la prévisualisation et le site publié. Une seule commande le lance. La maquette d'origine peut aussi être ouverte à part, pour comparer.

## 1. Logiciels à installer (une seule fois)

| Logiciel | Pourquoi | Installation (PowerShell) |
|---|---|---|
| **Git** | Récupérer le code depuis GitHub | `winget install Git.Git` |
| **Node.js 24 LTS** (22 minimum) | Back-office | `winget install OpenJS.NodeJS.LTS` |
| ffmpeg (facultatif) | Durée et image d'aperçu des vidéos envoyées dans la médiathèque. Sans lui, tout le reste marche. | `winget install Gyan.FFmpeg` |
| Python 3 (facultatif) | Maquette d'origine seule | `winget install Python.Python.3.12` |

Fermer puis rouvrir PowerShell après l'installation, puis vérifier avec `node -v` (doit afficher v22 ou plus) et `git --version`.

## 2. Récupérer le code

Le dossier peut être n'importe où (la base n'enregistre plus de chemins absolus). Exemple :

```powershell
cd C:\dev
git clone https://github.com/mlsks/hotelaston.git
cd hotelaston\Backend
```

Pour mettre à jour plus tard : `git pull` dans `C:\dev\hotelaston`.

## 3. Installer et initialiser (une seule fois)

Toujours dans `hotelaston\Backend` :

```powershell
npm install
Copy-Item .env.example .env
npm run import
node server/cli.js user:add votre@adresse.fr admin --name="Votre nom"
npm run publish
```

| Commande | Effet |
|---|---|
| `npm install` | Télécharge les bibliothèques (`node_modules`, environ 2 minutes). |
| `Copy-Item .env.example .env` | Crée les réglages locaux (port 3020 par défaut). |
| `npm run import` | Remplit la base (`storage\db\aston.sqlite`) depuis la maquette : 25 pages, environ 1 300 textes, chambres, services. Copie les photos locales dans `media\`. |
| `user:add` | Crée un compte administrateur. **Le mot de passe s'affiche une seule fois** : le noter. Nouveau mot de passe : `node server/cli.js user:password votre@adresse.fr`. |
| `npm run publish` | Génère une première version du site public (sans elle, `/fr/` reste vide). |

Comptes supplémentaires pour tester les rôles :

```powershell
node server/cli.js user:add traducteur@exemple.fr translator --name="Traducteur" --langs=en
node server/cli.js user:add musique@exemple.fr editor --name="Live Music" --scopes=live-music
```

## 4. Lancer

```powershell
npm start
```

Laisser la fenêtre ouverte (Ctrl+C pour arrêter), puis ouvrir dans le navigateur :

| Adresse | Contenu |
|---|---|
| http://localhost:3020/admin/ | Back-office (connexion avec le compte créé) |
| http://localhost:3020/fr/ | Site publié |
| http://localhost:3020/preview/fr/ | Prévisualisation, brouillons compris (connexion requise) |

Parcours de test conseillé : modifier un texte dans « Pages », cliquer « Prévisualiser », vérifier dans `/preview/fr/`, puis « Publier » et voir le changement sur `/fr/`. Dans « Publication et versions », « Restaurer » remet la version précédente.

Maquette d'origine, pour comparer : ajouter `SERVE_LEGACY=1` dans `Backend\.env` et relancer, puis http://localhost:3020/legacy/. Ou, sans le back-office, depuis `C:\dev\hotelaston` : `python tools/serve.py --port 8765`, puis http://localhost:8765/.

## 5. Tests automatiques

```powershell
npm test
```

40 tests, tous doivent réussir (une dizaine de secondes). Ils travaillent dans un dossier temporaire et ne touchent pas à la base locale.

## 6. Problèmes courants sous Windows

| Message ou symptôme | Solution |
|---|---|
| `npm.ps1 cannot be loaded because running scripts is disabled` | Une fois : `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Ou taper `npm.cmd` au lieu de `npm`. |
| `node` ou `npm` « n'est pas reconnu » | Fermer et rouvrir PowerShell après l'installation de Node. |
| `npm install` échoue sur `better-sqlite3`, `argon2` ou `sharp` (gyp, Visual Studio) | Version de Node sans modules précompilés : installer Node 24 LTS (pas une version « Current »), supprimer `node_modules`, relancer `npm install`. |
| `Import déjà fait (contenus présents)` | La base est déjà remplie : rien à faire. Pour repartir de zéro, arrêter le serveur et supprimer `Backend\storage`, `Backend\media`, `Backend\releases` et `Backend\public-dist`, puis reprendre l'étape 3. |
| `EADDRINUSE … 3020` | Un autre serveur occupe le port : arrêter l'autre fenêtre `npm start`, ou mettre `PORT=3030` dans `.env`. |
| `EBUSY` ou `EPERM` à la publication ou à la restauration | Un programme tient un fichier ouvert : fermer les autres `npm start`, un explorateur SQLite (DB Browser), ou attendre l'antivirus, puis recommencer. |
| `/fr/` affiche une page vide ou 404 | Rien n'est publié : `npm run publish`, ou « Publier » dans l'admin. |
| Vidéo envoyée sans durée ni aperçu | ffmpeg absent ou pas dans le PATH : l'installer, rouvrir PowerShell, relancer `npm start`. |
| Le site ne se met pas à jour après une modification | Normal : le site public ne change qu'après « Publier ». La prévisualisation montre les brouillons. |

Note : ouvrir `/fr/` en local ajoute des visites aux statistiques de développement. Elles restent sur ce PC et n'ont aucun effet sur le site réel.
