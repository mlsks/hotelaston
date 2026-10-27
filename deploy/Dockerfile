# Back-office hotelaston en conteneur, alternative à PM2. Caddy reste à l'extérieur.
# Construction depuis la racine du dépôt : docker build -f deploy/Dockerfile -t hotelaston .
# Lancement : docker run -d --name hotelaston -p 127.0.0.1:3020:3020 -v hotelaston-data:/data hotelaston
# Caddy sert alors /data/public-dist et /data/media (volume monté sur l'hôte) au lieu de /srv/hotelaston/Backend/….
FROM node:24-bookworm-slim

# ffmpeg pour les vidéos ; outils de compilation si un module natif (better-sqlite3, argon2, sharp) n'a pas de binaire prêt
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 make g++ sqlite3 \
 && rm -rf /var/lib/apt/lists/*

# Le dépôt entier : l'import initial lit la maquette à la racine (config.legacyDir = Backend/..)
WORKDIR /app
COPY Backend/package*.json Backend/
RUN npm --prefix Backend ci --omit=dev && npm cache clean --force
COPY . .

# Base, médias, versions publiées : tout ce qui change vit dans le volume (ASTON_VAR_DIR)
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3020 ASTON_VAR_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3020

USER node
WORKDIR /app/Backend
CMD ["node", "server/index.js"]
