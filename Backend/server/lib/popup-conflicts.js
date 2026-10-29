/**
 * Chevauchements de popups. Le site n'affiche qu'un popup par page (le plus prioritaire, puis le
 * plus ancien) : deux popups actifs dont les périodes et les pages se recoupent sont en conflit.
 * Un conflit est « tranché » quand leurs priorités diffèrent : le plus prioritaire s'affiche
 * pendant la période commune, l'autre reprend ensuite. À priorités égales, l'admin demande
 * lequel afficher (POST /popups/:id/prefer).
 */

const OFFERS = 'offers';
const later = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
const sooner = (a, b) => (!a ? b : !b ? a : a < b ? a : b);

/**
 * Période réelle d'un popup : ses dates, bornées par celles de son offre.
 * null quand il ne peut pas s'afficher (offre masquée ou supprimée).
 */
export function popupWindow(p, offer) {
  if (!p.offer_key) return { start: p.start_at || null, end: p.end_at || null };
  if (!offer || !offer.is_active) return null;
  const start = later(p.start_at, offer.start_at) || null;
  const end = sooner(p.end_at, offer.end_at) || null;
  return start && end && end <= start ? null : { start, end };
}

/** Pages où s'ouvre un popup, d'après ses règles « toutes / seulement sur / partout sauf ». */
function pagesOf(rules, pageIds) {
  const includes = rules.filter((r) => r.mode === 'include');
  const excluded = new Set(rules.filter((r) => r.mode === 'exclude').map((r) => r.page_id));
  const base = !includes.length || includes.some((r) => r.page_id === null) ? pageIds : includes.map((r) => r.page_id);
  return new Set(base.filter((id) => !excluded.has(id)));
}

/** Rang d'affichage : le premier s'affiche (même ordre que la lecture du site). */
const outranks = (a, b) => a.priority > b.priority || (a.priority === b.priority && a.id < b.id);

/**
 * Conflits de chaque popup actif, à partir de maintenant : Map id → [{ id, name, priority,
 * start, end, pages, allPages, resolved, winner }] (start/end : la période commune ; pages : leurs clés).
 */
export function popupConflicts(db, now = new Date().toISOString()) {
  const pages = db.prepare('SELECT id, key FROM cms_pages WHERE is_active = 1 ORDER BY position, id').all();
  const pageIds = pages.map((p) => p.id);
  const pageKey = new Map(pages.map((p) => [p.id, p.key]));
  const rules = db.prepare('SELECT * FROM cms_popup_pages').all();
  const offers = new Map(db.prepare('SELECT key, is_active, start_at, end_at FROM cms_items WHERE collection = ?').all(OFFERS).map((o) => [o.key, o]));
  const popups = db.prepare('SELECT id, name, priority, start_at, end_at, offer_key FROM cms_popups WHERE is_active = 1').all()
    .map((p) => ({ ...p, window: popupWindow(p, offers.get(p.offer_key)), pages: pagesOf(rules.filter((r) => r.popup_id === p.id), pageIds) }))
    .filter((p) => p.window && (!p.window.end || p.window.end > now) && p.pages.size);
  const out = new Map(popups.map((p) => [p.id, []]));
  for (const [i, a] of popups.entries()) {
    for (const b of popups.slice(i + 1)) {
      const start = later(a.window.start, b.window.start);
      const end = sooner(a.window.end, b.window.end);
      if (start && end && end <= start) continue;
      if (end && end <= now) continue;
      const common = [...a.pages].filter((id) => b.pages.has(id)).map((id) => pageKey.get(id));
      if (!common.length) continue;
      const shared = { start: start || null, end: end || null, pages: common, allPages: common.length === pageIds.length, resolved: a.priority !== b.priority, winner: outranks(a, b) ? a.id : b.id };
      out.get(a.id).push({ id: b.id, name: b.name, priority: b.priority, ...shared });
      out.get(b.id).push({ id: a.id, name: a.name, priority: a.priority, ...shared });
    }
  }
  return out;
}
