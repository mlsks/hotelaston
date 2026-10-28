/**
 * track.js — mesure d'audience sans cookie ni identifiant (ARCHITECTURE.md § 8).
 * Le build le livre précédé de la bibliothèque web-vitals de Google (Core Web Vitals).
 *
 * Envoie à l'API du site : page vue, temps de lecture et défilement, vitesse réelle de la page,
 * passages vers le moteur de réservation (dates, voyageurs, source du clic), bandeaux et popup,
 * téléphone, e-mail, devis, questions du chat, langue, carte, liens sortants.
 * Rien n'est envoyé si le navigateur demande de ne pas être suivi (Do Not Track, GPC)
 * ou si le visiteur s'y est opposé (localStorage « aston.no-stats »).
 */
(() => {
  'use strict';
  let cfg;
  try { cfg = JSON.parse(document.getElementById('site-config').textContent); } catch { return; }
  if (!cfg.track) return;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
  try { if (localStorage.getItem('aston.no-stats') === '1') return; } catch { /* stockage indisponible */ }

  const page = cfg.page || {};
  const base = { p: location.pathname, l: cfg.lang, tp: page.view };
  const bookingOrigin = (() => { try { return new URL(cfg.bookingBase).origin; } catch { return null; } })();

  function send(t, extra = {}) {
    const body = JSON.stringify({ t, ...base, ...extra });
    if (navigator.sendBeacon?.(cfg.track, new Blob([body], { type: 'text/plain' }))) return;
    fetch(cfg.track, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  }

  /* Attribution : dernier bandeau ou popup cliqué pendant la visite (30 minutes) */
  const VIA = 'aston.via';
  const via = () => {
    try {
      const v = JSON.parse(sessionStorage.getItem(VIA));
      return v && Date.now() - v.t < 18e5 ? v.id : undefined;
    } catch { return undefined; }
  };
  const setVia = (id) => { try { sessionStorage.setItem(VIA, JSON.stringify({ id, t: Date.now() })); } catch { /* sans attribution */ } };

  /** D'où vient un clic : élément marqué, bandeau, popup, zone de la page. */
  function sourceOf(el, detail = {}) {
    if (!el?.closest) return `page:${page.route ?? ''}`;
    const tagged = el.closest('[data-track-source]');
    if (tagged) return tagged.dataset.trackSource;
    const banner = el.closest('[data-banner]');
    if (banner) return `banner:${banner.dataset.banner}`;
    const popup = el.closest('[data-popup]');
    if (popup) return `popup:${popup.dataset.popup}`;
    if (el.closest('.hero')) return 'cta_hero';
    if (el.closest('.site-header')) return 'cta_header';
    if (el.closest('[data-bottom-bar]')) return 'bottom_bar';
    if (el.closest('.mobile-menu')) return 'menu';
    if (el.closest('.chat')) return 'chat';
    if (el.closest('.offer-card')) return `offer:${detail.offerId || el.dataset.offerId || ''}`;
    if (el.closest('.room-card')) return `room_card:${detail.roomType || el.dataset.roomType || ''}`;
    if (el.closest('.room-page')) return `room:${detail.roomType || ''}`;
    return `page:${page.route ?? ''}`;
  }

  /* 1. Page vue (ou introuvable), avec site d'origine et campagne */
  const qs = new URLSearchParams(location.search);
  const utm = {};
  for (const k of ['source', 'medium', 'campaign', 'content']) if (qs.get(`utm_${k}`)) utm[k] = qs.get(`utm_${k}`).slice(0, 120);
  send(page.view === '404' ? 'not_found' : 'pageview', {
    r: document.referrer || undefined,
    u: Object.keys(utm).length ? utm : undefined,
    paid: ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid'].some((k) => qs.has(k)) ? 1 : undefined,
  });

  /* 2. Temps de lecture actif et défilement maximal, envoyés quand la page est masquée ou quittée */
  let active = 0;
  let since = document.visibilityState === 'visible' ? performance.now() : null;
  let maxScroll = 0;
  addEventListener('scroll', () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    if (h > 0) maxScroll = Math.max(maxScroll, Math.min(100, Math.round((scrollY / h) * 100)));
  }, { passive: true });
  const flushEngagement = () => {
    if (since !== null) { active += performance.now() - since; since = null; }
    if (active > 500) { send('engagement', { ms: Math.round(active), sp: maxScroll }); active = 0; }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEngagement();
    else since = performance.now();
  });
  addEventListener('pagehide', flushEngagement);

  /* 3. Vitesse réelle (Core Web Vitals) */
  if (window.webVitals) {
    for (const fn of ['onLCP', 'onINP', 'onCLS', 'onTTFB']) window.webVitals[fn]?.((m) => send('web_vital', { m: m.name, v: Math.round(m.value * 1000) / 1000 }));
  }

  /* 4. Réservation : événement émis par le script du site juste avant d'ouvrir le moteur */
  document.addEventListener('aston:booking', (e) => {
    const d = e.detail || {};
    const nights = d.checkin && d.checkout ? Math.round((Date.parse(d.checkout) - Date.parse(d.checkin)) / 864e5) : undefined;
    const common = {
      s: sourceOf(d.origin, d), via: via(), a: d.checkin || undefined, n: nights,
      ad: Number(d.adults) || undefined, ch: Number(d.children) || 0, g: d.roomType || undefined, o: d.offerId || undefined,
    };
    if (d.search) send('booking_search', common);
    send('booking_click', common);
  });

  /* 5. Clics : bandeaux, popup, téléphone, e-mail, carte, langue, liens sortants */
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('a, button');
    if (!el) return;
    const tracked = el.closest('[data-track]');
    if (tracked && /^(banner|popup)_click$/.test(tracked.dataset.track)) {
      const src = tracked.dataset.trackSource || '';
      setVia(src);
      send(tracked.dataset.track, { s: src, e: src.split(':')[0], i: src.split(':')[1] });
    }
    const href = el.getAttribute('href') || '';
    if (href.startsWith('tel:')) send('phone_click', { s: sourceOf(el) });
    else if (href.startsWith('mailto:')) send('email_click', { s: sourceOf(el) });
    else if (el.matches('[data-map-load]')) send('map_open');
    else if (el.closest('.lang-switch, .lang-menu') && el.hasAttribute('hreflang')) send('lang_switch', { x: { to: el.getAttribute('hreflang') } });
    else if (/^https?:/.test(href) && !el.hasAttribute('data-book')) {
      const url = new URL(href, location.href);
      if (bookingOrigin && url.origin === bookingOrigin) send('booking_click', { s: sourceOf(el), via: via() }); // lien direct vers le moteur
      else if (url.host !== location.host) send('outbound', { x: { host: url.host } });
    }
  }, true);

  /* 6. Bandeaux vus (au moins à moitié visibles) */
  if ('IntersectionObserver' in window) {
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.target.hidden) continue;
        seen.unobserve(entry.target);
        send('banner_view', { s: `banner:${entry.target.dataset.banner}`, e: 'banner', i: entry.target.dataset.banner });
      }
    }, { threshold: 0.5 });
    document.querySelectorAll('[data-banner]').forEach((b) => seen.observe(b));
  }

  /* 7. Popup, chat, devis, lectures audio / vidéo lancées par le visiteur */
  document.addEventListener('cms:popup-view', (e) => {
    const id = e.target.dataset?.popup;
    send('popup_view', { s: `popup:${id}`, e: 'popup', i: id });
    e.target.addEventListener('close', () => send('popup_close', { s: `popup:${id}`, e: 'popup', i: id }), { once: true });
  });
  document.addEventListener('aston:chat', (e) => send('chat_question', { e: 'chat', i: e.detail?.intent || undefined }));
  document.addEventListener('aston:quote', (e) => send('quote_submit', { s: e.detail?.source || sourceOf(e.detail?.form), o: e.detail?.offer || undefined }));
  document.addEventListener('play', (e) => {
    if (e.target.hasAttribute?.('controls')) send('video_play', { x: { kind: e.target.tagName.toLowerCase() } });
  }, true);
})();
