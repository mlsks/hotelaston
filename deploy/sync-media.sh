#!/usr/bin/env bash
# Copie des médias, des originaux téléversés et des sauvegardes de la base hors du serveur.
# Nécessite rclone configuré vers un stockage externe (S3, Backblaze B2, OVH Object Storage…).
# cron : 45 3 * * * /srv/hotelaston/deploy/sync-media.sh >> /var/log/hotelaston/backup.log 2>&1
set -euo pipefail

VAR="${VAR:-/srv/hotelaston/Backend}"
BACKUPS="${BACKUPS:-/srv/hotelaston/backups/db}"
REMOTE="${REMOTE:-hotelaston-backup:hotelaston}"   # nom du remote rclone, à créer avec « rclone config »

# copy (et non sync) : un fichier effacé par erreur sur le serveur reste dans la copie distante
rclone copy "$VAR/media" "$REMOTE/media" --transfers 4 --checksum
[ -d "$VAR/storage/uploads" ] && rclone copy "$VAR/storage/uploads" "$REMOTE/uploads" --transfers 4 --checksum
rclone copy "$BACKUPS" "$REMOTE/db" --transfers 2
# Sur le stockage distant, prévoir une règle de cycle de vie (par exemple 30 jours) pour db/

echo "$(date -Is) OK synchro media + uploads + db"
