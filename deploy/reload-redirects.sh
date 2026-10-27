#!/usr/bin/env bash
# Recharge Caddy quand le fichier de redirections de la version en ligne a changé
# (publication ou restauration). Sans changement, ne fait rien.
# cron (root) : */5 * * * * /srv/hotelaston/deploy/reload-redirects.sh >> /var/log/hotelaston/caddy-reload.log 2>&1
set -euo pipefail

FILE="${FILE:-/srv/hotelaston/Backend/public-dist/_meta/redirects.caddy}"
STATE="${STATE:-/var/lib/hotelaston/redirects.sha256}"

[ -f "$FILE" ] || exit 0
mkdir -p "$(dirname "$STATE")"
NEW="$(sha256sum "$FILE" | cut -d' ' -f1)"
OLD="$(cat "$STATE" 2>/dev/null || true)"
[ "$NEW" = "$OLD" ] && exit 0

caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy
echo "$NEW" > "$STATE"
echo "$(date -Is) Caddy rechargé (redirections modifiées)"
