/**
 * Un seul build à la fois : file d'attente dans le processus + fichier verrou entre processus
 * (le serveur et une commande lancée à la main ne doivent pas écrire en même temps).
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const STALE_MS = 30 * 60 * 1000;
let chain = Promise.resolve();

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

function acquire() {
  fs.mkdirSync(path.dirname(config.lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(config.lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let holder = null;
      try { holder = JSON.parse(fs.readFileSync(config.lockFile, 'utf8')); } catch { /* verrou illisible : traité comme périmé */ }
      const stale = !holder || !alive(holder.pid) || Date.now() - holder.at > STALE_MS;
      if (!stale) throw new Error(`Un build est déjà en cours (processus ${holder.pid}).`);
      fs.rmSync(config.lockFile, { force: true });
    }
  }
  throw new Error('Impossible de poser le verrou de build.');
}

const release = () => fs.rmSync(config.lockFile, { force: true });

/** Exécute fn après les builds déjà en file, verrou posé. */
export function withBuildLock(fn) {
  const run = async () => {
    acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}
