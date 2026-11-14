/**
 * Traitement d'une image dans un processus à part, lancé par inWorker() (pipeline.js) :
 *   node server/media/worker.js process|portrait|complete <id>
 * La mémoire prise par sharp (AVIF surtout) est rendue au système quand le processus se termine.
 * La base est déjà à jour (le serveur l'a migrée) : simple connexion, sans les ajouts du démarrage.
 * Écrit le résultat en JSON sur la sortie standard.
 */
import { openDb } from '../db/connection.js';
import { processMedia, refreshPortrait, completeMedia } from './pipeline.js';

const TASKS = { process: processMedia, portrait: refreshPortrait, complete: completeMedia };
const [task, id] = process.argv.slice(2);
if (!TASKS[task] || !Number(id)) {
  process.stderr.write(`Tâche inconnue : ${task} ${id}\n`);
  process.exit(2);
}
const db = openDb();
try {
  const out = await TASKS[task](db, Number(id));
  process.stdout.write(JSON.stringify(out ?? null));
} finally {
  db.close();
}
