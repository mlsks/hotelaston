/**
 * /api/auth : connexion, déconnexion, session courante, changement de mot de passe.
 */
import { checkCredentials, openSession, closeSession, cookieOptions, COOKIE, guard, hashPassword, assertPasswordStrength, publicUser } from '../auth/auth.js';
import { verify } from '@node-rs/argon2';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';

export default function authRoutes(app, { db }) {
  app.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: { body: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', maxLength: 200 }, password: { type: 'string', maxLength: 200 } } } },
  }, async (req, reply) => {
    const user = await checkCredentials(db, req.body.email, req.body.password);
    if (!user) throw new HttpError(401, 'E-mail ou mot de passe incorrect.');
    const session = openSession(db, user);
    reply.setCookie(COOKIE, session.token, cookieOptions(req));
    req.user = { id: user.id };
    audit(db, req, 'login', 'user', user.id);
    return { user: publicUser(user), csrf: session.csrf };
  });

  app.post('/auth/logout', { preHandler: guard() }, async (req, reply) => {
    closeSession(db, req.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    if (!req.user) throw new HttpError(401, 'Connexion requise.');
    return { user: req.user, csrf: req.csrf, site: { url: config.siteUrl } };
  });

  app.post('/auth/password', {
    preHandler: guard(),
    schema: { body: { type: 'object', required: ['current', 'next'], properties: { current: { type: 'string' }, next: { type: 'string' } } } },
  }, async (req) => {
    const row = db.prepare('SELECT password_hash FROM sys_users WHERE id = ?').get(req.user.id);
    if (!(await verify(row.password_hash, req.body.current).catch(() => false))) throw new HttpError(400, 'Mot de passe actuel incorrect.');
    assertPasswordStrength(req.body.next);
    db.prepare('UPDATE sys_users SET password_hash = ? WHERE id = ?').run(await hashPassword(req.body.next), req.user.id);
    audit(db, req, 'password', 'user', req.user.id);
    return { ok: true };
  });
}
