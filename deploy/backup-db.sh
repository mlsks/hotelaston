#!/usr/bin/env bash
# Sauvegarde nocturne de la base SQLite et des snapshots de contenu, 7 jours conservés.
# cron : 15 3 * * * /srv/hotelaston/deploy/backup-db.sh >> /var/log/hotelaston/backup.log 2>&1
set -euo pipefail

VAR="${VAR:-/srv/hotelaston/Backend}"   # ASTON_VAR_DIR du serveur (le volume /data avec Docker)
DB="$VAR/storage/db/aston.sqlite"
DEST="${DEST:-/srv/hotelaston/backups/db}"
KEEP_DAYS="${KEEP_DAYS:-7}"

mkdir -p "$DEST"
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="$DEST/aston_$STAMP.sqlite"

# .backup est sûr pendant que Node écrit (mode WAL), contrairement à une simple copie
sqlite3 "$DB" ".backup '$OUT'"
sqlite3 "$OUT" "PRAGMA integrity_check;" | grep -qx ok || { echo "$(date -Is) ERREUR intégrité $OUT"; exit 1; }
gzip -9 "$OUT"

# Snapshots des versions conservées : nécessaires pour « restaurer aussi le contenu »
if [ -d "$VAR/storage/snapshots" ]; then
  tar -czf "$DEST/snapshots_$STAMP.tar.gz" -C "$VAR/storage" snapshots
fi

find "$DEST" \( -name 'aston_*.sqlite.gz' -o -name 'snapshots_*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) OK $OUT.gz"
