/**
 * Outils partagés par les routes : langues, états de traduction, schémas courants.
 */
import { sha } from '../lib/util.js';
import { HttpError } from '../lib/http.js';

export const ID = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } };
export const ID_LANG = { type: 'object', required: ['id', 'lang'], properties: { id: { type: 'integer', minimum: 1 }, lang: { type: 'string', pattern: '^[a-z]{2}(-[a-z]{2})?$' } } };
export const DATE = { type: ['string', 'null'], maxLength: 40 };
export const STATUS = { type: 'string', enum: ['draft', 'ready'] };

export function assertLang(db, code) {
  const lang = db.prepare('SELECT * FROM cms_languages WHERE code = ?').get(code);
  if (!lang) throw new HttpError(404, `Langue inconnue : ${code}`);
  return lang;
}

/**
 * État d'une traduction par rapport au texte de la langue par défaut :
 * missing (vide), draft (à valider), outdated (le texte d'origine a changé depuis), ready.
 */
export function translationState(row, sourceHash, isDefault, hasValue = (r) => r && r.value !== null && r.value !== '') {
  if (!hasValue(row)) return 'missing';
  if (isDefault) return 'ready';
  if (row.status !== 'ready') return 'draft';
  if (sourceHash && row.source_hash && row.source_hash !== sourceHash) return 'outdated';
  return 'ready';
}

export const pageSourceHash = (row) => (row ? sha(`${row.title ?? ''}\n${row.meta_description ?? ''}`) : null);
export const valueHash = (value) => sha(String(value ?? ''));

/** Champs d'une ligne SQL modifiables via PATCH : ne garde que les clés autorisées et présentes. */
export function pick(body, allowed) {
  const out = {};
  for (const k of allowed) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  return out;
}

export function updateRow(db, table, id, fields, idColumn = 'id') {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE ${idColumn} = @__id`).run({ ...fields, __id: id });
}

export const bool = (v) => (v ? 1 : 0);
