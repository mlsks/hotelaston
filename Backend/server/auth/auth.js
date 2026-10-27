/**
 * Connexion au back-office : mots de passe argon2id, sessions en cookie HttpOnly / SameSite=Strict,
 * jeton CSRF pour toute écriture, rôles et langues autorisées.
 *
 * Rôles :
 *  - admin      : tout (utilisateurs, langues, réglages compris) ;
 *  - editor     : contenus, médias, bandeaux, popup, prévisualisation, publication, restauration ;
 *  - translator : textes des langues qui lui sont attribuées et prévisualisation, sans publication.
 * Un éditeur peut en plus être limité à un périmètre (voir scopes.js).
 */
import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { config } from '../config.js';
import { sha, nowIso } from '../lib/util.js';
import { HttpError } from '../lib/http.js';
import { isScoped, rulesOf, folderInScope } from './scopes.js';

export const COOKIE = 'aston_sid';
const DUMMY_HASH = await hash('mot-de-passe-factice-pour-temps-constant');

export const hashPassword = (password) => hash(password);

export function assertPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 12) throw new HttpError(400, 'Le mot de passe doit faire au moins 12 caractères.');
}

/** Mot de passe aléatoire lisible (affiché une seule fois à la création). */
export const generatePassword = () => crypto.randomBytes(15).toString('base64url');

const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, role: u.role,
  langs: u.langs ? JSON.parse(u.langs) : [],
  scopes: u.scopes ? JSON.parse(u.scopes) : [],
});

/** Vérifie e-mail et mot de passe ; renvoie l'utilisateur ou null (même durée dans les deux cas). */
export async function checkCredentials(db, email, password) {
  const user = db.prepare('SELECT * FROM sys_users WHERE email = ? AND is_active = 1').get(String(email || '').trim());
  const ok = await verify(user?.password_hash || DUMMY_HASH, String(password || '')).catch(() => false);
  return user && ok ? user : null;
}

/** Ouvre une session : le cookie porte un jeton aléatoire, la base n'en garde que l'empreinte. */
export function openSession(db, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + config.sessionHours * 3600e3).toISOString();
  db.prepare('INSERT INTO sys_sessions (id, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(sha(token), user.id, csrf, nowIso(), expires);
  db.prepare('UPDATE sys_users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
  db.prepare('DELETE FROM sys_sessions WHERE expires_at < ?').run(nowIso());
  return { token, csrf, expires };
}

export function closeSession(db, token) {
  if (token) db.prepare('DELETE FROM sys_sessions WHERE id = ?').run(sha(token));
}

export const cookieOptions = (req) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'strict',
  secure: req.protocol === 'https',
  maxAge: config.sessionHours * 3600,
});

/** Plugin Fastify : lit la session à chaque requête et prolonge celles qui servent. */
export function authPlugin(app, db) {
  const find = db.prepare(`SELECT s.id AS sid, s.csrf_token, s.expires_at, u.* FROM sys_sessions s
    JOIN sys_users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1`);
  const extend = db.prepare('UPDATE sys_sessions SET expires_at = ? WHERE id = ?');
  app.decorateRequest('user', null);
  app.decorateRequest('csrf', null);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return;
    const row = find.get(sha(token), nowIso());
    if (!row) return;
    req.user = publicUser(row);
    req.csrf = row.csrf_token;
    // Session glissante : prolongée quand plus de la moitié de sa durée est écoulée
    const left = Date.parse(row.expires_at) - Date.now();
    if (left < (config.sessionHours * 3600e3) / 2) extend.run(new Date(Date.now() + config.sessionHours * 3600e3).toISOString(), row.sid);
  });
}

const PERMISSIONS = {
  preview: ['admin', 'editor', 'translator'],
  content: ['admin', 'editor'],
  publish: ['admin', 'editor'],
  admin: ['admin'],
};

/** L'utilisateur peut-il agir ? Pour une langue étrangère, un traducteur doit l'avoir dans ses langues. */
export function can(user, permission, { lang = null, defaultLang = 'fr' } = {}) {
  if (!user) return false;
  if (permission === 'translate') {
    if (!lang || lang === defaultLang) return PERMISSIONS.content.includes(user.role);
    return user.role !== 'translator' || user.langs.includes(lang);
  }
  return (PERMISSIONS[permission] || []).includes(user.role);
}

const sameToken = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * preHandler : session obligatoire, permission, et jeton CSRF (en-tête x-csrf-token) pour les écritures.
 * Les permissions qui dépendent d'une langue sont vérifiées dans la route (assertCan).
 */
export function guard(permission = 'preview') {
  return async (req) => {
    if (!req.user) throw new HttpError(401, 'Connexion requise.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameToken(req.headers['x-csrf-token'], req.csrf)) {
      throw new HttpError(403, 'Jeton de sécurité (CSRF) manquant ou invalide.');
    }
    if (!can(req.user, permission)) throw new HttpError(403, "Votre rôle ne permet pas cette action.");
  };
}

export function assertCan(req, permission, opts) {
  if (!can(req.user, permission, opts)) {
    throw new HttpError(403, opts?.lang ? `Votre rôle ne permet pas de modifier la langue « ${opts.lang} ».` : 'Votre rôle ne permet pas cette action.');
  }
}

/** Action réservée aux comptes sans périmètre (structure du site, restauration, popups…). */
export function assertUnscoped(req) {
  if (isScoped(req.user)) throw new HttpError(403, `Votre compte est limité à : ${rulesOf(req.user).label}.`);
}

/** Vérifie qu'un objet fait partie du périmètre de l'utilisateur (sans effet pour un compte sans périmètre). */
export function assertInScope(req, check, what = 'cet élément') {
  if (!isScoped(req.user)) return;
  if (!check(rulesOf(req.user))) throw new HttpError(403, `Hors de votre périmètre (${rulesOf(req.user).label}) : ${what}.`);
}

export { publicUser, isScoped, rulesOf, folderInScope };
