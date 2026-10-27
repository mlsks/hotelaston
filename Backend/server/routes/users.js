/**
 * Utilisateurs du back-office (administrateurs seulement).
 */
import { guard, hashPassword, generatePassword, assertPasswordStrength, publicUser } from '../auth/auth.js';
import { notFound, badRequest } from '../lib/http.js';
import { nowIso } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { ID, pick, updateRow, bool } from './helpers.js';
import { SCOPES } from '../auth/scopes.js';

const ROLE = { type: 'string', enum: ['admin', 'editor', 'translator'] };
const LANGS = { type: 'array', maxItems: 20, items: { type: 'string', pattern: '^[a-z]{2}$' } };
const SCOPE_LIST = { type: 'array', maxItems: 10, items: { type: 'string', enum: Object.keys(SCOPES) } };

export default function userRoutes(app, { db }) {
  const present = (u) => ({ ...publicUser(u), is_active: Boolean(u.is_active), created_at: u.created_at, last_login_at: u.last_login_at });
  const getUser = (id) => {
    const u = db.prepare('SELECT * FROM sys_users WHERE id = ?').get(id);
    if (!u) throw notFound('Utilisateur');
    return u;
  };
  const otherActiveAdmins = (id) => db.prepare("SELECT COUNT(*) FROM sys_users WHERE role = 'admin' AND is_active = 1 AND id <> ?").pluck().get(id);
  const checkLangs = (langs) => {
    for (const l of langs || []) if (!db.prepare('SELECT 1 FROM cms_languages WHERE code = ?').get(l)) throw badRequest(`Langue inconnue : ${l}`);
  };

  app.get('/users', { preHandler: guard('admin') }, async () => db.prepare('SELECT * FROM sys_users ORDER BY role, email').all().map(present));

  app.post('/users', {
    preHandler: guard('admin'),
    schema: { body: { type: 'object', required: ['email', 'name', 'role'], additionalProperties: false, properties: {
      email: { type: 'string', format: 'email', maxLength: 200 }, name: { type: 'string', minLength: 1, maxLength: 120 }, role: ROLE, langs: LANGS, scopes: SCOPE_LIST, password: { type: 'string', maxLength: 200 },
    } } },
  }, async (req, reply) => {
    const b = req.body;
    if (db.prepare('SELECT 1 FROM sys_users WHERE email = ?').get(b.email)) throw badRequest('Un compte existe déjà avec cet e-mail.');
    checkLangs(b.langs);
    if (b.scopes?.length && b.role !== 'editor') throw badRequest('Seul un éditeur peut être limité à un périmètre.');
    const password = b.password || generatePassword();
    assertPasswordStrength(password);
    const id = db.prepare(`INSERT INTO sys_users (email, name, password_hash, role, langs, scopes, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`)
      .run(b.email, b.name, await hashPassword(password), b.role, b.langs?.length ? JSON.stringify(b.langs) : null,
        b.scopes?.length ? JSON.stringify(b.scopes) : null, nowIso()).lastInsertRowid;
    audit(db, req, 'create', 'user', id, { after: { email: b.email, role: b.role, langs: b.langs, scopes: b.scopes } });
    // Le mot de passe généré n'est montré qu'une fois
    return reply.code(201).send({ user: present(getUser(id)), password: b.password ? undefined : password });
  });

  app.patch('/users/:id', {
    preHandler: guard('admin'),
    schema: { params: ID, body: { type: 'object', additionalProperties: false, properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 }, role: ROLE, langs: LANGS, scopes: SCOPE_LIST, is_active: { type: 'boolean' }, password: { type: 'string', maxLength: 200 },
    } } },
  }, async (req) => {
    const u = getUser(req.params.id);
    const demotes = (req.body.role && req.body.role !== 'admin') || req.body.is_active === false;
    if (u.role === 'admin' && demotes && !otherActiveAdmins(u.id)) throw badRequest('Il doit rester au moins un administrateur actif.');
    checkLangs(req.body.langs);
    const fields = pick(req.body, ['name', 'role']);
    if ('langs' in req.body) fields.langs = req.body.langs.length ? JSON.stringify(req.body.langs) : null;
    if ('scopes' in req.body) fields.scopes = req.body.scopes.length ? JSON.stringify(req.body.scopes) : null;
    const scopes = 'scopes' in req.body ? req.body.scopes : (u.scopes ? JSON.parse(u.scopes) : []);
    if (scopes.length && (req.body.role ?? u.role) !== 'editor') throw badRequest('Seul un éditeur peut être limité à un périmètre.');
    if ('is_active' in req.body) fields.is_active = bool(req.body.is_active);
    if (req.body.password) {
      assertPasswordStrength(req.body.password);
      fields.password_hash = await hashPassword(req.body.password);
    }
    updateRow(db, 'sys_users', u.id, fields);
    if (fields.password_hash || fields.is_active === 0) db.prepare('DELETE FROM sys_sessions WHERE user_id = ?').run(u.id);
    audit(db, req, 'update', 'user', u.id, { after: { ...pick(req.body, ['name', 'role', 'langs', 'scopes', 'is_active']), password: req.body.password ? '(modifié)' : undefined } });
    return present(getUser(u.id));
  });

  app.delete('/users/:id', { preHandler: guard('admin'), schema: { params: ID } }, async (req) => {
    const u = getUser(req.params.id);
    if (u.id === req.user.id) throw badRequest('Vous ne pouvez pas supprimer votre propre compte.');
    if (u.role === 'admin' && !otherActiveAdmins(u.id)) throw badRequest('Il doit rester au moins un administrateur actif.');
    // Un compte qui a déjà agi est désactivé (le journal d'audit garde son nom) ; sinon il est supprimé
    const history = db.prepare('SELECT (SELECT COUNT(*) FROM sys_audit_log WHERE user_id = ?) + (SELECT COUNT(*) FROM sys_builds WHERE user_id = ?)').pluck().get(u.id, u.id);
    db.prepare('DELETE FROM sys_sessions WHERE user_id = ?').run(u.id);
    if (history) db.prepare('UPDATE sys_users SET is_active = 0 WHERE id = ?').run(u.id);
    else db.prepare('DELETE FROM sys_users WHERE id = ?').run(u.id);
    audit(db, req, history ? 'deactivate' : 'delete', 'user', u.id, { before: present(u) });
    return { ok: true, deactivated: Boolean(history) };
  });
}
