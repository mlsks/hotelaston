/**
 * Versions de production : releases/<id>/, lien public-dist vers la version en ligne,
 * conservation des 3 dernières, restauration instantanée.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, fromVarPath } from '../config.js';
import { getDb } from '../db/connection.js';
import { nowIso } from '../lib/util.js';
import { withBuildLock } from './lock.js';
import { restoreContent } from './snapshot.js';

export const currentBuild = (db) => db.prepare('SELECT * FROM sys_builds WHERE is_current = 1 ORDER BY id DESC LIMIT 1').get();

/** Écrit une arborescence { 'fr/index.html': contenu, … } dans un dossier. */
export function writeTree(dir, files) {
  for (const [rel, content] of files) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'EEXIST']);

/**
 * Déplace un dossier généré vers sa place (prévisualisation, version).
 * Windows refuse un renommage tant qu'un fichier tout juste écrit est ouvert par l'antivirus,
 * l'indexation ou l'Explorateur (EPERM, EBUSY), ou si la destination existe déjà : on retire
 * la destination, on réessaie pendant quelques secondes, puis on copie en dernier recours.
 */
export function moveDir(src, dest, { attempts = 8, wait = 250 } = {}) {
  for (let i = 0; ; i += 1) {
    try {
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true, maxRetries: 3 });
      fs.renameSync(src, dest);
      return;
    } catch (err) {
      if (!BUSY.has(err.code)) throw err;
      if (i + 1 >= attempts) break;
      sleep(wait * (i + 1));
    }
  }
  fs.cpSync(src, dest, { recursive: true, force: true });
  try {
    fs.rmSync(src, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch { /* dossier temporaire retiré au prochain démarrage ou à la prochaine génération */ }
}

/**
 * Fait pointer public-dist vers une version.
 * Linux : renommage d'un lien temporaire par-dessus l'ancien, opération atomique.
 * Windows (développement) : jonction remplacée en deux temps.
 */
export function pointPublicDist(target) {
  const link = config.publicDist;
  const tmp = `${link}.next`;
  fs.rmSync(tmp, { force: true });
  // Dossier recopié depuis un autre ordinateur : le lien est devenu un vrai dossier, on le retire
  if (fs.existsSync(link) && !isLink(link)) fs.rmSync(link, { recursive: true, force: true });
  if (process.platform === 'win32') {
    fs.symlinkSync(target, tmp, 'junction');
    if (fs.existsSync(link) || isLink(link)) fs.unlinkSync(link);
    fs.renameSync(tmp, link);
  } else {
    fs.symlinkSync(path.relative(path.dirname(link), target), tmp);
    fs.renameSync(tmp, link);
  }
}

const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

export function activateRelease(db, buildId, releasePath) {
  pointPublicDist(releasePath);
  db.transaction(() => {
    db.prepare('UPDATE sys_builds SET is_current = 0 WHERE is_current = 1').run();
    db.prepare('UPDATE sys_builds SET is_current = 1 WHERE id = ?').run(buildId);
  })();
}

/** Garde les N dernières versions (et toujours celle en ligne) ; supprime les autres et leurs snapshots. */
export function pruneReleases(db, keep = config.keepReleases) {
  const releases = db.prepare(`SELECT * FROM sys_builds WHERE kind = 'production' AND status = 'success' AND release_path IS NOT NULL ORDER BY id DESC`).all();
  const current = currentBuild(db);
  const keepIds = new Set(releases.slice(0, keep).map((b) => b.id));
  if (current) keepIds.add(current.id);
  for (const b of releases) {
    if (keepIds.has(b.id)) continue;
    fs.rmSync(fromVarPath(b.release_path), { recursive: true, force: true });
    db.prepare('UPDATE sys_builds SET release_path = NULL WHERE id = ?').run(b.id);
  }
  const used = new Set(db.prepare(`SELECT snapshot_path FROM sys_builds WHERE release_path IS NOT NULL AND snapshot_path IS NOT NULL`).pluck().all().map((p) => path.resolve(fromVarPath(p))));
  if (fs.existsSync(config.snapshotsDir)) {
    for (const f of fs.readdirSync(config.snapshotsDir)) {
      const full = path.resolve(config.snapshotsDir, f);
      if (!used.has(full)) fs.rmSync(full, { force: true });
    }
  }
}

/**
 * Les dates lastmod du sitemap repartent de la version remise en ligne : sans cela, la
 * régénération suivante verrait chaque page restaurée comme « modifiée maintenant ».
 */
function resetPageState(db, releasePath) {
  const file = path.join(releasePath, '_meta', 'pages.json');
  if (!fs.existsSync(file)) return;
  const pages = JSON.parse(fs.readFileSync(file, 'utf8'));
  const insert = db.prepare('INSERT INTO sys_page_state (lang, path, content_hash, lastmod, first_seen_at) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM sys_page_state').run();
    for (const p of pages) insert.run(p.lang, p.path, p.contentHash, p.lastmod, p.lastmod);
  })();
}

/** Remet en ligne la version précédente (ou une version donnée) sans régénérer. */
export function restoreRelease({ buildId = null, withContent = false, userId = null } = {}) {
  return withBuildLock(async () => {
    const db = getDb();
    const current = currentBuild(db);
    const target = buildId
      ? db.prepare(`SELECT * FROM sys_builds WHERE id = ? AND kind = 'production' AND status = 'success'`).get(buildId)
      : db.prepare(`SELECT * FROM sys_builds WHERE kind = 'production' AND status = 'success' AND release_path IS NOT NULL AND id < ? ORDER BY id DESC LIMIT 1`).get(current?.id ?? Number.MAX_SAFE_INTEGER);
    const releasePath = fromVarPath(target?.release_path);
    if (!releasePath || !fs.existsSync(releasePath)) throw new Error('Aucune version précédente disponible.');
    if (target.id === current?.id) throw new Error(`La version #${target.id} est déjà en ligne.`);
    activateRelease(db, target.id, releasePath);
    resetPageState(db, releasePath);
    let backup = null;
    if (withContent) backup = await restoreContent(db, fromVarPath(target.snapshot_path));
    const now = nowIso();
    db.prepare(`INSERT INTO sys_builds (kind, triggered_by, status, user_id, warnings, started_at, finished_at)
      VALUES ('rollback', 'rollback', 'success', ?, ?, ?, ?)`)
      .run(userId, JSON.stringify([`Version #${target.id} remise en ligne (remplace #${current?.id ?? '—'})`, ...(backup ? [`Contenu restauré, sauvegarde : ${backup}`] : [])]), now, now);
    return target;
  });
}
