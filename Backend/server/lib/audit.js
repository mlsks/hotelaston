/**
 * Journal d'audit : qui a modifié quoi, quand, avec l'état avant / après.
 */
import { nowIso } from './util.js';

export function audit(db, req, action, entity, entityId, { lang = null, before = null, after = null } = {}) {
  db.prepare(`INSERT INTO sys_audit_log (at, user_id, action, entity, entity_id, lang, data_before, data_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    nowIso(), req.user?.id ?? null, action, entity, entityId === null || entityId === undefined ? null : String(entityId), lang,
    before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
  );
}
