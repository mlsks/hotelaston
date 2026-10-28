/**
 * Passe en « prêt » tout ce qui est en brouillon dans une langue (textes, pages, fiches, textes alternatifs, bandeaux,
 * popups), en renvoyant à l'API la valeur actuelle avec le statut « ready » : seul le statut change, et chaque écriture
 * figure au Journal. Ne publie rien : il reste à lancer la publication.
 *   node scripts/i18n-ready.mjs <langue> [--dry]
 * Serveur lancé ; compte : ASTON_EMAIL / ASTON_PASSWORD, sinon le compte de développement de .dev-credentials.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../server/db/connection.js';
import { config } from '../server/config.js';

const [lang] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dry = process.argv.includes('--dry');
if (!lang) {
  console.log('Usage : node scripts/i18n-ready.mjs <langue> [--dry]');
  process.exit(1);
}
const db = getDb();
const def = db.prepare('SELECT code FROM cms_languages WHERE is_default = 1').pluck().get();
if (lang === def) throw new Error('La langue par défaut est toujours prête.');

const todo = [];
for (const r of db.prepare(`SELECT entry_id, value, media_id FROM cms_entry_values WHERE lang = ? AND status = 'draft'`).all(lang)) {
  todo.push([`/entries/${r.entry_id}/${lang}`, r.media_id ? { media_id: r.media_id } : { value: r.value ?? '' }]);
}
for (const r of db.prepare(`SELECT * FROM cms_page_i18n WHERE lang = ? AND status = 'draft'`).all(lang)) {
  const body = { title: r.title, meta_description: r.meta_description ?? '', nav_label: r.nav_label, og_title: r.og_title, og_description: r.og_description, focus_keyword: r.focus_keyword };
  if (r.slug) body.slug = r.slug;
  todo.push([`/pages/${r.page_id}/i18n/${lang}`, body]);
}
for (const r of db.prepare(`SELECT item_id, slug, data FROM cms_item_i18n WHERE lang = ? AND status = 'draft'`).all(lang)) {
  todo.push([`/items/${r.item_id}/i18n/${lang}`, { data: JSON.parse(r.data), ...(r.slug ? { slug: r.slug } : {}) }]);
}
for (const r of db.prepare(`SELECT media_id, alt, title, caption FROM cms_media_i18n WHERE lang = ? AND status = 'draft'`).all(lang)) {
  todo.push([`/media/${r.media_id}/i18n/${lang}`, { alt: r.alt, title: r.title, caption: r.caption }]);
}
for (const r of db.prepare(`SELECT banner_id, text, cta_label, cta_url FROM cms_banner_i18n WHERE lang = ? AND status = 'draft'`).all(lang)) {
  todo.push([`/banners/${r.banner_id}/i18n/${lang}`, { text: r.text, cta_label: r.cta_label, cta_url: r.cta_url }]);
}
for (const r of db.prepare(`SELECT popup_id, title, body, cta_label, cta_kind, cta_target FROM cms_popup_i18n WHERE lang = ? AND status = 'draft'`).all(lang)) {
  const { popup_id, ...body } = r;
  todo.push([`/popups/${popup_id}/i18n/${lang}`, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null))]);
}
console.log(`${todo.length} brouillons à passer en « prêt » en ${lang}.`);
if (dry || !todo.length) process.exit(0);

const creds = (() => {
  if (process.env.ASTON_EMAIL) return { email: process.env.ASTON_EMAIL, password: process.env.ASTON_PASSWORD };
  const kv = Object.fromEntries(fs.readFileSync(path.join(config.root, '.dev-credentials'), 'utf8').split(/\r?\n/)
    .filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { email: kv.email, password: kv.password };
})();
const base = (process.env.API_URL || `http://127.0.0.1:${config.port}`).replace(/\/+$/, '') + '/api';
const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(creds) });
if (!login.ok) throw new Error(`Connexion refusée (${login.status}) : ${await login.text()}`);
const { csrf } = await login.json();
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
let ok = 0;
const errors = [];
for (const [url, body] of todo) {
  const res = await fetch(base + url, { method: 'PUT', headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf }, body: JSON.stringify({ ...body, status: 'ready' }) });
  if (res.ok) ok++;
  else errors.push(`${url} : ${res.status} ${(await res.text()).slice(0, 200)}`);
}
await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie, 'x-csrf-token': csrf } });
console.log(`${ok} / ${todo.length} passés en « prêt » en ${lang}.`);
if (errors.length) { console.log(`Refusés :\n  ${errors.join('\n  ')}`); process.exitCode = 1; }
