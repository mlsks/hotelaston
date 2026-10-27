/**
 * Réception des mesures d'audience (POST /api/track).
 *
 * Respect de la vie privée (ARCHITECTURE.md § 8.2) :
 *  - visiteur = empreinte(sel du jour + IP + navigateur + site), tronquée ; le sel change chaque jour
 *    et disparaît le surlendemain : impossible de relier deux jours ou de retrouver une IP ;
 *  - l'IP sert seulement à cette empreinte et au pays / à la région, puis est oubliée ;
 *  - du site d'origine, seul le domaine est gardé ; jamais de texte saisi par le visiteur.
 *
 * Les événements sont mis en file puis écrits par lots (une transaction toutes les 2 s).
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { dayIn } from '../lib/util.js';
import { isBot, deviceOf, hostOf, channelOf } from './classify.js';
import { geoOf } from './geoip.js';

const TYPES = new Set(['pageview', 'engagement', 'booking_search', 'booking_click', 'banner_view', 'banner_click', 'popup_view', 'popup_click',
  'popup_close', 'phone_click', 'email_click', 'quote_submit', 'chat_question', 'lang_switch', 'video_play', 'map_open', 'outbound', 'not_found', 'web_vital']);
const VISIT_GAP_MS = 30 * 60 * 1000;
const METRICS = new Set(['LCP', 'INP', 'CLS', 'TTFB', 'FCP']);

const str = (v, max = 120) => (typeof v === 'string' && v.length ? v.slice(0, max) : null);
const int = (v, min, max) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : null);
const token = (v, max = 80) => (typeof v === 'string' && /^[\w:./@-]{1,200}$/.test(v) ? v.slice(0, max) : null);

export function createIngest(db, { flushMs = 2000, now = () => new Date() } = {}) {
  const queue = [];
  const visits = new Map(); // visiteur → { visit, last } (visites de moins de 30 min)
  const siteHost = hostOf(config.siteUrl);

  function saltOf(day) {
    let row = db.prepare('SELECT salt FROM an_salts WHERE day = ?').get(day);
    if (!row) {
      db.prepare('INSERT OR IGNORE INTO an_salts (day, salt) VALUES (?, ?)').run(day, crypto.randomBytes(32));
      row = db.prepare('SELECT salt FROM an_salts WHERE day = ?').get(day);
      const cutoff = dayIn(new Date(Date.parse(`${day}T12:00:00Z`) - 2 * 864e5), 'UTC');
      db.prepare('DELETE FROM an_salts WHERE day < ?').run(cutoff); // empreintes de la veille encore reliables, plus au-delà
    }
    return row.salt;
  }

  /**
   * Valide un événement et le met en file. Renvoie false s'il est ignoré (robot, format).
   * @param body objet envoyé par track.js ; ctx { ip, ua, acceptLanguage }
   */
  function accept(body, { ip, ua, acceptLanguage }) {
    if (!body || typeof body !== 'object' || !TYPES.has(body.t) || isBot(ua)) return false;
    const path = typeof body.p === 'string' && body.p.startsWith('/') ? body.p.split(/[?#]/)[0].slice(0, 200) : null;
    if (!path) return false;
    const at = now();
    const day = dayIn(at, config.timezone);
    const visitor = crypto.createHash('sha256').update(saltOf(day)).update(`${ip}|${ua}|${siteHost}`).digest('hex').slice(0, 16);
    let v = visits.get(visitor);
    const fresh = !v || at - v.last > VISIT_GAP_MS || v.day !== day;
    if (fresh) v = { visit: crypto.createHash('sha256').update(`${visitor}|${at.toISOString()}`).digest('hex').slice(0, 16), day };
    v.last = at;
    visits.set(visitor, v);

    let arrival = typeof body.a === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.a) ? body.a : null;
    const lead = arrival ? Math.round((Date.parse(`${arrival}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 864e5) : null;
    if (lead !== null && (lead < 0 || lead > 730)) arrival = null;
    const referrer = hostOf(body.r);
    const utm = body.u && typeof body.u === 'object' ? body.u : {};
    const ev = {
      ts: at.toISOString(), day, type: body.t, visitor, visit: v.visit, fresh,
      lang: token(body.l, 5), path, template: token(body.tp, 40),
      source: token(body.s), via: token(body.via), element_kind: token(body.e, 20), element_id: token(body.i, 40),
      arrival, nights: int(body.n, 1, 60), adults: int(body.ad, 1, 20), children: int(body.ch, 0, 20),
      lead_days: arrival ? lead : null, room_type: token(body.g, 40), offer_id: token(body.o, 60),
      engaged_ms: int(body.ms, 0, 30 * 60 * 1000), scroll_pct: int(body.sp, 0, 100),
      metric: METRICS.has(body.m) ? body.m : null, value: Number.isFinite(Number(body.v)) ? Number(body.v) : null,
      props: body.x && typeof body.x === 'object' ? JSON.stringify(body.x).slice(0, 500) : null,
    };
    if (fresh) {
      const geo = geoOf(ip);
      Object.assign(ev, {
        country: geo.country, region: geo.region, device: deviceOf(ua),
        browser_lang: (String(acceptLanguage || '').match(/^[a-z]{2}/i)?.[0] || '').toLowerCase() || null,
        referrer: referrer && referrer !== siteHost ? referrer : null,
        channel: channelOf({ referrer: referrer && referrer !== siteHost ? referrer : null, utm, paid: Boolean(body.paid) }),
        utm_source: str(utm.source, 80), utm_medium: str(utm.medium, 80), utm_campaign: str(utm.campaign, 120), utm_content: str(utm.content, 120),
      });
    }
    queue.push(ev);
    return true;
  }

  const insertEvent = db.prepare(`INSERT INTO an_events (ts, day, type, visit, lang, path, template, source, via, element_kind, element_id,
      arrival, nights, adults, children, lead_days, room_type, offer_id, engaged_ms, scroll_pct, metric, value, props)
    VALUES (@ts, @day, @type, @visit, @lang, @path, @template, @source, @via, @element_kind, @element_id,
      @arrival, @nights, @adults, @children, @lead_days, @room_type, @offer_id, @engaged_ms, @scroll_pct, @metric, @value, @props)`);
  const insertVisit = db.prepare(`INSERT OR IGNORE INTO an_visits (visit, visitor, day, started_at, ended_at, entry_path, exit_path, lang, browser_lang,
      country, region, device, channel, referrer, utm_source, utm_medium, utm_campaign, utm_content)
    VALUES (@visit, @visitor, @day, @ts, @ts, @path, @path, @lang, @browser_lang, @country, @region, @device, @channel, @referrer,
      @utm_source, @utm_medium, @utm_campaign, @utm_content)`);
  const touchVisit = db.prepare(`UPDATE an_visits SET
      ended_at = @ts,
      exit_path = CASE WHEN @type IN ('pageview', 'not_found') THEN @path ELSE exit_path END,
      pages = pages + CASE WHEN @type IN ('pageview', 'not_found') THEN 1 ELSE 0 END,
      engaged_ms = engaged_ms + COALESCE(@engaged_ms, 0),
      searches = searches + CASE WHEN @type = 'booking_search' THEN 1 ELSE 0 END,
      booking_clicks = booking_clicks + CASE WHEN @type = 'booking_click' THEN 1 ELSE 0 END,
      contacts = contacts + CASE WHEN @type IN ('phone_click', 'email_click', 'quote_submit') THEN 1 ELSE 0 END
    WHERE visit = @visit`);
  const engaged = db.prepare(`UPDATE an_visits SET is_engaged = 1
    WHERE visit = @visit AND is_engaged = 0 AND (engaged_ms > 10000 OR pages >= 2 OR searches + booking_clicks + contacts > 0)`);

  /** Écrit la file en une transaction. */
  function flush() {
    if (!queue.length) return 0;
    const batch = queue.splice(0, queue.length);
    db.transaction(() => {
      for (const ev of batch) {
        if (ev.fresh) insertVisit.run(ev);
        insertEvent.run(ev);
        touchVisit.run(ev);
        engaged.run(ev);
      }
    })();
    // Visites terminées : oubliées en mémoire
    const limit = now() - VISIT_GAP_MS;
    for (const [k, v] of visits) if (v.last < limit) visits.delete(k);
    return batch.length;
  }

  const timer = flushMs ? setInterval(flush, flushMs) : null;
  timer?.unref();
  return { accept, flush, close: () => { clearInterval(timer); flush(); } };
}
