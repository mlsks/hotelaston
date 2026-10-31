# Mise en ligne : serveur Linux

Le site public est 100 % statique : Caddy le sert directement depuis `Backend/public-dist` (lien vers la version en ligne `Backend/releases/<id>/`) et `Backend/media/`. Node (Fastify) ne reçoit que `/api`, `/admin` et `/preview`.

| Fichier | Rôle |
|---|---|
| `Caddyfile` | HTTPS, `hotel-aston.com` → `www`, site statique, cache, médias, redirections générées, 404, proxy vers Node (port 3020) |
| `reload-redirects.sh` | Recharge Caddy quand une publication change `_meta/redirects.caddy` |
| `ecosystem.config.cjs` | Back-office lancé par PM2 (une seule instance : SQLite et cron de minuit) |
| `Dockerfile` (+ `.dockerignore` à la racine) | Alternative à PM2 : back-office en conteneur, données dans le volume `/data` |
| `backup-db.sh` | Copie nocturne de la base (`sqlite3 .backup`, contrôle d'intégrité) et des snapshots, 7 jours |
| `sync-media.sh` | Copie de `media/`, `storage/uploads/` et des sauvegardes vers un stockage externe (rclone) |

## Emplacements sur le serveur

| Quoi | Où |
|---|---|
| Dépôt | `/srv/hotelaston` |
| Base | `/srv/hotelaston/Backend/storage/db/aston.sqlite` |
| Médias | `/srv/hotelaston/Backend/media/` |
| Version en ligne | `/srv/hotelaston/Backend/public-dist` → `releases/<id>/` |
| Sauvegardes | `/srv/hotelaston/backups/db/` |
| Journaux | `/var/log/hotelaston/` |

Les chemins enregistrés en base (versions publiées et snapshots) sont relatifs au dossier des données (`ASTON_VAR_DIR`, par défaut `Backend/`). Une base venue du PC Windows fonctionne donc telle quelle : au premier démarrage, les anciens chemins `C:\…` sont réécrits automatiquement.

## Installation (Debian ou Ubuntu)

```bash
# Node.js 24 (NodeSource ou nvm), Caddy (dépôt officiel), puis :
sudo apt install ffmpeg sqlite3 rclone
sudo npm i -g pm2

sudo mkdir -p /srv/hotelaston /srv/hotelaston/backups/db /var/log/hotelaston
sudo git clone https://github.com/mlsks/hotelaston.git /srv/hotelaston
cd /srv/hotelaston/Backend
npm ci --omit=dev
cp .env.example .env        # vérifier SITE_URL, renseigner INDEXNOW_KEY
npm run import              # une seule fois sur une base neuve
node server/cli.js user:add <e-mail> admin --name="…"
pm2 start ../deploy/ecosystem.config.cjs && pm2 save && pm2 startup

sudo cp ../deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
chmod +x ../deploy/*.sh
```

Caddy doit pouvoir lire `Backend/public-dist`, `Backend/releases` et `Backend/media` (utilisateur `caddy`) : donner le dossier à l'utilisateur qui lance PM2 et ouvrir la lecture au groupe `caddy`.

Reprendre la base du PC plutôt que réimporter : arrêter le serveur sur le PC, copier `Backend/storage/`, `Backend/media/` et `Backend/releases/` dans `/srv/hotelaston/Backend/`, puis lancer une publication depuis l'admin pour recréer `public-dist`.

## Tâches planifiées

```bash
# crontab -e (utilisateur du back-office)
15 3 * * * /srv/hotelaston/deploy/backup-db.sh  >> /var/log/hotelaston/backup.log 2>&1
45 3 * * * /srv/hotelaston/deploy/sync-media.sh >> /var/log/hotelaston/backup.log 2>&1

# sudo crontab -e (root : recharge de Caddy)
*/5 * * * * /srv/hotelaston/deploy/reload-redirects.sh >> /var/log/hotelaston/caddy-reload.log 2>&1
```

La régénération de minuit, le nettoyage des médias et les agrégats des statistiques sont faits par le back-office lui-même (cron interne).

Tester une restauration au moins une fois : `gunzip` d'une sauvegarde, `sqlite3 … "PRAGMA integrity_check"`, lancement du back-office dessus avec `ASTON_VAR_DIR` pointant vers une copie.

## Avec Docker

```bash
docker build -f deploy/Dockerfile -t hotelaston .
docker run -d --name hotelaston --restart unless-stopped -p 127.0.0.1:3020:3020 -v /srv/hotelaston-data:/data hotelaston
```

Dans le `Caddyfile`, remplacer `/srv/hotelaston/Backend` par `/srv/hotelaston-data`, et lancer les scripts de sauvegarde avec `VAR=/srv/hotelaston-data`.

## Reste à décider

- Adresse e-mail pour les alertes Let's Encrypt (en tête du `Caddyfile`).
- Stockage externe pour `sync-media.sh` (S3, Backblaze B2, OVH…) et sa configuration rclone.
- Hébergeur du serveur.

## Démo sur Render

Pour montrer le site sans serveur à soi. Une seule instance : SQLite et le cron de minuit l'exigent.

**Disque persistant obligatoire.** Sur le plan gratuit de Render, le disque est effacé à chaque déploiement, redémarrage et mise en veille (15 min sans visite) : la base repartirait vide, sans les photos, les traductions ni les modifications faites dans l'admin, et sans compte pour se connecter (pas de console sur le plan gratuit). Il faut donc le plan **Starter** avec un **disque** (1 Go suffit).

Réglages du service (*New → Web Service*, dépôt `mlsks/hotelaston`) :

| Champ | Valeur |
|---|---|
| Language | Node |
| Branch | `main` |
| Root Directory | `Backend` |
| Build Command | `npm ci --omit=dev` |
| Start Command | `node server/index.js` |
| Instance Type | Starter |
| Health Check Path (Advanced) | `/api/health` |
| Disk (Advanced) | Mount Path `/var/data`, 1 Go |

Variables d'environnement : `NODE_VERSION=22`, `ASTON_VAR_DIR=/var/data`, `DEMO_PASSWORD=<mot de passe de la démo>` (ou `NOINDEX=1` pour une démo ouverte mais jamais indexée). `PORT` et `HOST` : rien à faire, Render fournit le port et le serveur écoute alors sur `0.0.0.0`. Laisser `SITE_URL` à l'adresse du vrai site.

Mettre le contenu du PC sur le disque (le serveur du PC arrêté) : envoyer `Backend/storage/` et `Backend/media/` dans `/var/data/` par SSH (`scp -r`, adresse SSH dans l'onglet *Connect* du service), redémarrer le service, se connecter à `/admin/` avec son compte habituel et cliquer **Publier**. Sans copie : `npm run import`, `node server/cli.js media:import-site` puis `node server/cli.js user:add …` dans le *Shell* du service, puis **Publier** (le contenu est alors celui de la maquette, sans les traductions ni les réglages du PC).

Limites : pas de ffmpeg dans l'environnement Node de Render (téléverser une vidéo échoue, celles déjà présentes s'affichent) ; les visites de la démo s'ajoutent aux statistiques de la base copiée.
