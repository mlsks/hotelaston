/**
 * Bibliothèques du back-office, servies par le serveur lui-même (pas de CDN tiers dans l'admin) :
 * versions figées dans package.json, contenu chargé une fois au démarrage.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { sha } from './lib/util.js';

const FILES = {
  'alpine.js': 'alpinejs/dist/module.esm.min.js',
  'chart.js': 'chart.js/dist/chart.umd.min.js',
  'tailwind.js': '@tailwindcss/browser/dist/index.global.js',
};

export function adminVendor() {
  const out = new Map();
  for (const [name, rel] of Object.entries(FILES)) {
    const file = path.join(config.root, 'node_modules', rel);
    if (!fs.existsSync(file)) continue;
    const body = fs.readFileSync(file);
    out.set(name, { body, etag: `"${sha(body, 16)}"` });
  }
  return out;
}

/** Alpine évalue ses expressions (unsafe-eval) ; Tailwind écrit ses styles dans la page (unsafe-inline). */
export const ADMIN_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self' 'unsafe-eval'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:", "media-src 'self' blob:", "connect-src 'self'", "frame-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

/** Page « Avis Google automatique » : connexion Google (Google Identity Services) et API Google Business Profile. */
export const GOOGLE_TOOL_PATH = '/admin/outils/avis-google';
export const GOOGLE_TOOL_HEADERS = {
  ...ADMIN_HEADERS,
  'Content-Security-Policy': ADMIN_HEADERS['Content-Security-Policy']
    .replace("script-src 'self' 'unsafe-eval'", "script-src 'self' https://accounts.google.com")
    .replace("style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://accounts.google.com")
    .replace("connect-src 'self'", "connect-src 'self' https://*.googleapis.com https://accounts.google.com")
    .replace("frame-src 'self'", "frame-src 'self' https://accounts.google.com"),
};

/**
 * Manuel d'utilisation dans l'admin (menu Aide) : docs/guide-utilisateur.html, lu à chaque demande
 * (un git pull suffit à le mettre à jour), affiché dans un cadre de l'écran « Manuel d'utilisation ».
 * Les liens vers d'autres fichiers du dépôt mènent à GitHub ; les liens sortants s'ouvrent dans un nouvel onglet.
 */
export const MANUAL_PATH = '/admin/manuel';
export const MANUAL_FILE = path.join(config.root, '..', 'docs', 'guide-utilisateur.html');
const REPO_URL = 'https://github.com/mlsks/hotelaston/blob/main';

export function manualPage(file = MANUAL_FILE) {
  if (!fs.existsSync(file)) return null;
  let html = fs.readFileSync(file, 'utf8').replace(/<a href="([^"#][^"]*)"/g, (m, href) => {
    if (/^(https?:|mailto:|tel:)/.test(href)) return `<a href="${href}" target="_blank" rel="noopener"`;
    const target = path.posix.normalize(path.posix.join('docs', href));
    return `<a href="${REPO_URL}/${target}" target="_blank" rel="noopener"`;
  });
  html = html.replace('<meta name="robots" content="noindex">', '<meta name="robots" content="noindex, nofollow">');
  // Le seul script du guide (bouton clair / sombre) est autorisé par son empreinte
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  return {
    html,
    headers: {
      'Content-Security-Policy': [
        "default-src 'self'", `script-src ${hashes.join(' ') || "'none'"}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
        "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'SAMEORIGIN',
      'Cache-Control': 'no-store',
    },
  };
}
