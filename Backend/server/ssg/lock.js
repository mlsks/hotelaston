/**
 * Un seul build à la fois : file d'attente dans le processus + fichier verrou entre processus
 * (le serveur et une commande lancée à la main ne doivent pas écrire en même temps).
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const STALE_MS = 30 * 60 * 1000;
let chain = Promise.resolve();

/** Heure de démarrage de ce processus (ms), notée dans le verrou. */
const STARTED = Math.round(Date.now() - process.uptime() * 1000);

/** Heure de démarrage d'un processus d'après /proc (Linux), null ailleurs ou s'il n'existe pas. */
function procInfo(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
    const btime = Number(/^btime (\d+)/m.exec(fs.readFileSync('/proc/stat', 'utf8'))[1]);
    const tgid = Number(/^Tgid:\s*(\d+)/m.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1]);
    return { started: btime * 1000 + (ticks * 1000) / 100, thread: tgid !== pid };
  } catch {
    return null;
  }
}

/*
 * Le processus qui a posé le verrou tourne-t-il encore ? Après un redémarrage (instance arrêtée faute de
 * mémoire sur Render, 14/11/2026), son numéro peut désigner un autre processus, voire un fil d'exécution
 * du nouveau serveur : le verrou restait alors bloqué 30 minutes. On compare donc aussi l'heure de démarrage.
 */
const alive = (holder) => {
  if (holder.pid === process.pid) return holder.started === STARTED; // file d'attente du processus : verrou d'avant un redémarrage
  try {
    process.kill(holder.pid, 0);
  } catch (err) {
    if (err.code !== 'EPERM') return false;
  }
  const info = procInfo(holder.pid);
  if (!info) return true;
  if (info.thread || info.started > holder.at + 1000) return false; // un processus né après le verrou ne l'a pas posé
  return !holder.started || Math.abs(info.started - holder.started) < 5000;
};

function acquire() {
  fs.mkdirSync(path.dirname(config.lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(config.lockFile, JSON.stringify({ pid: process.pid, started: STARTED, at: Date.now() }), { flag: 'wx' });
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let holder = null;
      try { holder = JSON.parse(fs.readFileSync(config.lockFile, 'utf8')); } catch { /* verrou illisible : traité comme périmé */ }
      const stale = !holder || !alive(holder) || Date.now() - holder.at > STALE_MS;
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
