// PM2 : back-office hotelaston
// Démarrage : pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
// Les réglages propres au serveur (SITE_URL, INDEXNOW_KEY…) sont dans Backend/.env, lu au démarrage.
module.exports = {
  apps: [
    {
      name: 'hotelaston-backend',
      cwd: '/srv/hotelaston/Backend',
      script: 'server/index.js',
      instances: 1, // SQLite et cron de minuit : une seule instance, jamais de mode cluster
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '500M', // sharp et ffmpeg pendant le traitement des médias
      kill_timeout: 10000, // laisse le temps d'écrire le dernier lot de statistiques
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1', // seul Caddy parle à Node
        PORT: 3020,
      },
      out_file: '/var/log/hotelaston/out.log',
      error_file: '/var/log/hotelaston/error.log',
      time: true,
    },
  ],
};
