/**
 * Mentions légales en bas du pied de page (codes GDS, société, médiateur de la consommation) :
 * trois textes riches « global.mentions-* » ajoutés au gabarit après l'import, modifiables dans
 * Textes communs. Seuls les libellés sont traduits ; numéros, noms propres et adresse restent tels quels.
 * Le français et les traductions sont livrés dans seeds/mentions-legales.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha, nowIso } from '../lib/util.js';

const SECTION = 'Pied de page · Mentions légales';
const SEED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seeds', 'mentions-legales.json');
// Code d'une langue du site → langue des traductions livrées
const SEED_ALIASES = { nb: 'no' };
// Placés juste après le dernier texte du pied de page (© Hôtel Aston La Scala)
const NEAR = 'global.067-span';
const LABELS = {
  'global.mentions-gds': 'Mentions légales : codes GDS',
  'global.mentions-societe': 'Mentions légales : société (nom, SIRET, RCS, TVA)',
  'global.mentions-mediateur': 'Mentions légales : médiateur de la consommation',
};

/**
 * Crée les textes absents (français livré) et complète les traductions qui manquent.
 * Une traduction livrée n'est « prête » que si le français de la base est celui qu'elle traduit ;
 * sinon elle arrive en brouillon, à relire. Une valeur déjà saisie n'est jamais remplacée.
 * @returns nombre de textes créés
 */
export function ensureLegalTexts(db, { seed = readSeed() } = {}) {
  return ensureSeededTexts(db, { seed, section: SECTION, labels: LABELS, near: NEAR, type: 'richtext' });
}

/**
 * Crée des textes communs livrés avec leurs traductions (seed : { clé: { langue: texte } }),
 * placés après le texte « near » dans la section donnée. Même règles que ci-dessus.
 */
export function ensureSeededTexts(db, { seed, section, labels = {}, near, type = 'text' }) {
  const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
  if (!def) return 0;
  const langs = db.prepare('SELECT code FROM cms_languages').pluck().all();
  const nearRow = db.prepare('SELECT position, section FROM cms_entries WHERE key = ?').get(near);
  const position = nearRow?.position ?? 0;
  section ??= nearRow?.section ?? 'Textes communs';
  const now = nowIso();
  const entryId = db.prepare('SELECT id FROM cms_entries WHERE key = ?').pluck();
  const insEntry = db.prepare(`INSERT INTO cms_entries (key, page_id, section, type, label, translatable, required, position, created_at, updated_at)
    VALUES (?, NULL, ?, ?, ?, 1, 1, ?, ?, ?)`);
  const valueOf = db.prepare('SELECT value FROM cms_entry_values WHERE entry_id = ? AND lang = ?').pluck();
  const insValue = db.prepare(`INSERT INTO cms_entry_values (entry_id, lang, value, status, source_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (entry_id, lang) DO NOTHING`);
  let added = 0;

  db.transaction(() => {
    for (const [key, byLang] of Object.entries(seed)) {
      const source = byLang[def];
      if (!source) continue;
      let id = entryId.get(key);
      if (!id) {
        id = insEntry.run(key, section, type, labels[key] || key, position, now, now).lastInsertRowid;
        insValue.run(id, def, source, 'ready', sha(source), now);
        added += 1;
      }
      const same = valueOf.get(id, def) === source;
      for (const lang of langs) {
        if (lang === def) continue;
        const value = byLang[lang] ?? byLang[SEED_ALIASES[lang]];
        if (value) insValue.run(id, lang, value, same ? 'ready' : 'draft', sha(source), now);
      }
    }
  })();
  return added;
}

function readSeed() {
  return fs.existsSync(SEED) ? JSON.parse(fs.readFileSync(SEED, 'utf8')) : {};
}
