/**
 * Chemins enregistrés en base : relatifs au dossier des données, et anciens chemins absolus
 * Windows (copie de la base vers un serveur Linux) relus et réécrits.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VAR = fs.mkdtempSync(path.join(os.tmpdir(), 'aston-paths-'));
process.env.ASTON_VAR_DIR = VAR;
process.env.ASTON_NO_DOTENV = '1';

const { config, toVarPath, fromVarPath } = await import('../server/config.js');
const { getDb, closeDb, relativizeBuildPaths } = await import('../server/db/connection.js');
const { importLegacy } = await import('../server/db/import-legacy.js');
const { seedSitePhotos } = await import('./helpers/site-photos.js');
const { runBuild } = await import('../server/ssg/build.js');
const { restoreRelease, moveDir } = await import('../server/ssg/release.js');

after(() => {
  closeDb();
  fs.rmSync(VAR, { recursive: true, force: true });
});

test('un chemin sous le dossier des données est enregistré en relatif, avec des « / »', () => {
  assert.equal(toVarPath(path.join(config.releasesDir, '12')), 'releases/12');
  assert.equal(toVarPath(path.join(config.snapshotsDir, 'cms-12.sqlite')), 'storage/snapshots/cms-12.sqlite');
  assert.equal(fromVarPath('releases/12'), path.join(VAR, 'releases', '12'));
  assert.equal(toVarPath(null), null);
});

test('un ancien chemin Windows est replacé sous le dossier des données actuel', () => {
  assert.equal(fromVarPath('C:\\dev\\Claude\\Remotion\\hotelaston\\Backend\\releases\\7'), path.join(VAR, 'releases', '7'));
  assert.equal(fromVarPath('C:\\dev\\Claude\\Remotion\\hotelaston\\Backend\\storage\\snapshots\\cms-7.sqlite'), path.join(VAR, 'storage', 'snapshots', 'cms-7.sqlite'));
  assert.equal(fromVarPath('/autre/serveur/Backend/releases/7'), path.join(VAR, 'releases', '7'));
});

test('les chemins absolus déjà en base sont réécrits en relatif', () => {
  const db = getDb();
  const id = Number(db.prepare(`INSERT INTO sys_builds (kind, triggered_by, status, snapshot_path, release_path, started_at)
    VALUES ('production', 'manual', 'failed', ?, ?, ?)`)
    .run('C:\\dev\\Claude\\Remotion\\hotelaston\\Backend\\storage\\snapshots\\cms-99.sqlite', 'C:\\dev\\Claude\\Remotion\\hotelaston\\Backend\\releases\\99', new Date().toISOString()).lastInsertRowid);
  assert.equal(relativizeBuildPaths(db), 1);
  const row = db.prepare('SELECT snapshot_path, release_path FROM sys_builds WHERE id = ?').get(id);
  assert.deepEqual(row, { snapshot_path: 'storage/snapshots/cms-99.sqlite', release_path: 'releases/99' });
  assert.equal(relativizeBuildPaths(db), 0);
  db.prepare('DELETE FROM sys_builds WHERE id = ?').run(id);
});

test('publication et restauration fonctionnent avec les chemins relatifs', async () => {
  const db = getDb();
  importLegacy(db, { writeTemplates: false, log: () => {} });
  await seedSitePhotos(db);
  const quiet = { log: () => {} };
  await runBuild({ kind: 'production', ...quiet });
  db.prepare(`UPDATE cms_page_i18n SET title = title || ' (2)' WHERE lang = 'fr' AND page_id = (SELECT MIN(page_id) FROM cms_page_i18n)`).run();
  await runBuild({ kind: 'production', ...quiet });
  const builds = db.prepare(`SELECT id, snapshot_path, release_path FROM sys_builds WHERE kind = 'production' AND status = 'success' ORDER BY id`).all();
  assert.equal(builds.length, 2);
  for (const b of builds) {
    assert.equal(b.release_path, `releases/${b.id}`);
    assert.equal(b.snapshot_path, `storage/snapshots/cms-${b.id}.sqlite`);
    assert.ok(fs.existsSync(fromVarPath(b.snapshot_path)));
  }
  const target = await restoreRelease({ withContent: true });
  assert.equal(target.id, builds[0].id);
  assert.equal(fs.realpathSync(config.publicDist), fs.realpathSync(fromVarPath(builds[0].release_path)));
});

test('publication malgré un ancien dossier de version du même numéro (base recréée, copie Windows)', async () => {
  const db = getDb();
  const next = db.prepare("SELECT MAX(id) + 1 FROM sys_builds").pluck().get();
  const stale = path.join(config.releasesDir, String(next));
  fs.mkdirSync(path.join(stale, 'fr'), { recursive: true });
  fs.writeFileSync(path.join(stale, 'fr', 'ancien.html'), 'ancien');
  db.prepare(`UPDATE cms_page_i18n SET title = title || ' (3)' WHERE lang = 'fr' AND page_id = (SELECT MIN(page_id) FROM cms_page_i18n)`).run();
  const res = await runBuild({ kind: 'production', log: () => {} });
  assert.equal(res.status, 'success', res.error);
  assert.equal(res.id, next);
  assert.ok(!fs.existsSync(path.join(stale, 'fr', 'ancien.html')));
  assert.ok(fs.existsSync(path.join(stale, 'fr', 'index.html')));
  assert.deepEqual(fs.readdirSync(config.varDir).filter((n) => n.startsWith('.build-')), []);
});

test('déplacement d\'un dossier refusé un moment (Windows : antivirus, indexation) : nouvel essai, puis copie', () => {
  const src = path.join(VAR, 'move-src');
  const dest = path.join(VAR, 'move-dest');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'a');
  const rename = fs.renameSync;
  let calls = 0;
  const eperm = () => { calls += 1; throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' }); };
  try {
    fs.renameSync = (...args) => (calls < 2 ? eperm() : rename(...args));
    moveDir(src, dest, { wait: 1 });
    assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'a');
    assert.equal(calls, 2);
    // Toujours refusé : copie
    fs.renameSync = eperm;
    moveDir(dest, src, { attempts: 3, wait: 1 });
    assert.equal(fs.readFileSync(path.join(src, 'a.txt'), 'utf8'), 'a');
    assert.ok(!fs.existsSync(dest));
  } finally {
    fs.renameSync = rename;
  }
});
