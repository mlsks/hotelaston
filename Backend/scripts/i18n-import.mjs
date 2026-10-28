/**
 * Importe une traduction préparée hors ligne (forme de scripts/i18n-export.mjs) en passant par l'API du back-office :
 * chaque écriture figure au Journal, et tout arrive avec le statut « brouillon » (rien n'est publié ni activé).
 *   node scripts/i18n-import.mjs <fichier.json> [--dry] [--ready]
 * Le serveur doit tourner (API_URL, par défaut http://127.0.0.1:<PORT>). Compte : ASTON_EMAIL / ASTON_PASSWORD,
 * sinon le compte de développement de .dev-credentials.
 * Dans le fichier, un texte (entries) peut être une chaîne ou { value }. Avant tout envoi, le script compare au
 * français les balises, les liens, les variables {…} et les nombres, et signale les écarts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const dry = args.includes('--dry');
const status = args.includes('--ready') ? 'ready' : 'draft';
if (!file) {
  console.log('Usage : node scripts/i18n-import.mjs <fichier.json> [--dry] [--ready]');
  process.exit(1);
}
const tr = JSON.parse(fs.readFileSync(file, 'utf8'));
const lang = tr.lang;
const srcFile = path.join(config.storageDir, 'translations', 'source.fr.json');
const src = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
if (!lang || lang === src.lang) throw new Error('Champ « lang » manquant ou égal à la langue par défaut.');

// Contrôles : balises (nom + href), nombres
const tags = (s) => [...String(s ?? '').matchAll(/<\/?([a-z0-9]+)([^>]*)>/gi)].map((m) => `${m[1].toLowerCase()}${(m[2].match(/href="[^"]*"/) || [''])[0]}`).sort().join(' ');
const nums = (s) => [...String(s ?? '').replace(/<[^>]*>/g, '').matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(',', '.')).sort().join(' ');
const holes = (s) => [...String(s ?? '').matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join(' ');
const warnings = [];
const check = (where, fr, value) => {
  if (typeof value !== 'string' || !value.trim()) return warnings.push(`${where} : traduction vide`);
  if (holes(fr) !== holes(value)) warnings.push(`${where} : variables { } différentes`);
  if (tags(fr) !== tags(value)) warnings.push(`${where} : balises ou liens différents\n    fr : ${fr}\n    ${lang} : ${value}`);
  else if (nums(fr) !== nums(value)) warnings.push(`${where} : nombres différents (${nums(fr)} / ${nums(value)})`);
};
const walk = (where, fr, value) => {
  if (typeof fr === 'string') return check(where, fr, value);
  if (Array.isArray(fr)) {
    if (!Array.isArray(value) || value.length !== fr.length) return warnings.push(`${where} : liste de longueur différente`);
    return fr.forEach((f, i) => walk(`${where}[${i}]`, f, value[i]));
  }
  if (fr && typeof fr === 'object') for (const k of Object.keys(fr)) walk(`${where}.${k}`, fr[k], value?.[k]);
};

const todo = [];
for (const [id, v] of Object.entries(tr.entries ?? {})) {
  const s = src.entries[id];
  if (!s) { warnings.push(`texte ${id} : inconnu dans le français`); continue; }
  const value = typeof v === 'string' ? v : v.value;
  check(`texte ${s.key}`, s.value, value);
  if (s.max && value.length > s.max) warnings.push(`texte ${s.key} : ${value.length} caractères pour ${s.max} au plus`);
  todo.push(['PUT', `/entries/${id}/${lang}`, { value, status }, `texte ${s.key}`]);
}
for (const [id, v] of Object.entries(tr.pages ?? {})) {
  const s = src.pages[id];
  if (!s) { warnings.push(`page ${id} : inconnue`); continue; }
  const { key, ...body } = v;
  for (const f of ['title', 'meta_description', 'og_title', 'og_description', 'nav_label']) if (s[f] && body[f]) check(`page ${s.key}.${f}`, s[f], body[f]);
  todo.push(['PUT', `/pages/${id}/i18n/${lang}`, { ...body, status }, `page ${s.key}`]);
}
for (const [id, v] of Object.entries(tr.items ?? {})) {
  const s = src.items[id];
  if (!s) { warnings.push(`fiche ${id} : inconnue`); continue; }
  walk(`fiche ${s.collection}/${s.key}`, s.data, v.data);
  todo.push(['PUT', `/items/${id}/i18n/${lang}`, { data: v.data, ...(v.slug ? { slug: v.slug } : {}), status }, `fiche ${s.collection}/${s.key}`]);
}
for (const [id, v] of Object.entries(tr.media ?? {})) {
  todo.push(['PUT', `/media/${id}/i18n/${lang}`, { ...v, status }, `média ${id}`]);
}
for (const [id, v] of Object.entries(tr.banners ?? {})) {
  if (src.banners[id]) check(`bandeau ${id}`, src.banners[id].text, v.text);
  todo.push(['PUT', `/banners/${id}/i18n/${lang}`, { ...v, status }, `bandeau ${id}`]);
}
for (const [id, v] of Object.entries(tr.popups ?? {})) {
  todo.push(['PUT', `/popups/${id}/i18n/${lang}`, { ...v, status }, `popup ${id}`]);
}
const missing = Object.keys(src.entries).filter((id) => !(id in (tr.entries ?? {})));

if (warnings.length) console.log(`À vérifier (${warnings.length}) :\n  ${warnings.join('\n  ')}`);
if (missing.length) console.log(`Textes non traduits dans le fichier : ${missing.length}`);
console.log(`${todo.length} écritures prévues en ${lang} (statut ${status}).`);
if (dry) process.exit(0);

// Connexion
const creds = (() => {
  if (process.env.ASTON_EMAIL) return { email: process.env.ASTON_EMAIL, password: process.env.ASTON_PASSWORD };
  const f = path.join(config.root, '.dev-credentials');
  const kv = Object.fromEntries(fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { email: kv.email, password: kv.password };
})();
const base = (process.env.API_URL || `http://127.0.0.1:${config.port}`).replace(/\/+$/, '') + '/api';
const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(creds) });
if (!login.ok) throw new Error(`Connexion refusée (${login.status}) : ${await login.text()}`);
const { csrf } = await login.json();
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

let ok = 0;
const errors = [];
for (const [method, url, body, label] of todo) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf }, body: JSON.stringify(body) });
  if (res.ok) ok++;
  else errors.push(`${label} : ${res.status} ${(await res.text()).slice(0, 200)}`);
}
await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie, 'x-csrf-token': csrf } });
console.log(`${ok} / ${todo.length} écritures acceptées en ${lang}.`);
if (errors.length) {
  console.log(`Refusées (${errors.length}) :\n  ${errors.join('\n  ')}`);
  process.exitCode = 1;
}
