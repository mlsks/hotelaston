/**
 * remotion-vanilla.js — « Remotion-Core » en pur JavaScript (ES2020+, sans dépendance)
 * ---------------------------------------------------------------------------
 * Volet A du site Hôtel Aston La Scala :
 *
 *   1. Moteur      interpolate(), spring(), measureSpring(), Easing : portage
 *                  fidèle des fonctions de Remotion 4 (mêmes signatures, mêmes
 *                  valeurs par défaut, même solveur analytique de ressort).
 *   2. Horloge     une seule boucle requestAnimationFrame qui joue des
 *                  « séquences » : chaque rendu est une fonction pure du numéro
 *                  de frame (comme useCurrentFrame()), déclenchée par
 *                  IntersectionObserver ou par une interaction.
 *   3. Interface   routeur des vues, réservation (paramètres checkin, checkout,
 *                  guests, roomType, offerId), sliders tactiles sans lecture
 *                  automatique, menu mobile, avis, offres filtrables, devis,
 *                  carte, vidéos adaptatives, chat sans barrière d'e-mail.
 */
(() => {
  'use strict';

  /* =========================================================================
     1. MOTEUR — portage de remotion/interpolate, spring, measureSpring, Easing
     ========================================================================= */

  const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

  function assertRange(inputRange, outputRange) {
    if (inputRange.length !== outputRange.length) {
      throw new Error(`inputRange (${inputRange.length}) et outputRange (${outputRange.length}) doivent avoir la même longueur`);
    }
    if (inputRange.length < 2) throw new Error('inputRange doit contenir au moins 2 valeurs');
    for (let i = 1; i < inputRange.length; i++) {
      if (!(inputRange[i] > inputRange[i - 1])) {
        throw new Error(`inputRange doit être strictement croissant : [${inputRange.join(', ')}]`);
      }
    }
    for (const v of [...inputRange, ...outputRange]) {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Valeur non finie dans les plages : ${v}`);
    }
  }

  function interpolateSegment(input, [inputMin, inputMax], [outputMin, outputMax], { easing, extrapolateLeft, extrapolateRight }) {
    let result = input;
    if (result < inputMin) {
      if (extrapolateLeft === 'identity') return result;
      if (extrapolateLeft === 'clamp') result = inputMin;
      else if (extrapolateLeft === 'wrap') {
        const r = inputMax - inputMin;
        result = ((((result - inputMin) % r) + r) % r) + inputMin;
      }
    }
    if (result > inputMax) {
      if (extrapolateRight === 'identity') return result;
      if (extrapolateRight === 'clamp') result = inputMax;
      else if (extrapolateRight === 'wrap') {
        const r = inputMax - inputMin;
        result = ((((result - inputMin) % r) + r) % r) + inputMin;
      }
    }
    if (outputMin === outputMax) return outputMin;
    result = (result - inputMin) / (inputMax - inputMin);
    result = easing(result);
    return result * (outputMax - outputMin) + outputMin;
  }

  /**
   * interpolate(input, inputRange, outputRange, { easing, extrapolateLeft, extrapolateRight })
   * extrapolate* : 'extend' (défaut) | 'clamp' | 'identity' | 'wrap'
   */
  function interpolate(input, inputRange, outputRange, options = {}) {
    if (typeof input !== 'number') throw new TypeError('interpolate() : input doit être un nombre');
    assertRange(inputRange, outputRange);
    const easing = options.easing || ((t) => t);
    const extrapolateLeft = options.extrapolateLeft ?? 'extend';
    const extrapolateRight = options.extrapolateRight ?? 'extend';
    let i = 1;
    for (; i < inputRange.length - 1; ++i) if (inputRange[i] >= input) break;
    const r = i - 1;
    return interpolateSegment(input, [inputRange[r], inputRange[r + 1]], [outputRange[r], outputRange[r + 1]], {
      easing,
      extrapolateLeft,
      extrapolateRight,
    });
  }

  /* Courbes de Bézier cubiques (Newton-Raphson + subdivision) */
  function bezier(x1, y1, x2, y2) {
    const A = (a1, a2) => 1 - 3 * a2 + 3 * a1;
    const B = (a1, a2) => 3 * a2 - 6 * a1;
    const C = (a1) => 3 * a1;
    const calc = (t, a1, a2) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
    const slope = (t, a1, a2) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);
    const tForX = (x) => {
      let t = x;
      for (let i = 0; i < 8; i++) {
        const s = slope(t, x1, x2);
        if (Math.abs(s) < 1e-6) break;
        t -= (calc(t, x1, x2) - x) / s;
      }
      if (t >= 0 && t <= 1 && Math.abs(calc(t, x1, x2) - x) < 1e-5) return t;
      let lo = 0;
      let hi = 1;
      t = x;
      for (let i = 0; i < 30; i++) {
        const v = calc(t, x1, x2);
        if (Math.abs(v - x) < 1e-7) break;
        if (v < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
      return t;
    };
    return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : calc(tForX(x), y1, y2));
  }

  const Easing = {
    linear: (t) => t,
    ease: bezier(0.42, 0, 1, 1),
    quad: (t) => t * t,
    cubic: (t) => t * t * t,
    poly: (n) => (t) => t ** n,
    sin: (t) => 1 - Math.cos((t * Math.PI) / 2),
    circle: (t) => 1 - Math.sqrt(1 - t * t),
    exp: (t) => 2 ** (10 * (t - 1)),
    elastic: (bounciness = 1) => {
      const p = bounciness * Math.PI;
      return (t) => 1 - Math.cos((t * Math.PI) / 2) ** 3 * Math.cos(t * p);
    },
    back: (s = 1.70158) => (t) => t * t * ((s + 1) * t - s),
    bounce: (t) => {
      if (t < 1 / 2.75) return 7.5625 * t * t;
      if (t < 2 / 2.75) { const u = t - 1.5 / 2.75; return 7.5625 * u * u + 0.75; }
      if (t < 2.5 / 2.75) { const u = t - 2.25 / 2.75; return 7.5625 * u * u + 0.9375; }
      const u = t - 2.625 / 2.75;
      return 7.5625 * u * u + 0.984375;
    },
    bezier,
    in: (e) => e,
    out: (e) => (t) => 1 - e(1 - t),
    inOut: (e) => (t) => (t < 0.5 ? e(t * 2) / 2 : 1 - e((1 - t) * 2) / 2),
  };

  const SPRING_DEFAULTS = { damping: 10, mass: 1, stiffness: 100, overshootClamping: false };

  /**
   * Solution analytique du ressort amorti (même formulation que Remotion / Wobble) :
   * position de 0 vers 1 au temps frame / fps, vitesse initiale nulle.
   */
  function springCalculation({ frame, fps, config = {} }) {
    const { damping: c, mass: m, stiffness: k } = { ...SPRING_DEFAULTS, ...config };
    const t = Math.max(0, frame) / fps;
    const x0 = 1; // toValue - position initiale
    const v0 = 0;
    const zeta = c / (2 * Math.sqrt(k * m));
    const omega0 = Math.sqrt(k / m);
    let current;
    if (zeta < 1) {
      const omega1 = omega0 * Math.sqrt(1 - zeta * zeta);
      const envelope = Math.exp(-zeta * omega0 * t);
      current = 1 - envelope * (Math.sin(omega1 * t) * ((v0 + zeta * omega0 * x0) / omega1) + x0 * Math.cos(omega1 * t));
    } else {
      const envelope = Math.exp(-omega0 * t);
      current = 1 - envelope * (x0 + (v0 + omega0 * x0) * t);
    }
    return { current, toValue: 1 };
  }

  /** Nombre de frames avant que le ressort reste sous le seuil pendant 20 frames. */
  function measureSpring({ fps, config = {}, threshold = 0.005 }) {
    if (threshold === 0) return Infinity;
    if (threshold === 1) return 0;
    let frame = 0;
    let diff = Math.abs(springCalculation({ frame, fps, config }).current - 1);
    while (diff >= threshold) {
      frame++;
      diff = Math.abs(springCalculation({ frame, fps, config }).current - 1);
    }
    let finished = frame;
    for (let i = 0; i < 20; i++) {
      frame++;
      diff = Math.abs(springCalculation({ frame, fps, config }).current - 1);
      if (diff >= threshold) { i = 0; finished = frame + 1; }
    }
    return finished;
  }

  /**
   * spring({ frame, fps, config: { damping, stiffness, mass, overshootClamping },
   *          from = 0, to = 1, durationInFrames, durationRestThreshold, delay = 0, reverse = false })
   */
  function spring({ frame, fps, config = {}, from = 0, to = 1, durationInFrames, durationRestThreshold, delay = 0, reverse = false }) {
    const cfg = { ...SPRING_DEFAULTS, ...config };
    const needsNatural = reverse || durationInFrames !== undefined;
    const natural = needsNatural ? measureSpring({ fps, config: cfg, threshold: durationRestThreshold }) : undefined;
    const reversed = reverse ? (durationInFrames ?? natural) - frame : frame;
    const delayed = reversed + (reverse ? delay : -delay);
    const stretched = durationInFrames === undefined ? delayed : delayed / (durationInFrames / natural);
    if (durationInFrames && delayed > durationInFrames) return to;
    const { current } = springCalculation({ frame: stretched, fps, config: cfg });
    const inner = cfg.overshootClamping ? (to >= from ? Math.min(current, 1) : Math.max(current, 1)) : current;
    return from === 0 && to === 1 ? inner : interpolate(inner, [0, 1], [from, to]);
  }

  /* =========================================================================
     2. HORLOGE — une boucle rAF, des séquences pures fonction de la frame
     ========================================================================= */

  const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const FPS = 30; // fps de « composition » : les délais data-delay s'expriment en frames à 30 fps

  const Clock = (() => {
    const sequences = new Set();
    let raf = 0;
    const tick = (now) => {
      for (const seq of sequences) {
        if (seq.start === null) seq.start = now;
        // Frame continue (flottante) : interpolate et spring sont continus, on profite des écrans 60/120 Hz
        const frame = ((now - seq.start) / 1000) * seq.fps - seq.delay;
        const end = seq.durationInFrames;
        if (end !== Infinity && frame >= end) {
          seq.render(end);
          sequences.delete(seq);
          seq.onEnd?.();
          seq.resolve();
        } else {
          seq.render(Math.max(frame, 0));
        }
      }
      raf = sequences.size ? requestAnimationFrame(tick) : 0;
    };
    return {
      /** Joue une séquence. render(frame) doit être une fonction pure de frame. */
      play({ render, durationInFrames = Infinity, delay = 0, fps = FPS, onEnd }) {
        const seq = { render, durationInFrames, delay, fps, onEnd, start: null, resolve: null };
        const done = new Promise((r) => { seq.resolve = r; });
        if (prefersReducedMotion.matches && durationInFrames !== Infinity) {
          render(durationInFrames);
          onEnd?.();
          seq.resolve();
          return { done, seq };
        }
        render(0);
        sequences.add(seq);
        if (!raf) raf = requestAnimationFrame(tick);
        return { done, seq };
      },
      stop(handle) {
        if (handle && sequences.delete(handle.seq)) handle.seq.resolve();
      },
      /** Attente exprimée en frames (aucun setTimeout). */
      wait(frames) {
        return Clock.play({ render: () => {}, durationInFrames: frames }).done;
      },
    };
  })();

  /** Durée naturelle d'un ressort, mise en cache. */
  const durationCache = new Map();
  const springDuration = (config, fps = FPS) => {
    const key = JSON.stringify(config) + fps;
    if (!durationCache.has(key)) durationCache.set(key, measureSpring({ fps, config: { ...SPRING_DEFAULTS, ...config } }));
    return durationCache.get(key);
  };

  /* Bibliothèque d'animations d'entrée : (élément, frame) → styles */
  const ENTER = {
    rise: {
      config: { damping: 18, stiffness: 90, mass: 0.9 },
      render(el, frame) {
        const p = spring({ frame, fps: FPS, config: this.config });
        el.style.opacity = interpolate(frame, [0, 9], [0, 1], CLAMP);
        el.style.transform = `translate3d(0, ${interpolate(p, [0, 1], [28, 0])}px, 0)`;
      },
    },
    reveal: {
      config: { damping: 200, stiffness: 80, mass: 1 },
      render(el, frame) {
        const p = spring({ frame, fps: FPS, config: this.config });
        el.style.opacity = 1;
        el.style.clipPath = `inset(${interpolate(p, [0, 1], [22, 0])}% 0 0 0 round 8px)`;
        const img = el.querySelector('img');
        if (img) img.style.transform = `scale(${interpolate(p, [0, 1], [1.12, 1])})`;
      },
    },
  };

  function animateIn(el, delay = 0) {
    const anim = ENTER[el.dataset.anim] || ENTER.rise;
    Clock.play({
      delay,
      durationInFrames: springDuration(anim.config),
      render: (f) => anim.render(el, f),
      onEnd: () => {
        el.style.opacity = '';
        el.style.transform = '';
        el.style.clipPath = '';
        const img = el.querySelector('img');
        if (img) img.style.transform = '';
        el.classList.add('is-done');
      },
    });
  }

  const enterObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        enterObserver.unobserve(el);
        const group = el.closest('[data-stagger]');
        const index = group ? [...group.querySelectorAll('[data-anim]')].indexOf(el) : 0;
        animateIn(el, Number(el.dataset.delay || 0) + index * 3);
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
  );

  /* Apparitions posées d'office : les cartes et titres de section des pages sans data-anim montent
     doucement à leur tour (hors carrousels). Seuls les éléments encore sous la ligne de flottaison sont concernés (aucun
     clignotement), et les cartes d'une même rangée se décalent de quelques frames. */
  const AUTO_ANIM = [
    '.section-head', '.split > *', '.room-card', '.room-index > li', '.offer-card', '.offer-teaser',
    '.service-tile', '.services-index > li', '.venue-card', '.venue-index > li', '.info-card', '.review-card',
    '.timeline > li', '.team', '.menu-section', '.post', '.faq',
  ].join(', ');

  function autoAnim(scope) {
    if (prefersReducedMotion.matches) return;
    const fold = window.innerHeight;
    $$(AUTO_ANIM, scope).forEach((el) => {
      // Cartes d'un carrousel : hors champ à l'horizontale, elles ne seraient révélées qu'au glissement
      if (el.closest('[data-anim], [data-slider]') || el.querySelector('[data-anim]')) return;
      const box = el.getBoundingClientRect();
      if (!box.height || box.top < fold) return;
      const siblings = [...el.parentElement.children].filter((s) => s.matches(AUTO_ANIM));
      el.dataset.anim = 'rise';
      el.dataset.delay = String((siblings.indexOf(el) % 3) * 4);
    });
  }

  /* Photos : fondu à l'arrivée pour celles qui ne sont pas encore chargées (pas la photo du bandeau) */
  function fadeImages(scope) {
    if (prefersReducedMotion.matches) return;
    $$('img', scope).forEach((img) => {
      if (img.complete || img.fetchPriority === 'high' || img.closest('.hero, .page-head--image, [data-anim="reveal"]')) return;
      img.classList.add('img-fade');
      const done = () => img.classList.add('is-loaded');
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }

  /* Compteurs : data-count-to="200" data-count-suffix=" m²" */
  const counterObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        counterObserver.unobserve(el);
        const to = Number(el.dataset.countTo);
        const suffix = el.dataset.countSuffix || '';
        const fmt = new Intl.NumberFormat(LOCALE);
        Clock.play({
          durationInFrames: 45,
          render: (f) => {
            const v = spring({ frame: f, fps: FPS, config: { damping: 26, stiffness: 70 }, durationInFrames: 45 });
            el.textContent = fmt.format(Math.round(v * to)) + suffix;
          },
        });
      });
    },
    { threshold: 0.6 },
  );

  /* =========================================================================
     3. OUTILS
     ========================================================================= */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const CDN = 'https://d1i8cf9j7dueks.cloudfront.net/cache/img/';

  /*
   * Deux modes de fonctionnement :
   *  - pages réelles générées par le back-office (/fr/chambres/…) : le build écrit
   *    #site-config (langue, adresses de chaque vue, moteur de réservation) ;
   *  - page unique historique avec des adresses #/… : pas de #site-config.
   */
  const SITE_CONFIG = (() => {
    try {
      const node = document.getElementById('site-config');
      return node ? JSON.parse(node.textContent) : null;
    } catch {
      return null;
    }
  })();
  const STATIC = Boolean(SITE_CONFIG);
  const SITE = STATIC ? `${SITE_CONFIG.site}/${SITE_CONFIG.lang}/` : 'https://www.hotel-aston.com/fr/';
  const LOCALE = SITE_CONFIG?.locale || 'fr-FR';
  /** Adresse d'une vue : « /fr/devis/ » en pages réelles, « #/devis » sinon. */
  const pathFor = (route) => (STATIC ? SITE_CONFIG.paths[route] ?? SITE_CONFIG.paths[''] : `#/${route}`);
  const UI = SITE_CONFIG?.i18n || {};
  /** Texte d'interface dans la langue de la page ({nom} remplacé par vars.nom) ; le français écrit ici sert de repli. */
  const ui = (key, fallback, vars) => String(UI[key] ?? fallback).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : m));
  const numberFmt = new Intl.NumberFormat(LOCALE);

  const dataCache = new Map();
  const readJSON = (id) => {
    if (!dataCache.has(id)) {
      const node = document.getElementById(id);
      dataCache.set(id, node ? JSON.parse(node.textContent) : null);
    }
    return dataCache.get(id);
  };

  /** Petit créateur d'éléments : h('a', { href }, 'texte', enfant…) */
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('data') && typeof v !== 'string') el.setAttribute(k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), String(v));
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(id, extraClass = '') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', `icon ${extraClass}`.trim());
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#${id}`);
    svg.append(use);
    return svg;
  }

  const storage = {
    get(store, key) {
      try { return JSON.parse(window[store].getItem(key)); } catch { return null; }
    },
    set(store, key, value) {
      try { window[store].setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible : on continue sans */ }
    },
  };

  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => {
    const [y, m, d] = String(s || '').split('-').map(Number);
    return y && m && d ? new Date(y, m - 1, d) : null;
  };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /* =========================================================================
     4. RÉSERVATION — dates, voyageurs, chambre consultée, offre → moteur
     ========================================================================= */

  /*
   * Noms des paramètres envoyés au moteur : les clés sont celles du site, les
   * valeurs les noms attendus par D-Edge. Valeur null : paramètre non envoyé.
   * Lien profond D-Edge relevé le 28/10/2026 : …/fr-FR/RoomSelection?arrivalDate=
   * AAAA-MM-JJ&departureDate=AAAA-MM-JJ&selectedAdultCount=N&selectedChildCount=N
   * (absent sans enfant) ; le visiteur choisit
   * ensuite sa chambre chez D-Edge.
   * Les Réglages du back-office (booking_engine.params, .rooms, .offers) priment
   * sur ces valeurs par défaut, sans toucher au code.
   */
  const BOOKING_DEFAULTS = {
    params: {
      checkin: 'arrivalDate',
      checkout: 'departureDate',
      nights: null,
      guests: null,
      adults: 'selectedAdultCount',
      children: 'selectedChildCount',
      roomType: null,
      offerId: null,
    },
    /* Codes chambre et tarif du moteur, par slug du site */
    rooms: { confort: 'confort', privilege: 'privilege', premium: 'premium', exclusive: 'exclusive', deluxe: 'deluxe', suites: 'suites' },
    offers: { 'escapade-gourmande': 'escapade-gourmande', 'nouvel-an': 'nouvel-an', carnaval: 'carnaval' },
  };
  const BOOKING_ENGINE = {
    base: SITE_CONFIG?.bookingBase || 'https://www.secure-hotel-booking.com/d-edge/redirect/2ARI/19552/fr-FR/RoomSelection?currency=EUR',
    params: { ...BOOKING_DEFAULTS.params, ...SITE_CONFIG?.booking?.params },
    rooms: { ...BOOKING_DEFAULTS.rooms, ...SITE_CONFIG?.booking?.rooms },
    offers: { ...BOOKING_DEFAULTS.offers, ...SITE_CONFIG?.booking?.offers },
    target: '_blank',
  };

  const ROOM_LABELS = { confort: 'Chambre Confort', privilege: 'Chambre Privilège', premium: 'Chambre Premium', exclusive: 'Chambre Exclusive', deluxe: 'Chambre Deluxe Terrasse', suites: 'Suite familiale' };
  const OFFER_LABELS = { 'escapade-gourmande': 'Escapade gourmande', 'nouvel-an': 'Nouvel An à Nice', carnaval: 'Magie du Carnaval' };
  const roomLabel = (k) => ui(`ui.room.${k}`, SITE_CONFIG?.roomNames?.[k] || ROOM_LABELS[k] || k);
  const offerLabel = (k) => ui(`ui.offer.${k}`, SITE_CONFIG?.offerNames?.[k] || OFFER_LABELS[k] || k);

  const STAY_KEY = 'aston.stay';
  let stay = storage.get('sessionStorage', STAY_KEY) || {};

  function validStay(s) {
    const a = parseISO(s.checkin);
    const b = parseISO(s.checkout);
    return Boolean(a && b && a >= today() && b > a);
  }

  /** Construit l'URL du moteur à partir des dates, voyageurs, chambre et offre. */
  function buildBookingUrl({ checkin, checkout, adults = 2, children = 0, roomType = '', offerId = '' }) {
    const url = new URL(BOOKING_ENGINE.base);
    const p = BOOKING_ENGINE.params;
    const a = parseISO(checkin);
    const b = parseISO(checkout);
    const set = (key, value) => { if (p[key] && value !== '' && value !== null && value !== undefined) url.searchParams.set(p[key], value); };
    set('checkin', checkin);
    set('checkout', checkout);
    if (a && b) set('nights', Math.round((b - a) / 86400000));
    set('adults', adults);
    set('children', Number(children) || ''); // comme D-Edge : rien sans enfant
    set('guests', Number(adults) + Number(children));
    set('roomType', BOOKING_ENGINE.rooms[roomType] || roomType);
    set('offerId', BOOKING_ENGINE.offers[offerId] || offerId);
    return url.toString();
  }

  /**
   * @param origin élément à l'origine du départ (bouton, formulaire) ; search : dates saisies dans un formulaire
   * L'événement « aston:booking » sert à la mesure d'audience (track.js).
   */
  function goToEngine(params, { origin = null, search = false } = {}) {
    const url = buildBookingUrl(params);
    (window.dataLayer = window.dataLayer || []).push({ event: 'booking_redirect', ...params });
    document.dispatchEvent(new CustomEvent('aston:booking', { detail: { ...params, origin, search } }));
    // Pas de 'noopener' dans les options : window.open renverrait toujours null
    const win = window.open(url, BOOKING_ENGINE.target);
    if (win) win.opener = null;
    else location.assign(url);
  }

  function readForm(form) {
    return {
      checkin: $('[data-checkin]', form)?.value,
      checkout: $('[data-checkout]', form)?.value,
      adults: $('[data-adults]', form)?.value || 2,
      children: $('[data-children]', form)?.value || 0,
      roomType: $('[data-room-select]', form)?.value || '',
      offerId: $('[data-offer-input]', form)?.value || '',
    };
  }

  function syncForms(except) {
    $$('[data-booking-form]').forEach((form) => {
      if (form === except) return;
      const ci = $('[data-checkin]', form);
      const co = $('[data-checkout]', form);
      if (ci && stay.checkin) ci.value = stay.checkin;
      if (co && stay.checkout) co.value = stay.checkout;
      if (stay.adults && $('[data-adults]', form)) $('[data-adults]', form).value = stay.adults;
      if (stay.children !== undefined && $('[data-children]', form)) $('[data-children]', form).value = stay.children;
      updateMins(form);
    });
  }

  function updateMins(form) {
    const ci = $('[data-checkin]', form);
    const co = $('[data-checkout]', form);
    if (!ci || !co) return;
    ci.min = isoDate(today());
    const a = parseISO(ci.value) || today();
    co.min = isoDate(addDays(a, 1));
  }

  function initBookingForm(form) {
    if (form.dataset.ready) return;
    form.dataset.ready = '1';
    const ci = $('[data-checkin]', form);
    const co = $('[data-checkout]', form);
    const err = $('[data-booking-error]', form);
    // Valeurs initiales : séjour mémorisé, sinon ce soir → demain (champs jamais vides sur iOS)
    ci.value = validStay(stay) ? stay.checkin : isoDate(today());
    co.value = validStay(stay) ? stay.checkout : isoDate(addDays(today(), 1));
    if (stay.adults && $('[data-adults]', form)) $('[data-adults]', form).value = stay.adults;
    if (stay.children !== undefined && $('[data-children]', form)) $('[data-children]', form).value = stay.children;
    updateMins(form);

    ci.addEventListener('change', () => {
      const a = parseISO(ci.value);
      const b = parseISO(co.value);
      if (a && (!b || b <= a)) co.value = isoDate(addDays(a, 1));
      updateMins(form);
    });

    form.addEventListener('change', () => {
      const v = readForm(form);
      stay = { ...stay, checkin: v.checkin, checkout: v.checkout, adults: v.adults, children: v.children };
      storage.set('sessionStorage', STAY_KEY, stay);
      syncForms(form);
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = readForm(form);
      if (!validStay(v)) {
        err.textContent = parseISO(v.checkin) < today()
          ? ui('ui.booking.past', "La date d'arrivée ne peut pas être passée.")
          : ui('ui.booking.order', 'Choisissez une date de départ postérieure à la date d’arrivée.');
        err.hidden = false;
        ci.focus();
        return;
      }
      err.hidden = true;
      stay = { ...stay, checkin: v.checkin, checkout: v.checkout, adults: v.adults, children: v.children };
      storage.set('sessionStorage', STAY_KEY, stay);
      goToEngine(v, { origin: form.closest('dialog') ? bookingOrigin || form : form, search: true });
      const dlg = form.closest('dialog');
      if (dlg?.open) dlg.close();
    });
  }

  const dialog = $('[data-booking-dialog]');

  function openBookingDialog({ roomType = '', offerId = '' } = {}) {
    const form = $('[data-booking-form]', dialog);
    initBookingForm(form);
    $('[data-room-select]', form).value = roomType;
    $('[data-offer-input]', form).value = offerId;
    const ctx = $('[data-booking-context]', dialog);
    const label = offerId ? ui('ui.booking.offer', 'Offre : {name}', { name: offerLabel(offerId) }) : roomType ? roomLabel(roomType) : '';
    ctx.textContent = label ? ui('ui.booking.context', '{label} · choisissez vos dates, vous arriverez directement sur les tarifs.', { label }) : '';
    ctx.hidden = !label;
    dialog.showModal();
    Clock.play({
      durationInFrames: springDuration({ damping: 20, stiffness: 160 }),
      render: (f) => {
        const p = spring({ frame: f, fps: FPS, config: { damping: 20, stiffness: 160 } });
        dialog.style.opacity = interpolate(f, [0, 6], [0, 1], CLAMP);
        dialog.style.transform = `translateY(${interpolate(p, [0, 1], [24, 0])}px) scale(${interpolate(p, [0, 1], [0.97, 1])})`;
      },
      onEnd: () => { dialog.style.transform = ''; dialog.style.opacity = ''; },
    });
    $('[data-checkin]', form).focus();
  }

  /** Tous les boutons « Réserver » : engine direct si dates connues, sinon module de dates. */
  let bookingOrigin = null; // bouton qui a ouvert le module de dates (source du clic pour les statistiques)

  function handleBook(trigger) {
    bookingOrigin = trigger;
    const roomType = trigger.dataset.roomType || '';
    const offerId = trigger.dataset.offerId || '';
    const fixed = trigger.dataset.checkin && trigger.dataset.checkout
      ? { checkin: trigger.dataset.checkin, checkout: trigger.dataset.checkout }
      : null;
    const dates = fixed && validStay(fixed) ? fixed : validStay(stay) ? stay : null;
    if (dates) {
      goToEngine({ ...dates, adults: stay.adults || 2, children: stay.children || 0, roomType, offerId }, { origin: trigger });
    } else {
      openBookingDialog({ roomType, offerId });
    }
  }

  function initDialog() {
    if (!dialog) return;
    $('[data-dialog-close]', dialog).addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  }

  /* =========================================================================
     5. SLIDERS — swipe natif (scroll-snap), flèches, glisser à la souris
        Aucune lecture automatique.
     ========================================================================= */

  const sliderReady = new WeakSet();
  const SLIDE_SPRING = { damping: 22, stiffness: 140, mass: 0.8 };

  function animateScroll(track, to) {
    const from = track.scrollLeft;
    const max = track.scrollWidth - track.clientWidth;
    const target = Math.max(0, Math.min(max, to));
    if (Math.abs(target - from) < 1) return;
    if (track._scrollSeq) Clock.stop(track._scrollSeq);
    track.style.scrollSnapType = 'none';
    track._scrollSeq = Clock.play({
      durationInFrames: springDuration(SLIDE_SPRING),
      render: (f) => {
        const p = spring({ frame: f, fps: FPS, config: SLIDE_SPRING });
        track.scrollLeft = interpolate(p, [0, 1], [from, target]);
      },
      onEnd: () => { track.style.scrollSnapType = ''; track._scrollSeq = null; },
    });
  }

  function slideOffsets(track) {
    const base = track.getBoundingClientRect().left - track.scrollLeft;
    const padLeft = parseFloat(getComputedStyle(track).paddingLeft) || 0;
    return [...track.children].map((c) => c.getBoundingClientRect().left - base - padLeft);
  }

  function initSlider(root) {
    if (sliderReady.has(root)) return;
    const track = $('[data-slider-track]', root);
    if (!track) return;
    sliderReady.add(root);
    const prev = $('[data-slider-prev]', root);
    const next = $('[data-slider-next]', root);
    const bar = $('[data-slider-progress]', root);

    const update = () => {
      const max = track.scrollWidth - track.clientWidth;
      root.classList.toggle('slider--static', max <= 2);
      const ratio = max > 0 ? track.scrollLeft / max : 0;
      const width = Math.max(12, Math.min(100, (track.clientWidth / track.scrollWidth) * 100));
      if (bar) {
        bar.style.width = `${width}%`;
        bar.style.left = `${ratio * (100 - width)}%`;
      }
      if (prev) prev.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= max - 2;
    };

    const step = (dir) => {
      const offsets = slideOffsets(track);
      const x = track.scrollLeft;
      const target = dir > 0 ? offsets.find((o) => o > x + 4) : [...offsets].reverse().find((o) => o < x - 4);
      animateScroll(track, target ?? (dir > 0 ? track.scrollWidth : 0));
    };

    prev?.addEventListener('click', () => step(-1));
    next?.addEventListener('click', () => step(1));
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    });

    let ticking = false;
    track.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { update(); ticking = false; });
    }, { passive: true });

    // Glisser à la souris (le tactile utilise le défilement natif, plus fiable sur iOS / Android)
    let drag = null;
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, left: track.scrollLeft, moved: false };
    });
    track.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 5) {
        drag.moved = true;
        track.classList.add('is-dragging');
        track.setPointerCapture(e.pointerId);
      }
      if (drag.moved) track.scrollLeft = drag.left - dx;
    });
    const endDrag = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      track.classList.remove('is-dragging');
      if (!moved) return;
      const offsets = slideOffsets(track);
      const x = track.scrollLeft;
      const nearest = offsets.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a), offsets[0]);
      animateScroll(track, nearest);
      track.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); }, { capture: true, once: true });
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);

    new ResizeObserver(update).observe(track);
    update();
  }

  /* =========================================================================
     6. MENU MOBILE — au-dessus de tout, croix 56 px, piège de focus, Échap
     ========================================================================= */

  const menu = $('[data-menu]');
  const backdrop = $('[data-menu-backdrop]');
  const burger = $('[data-menu-open]');
  const MENU_SPRING = { damping: 26, stiffness: 220, mass: 0.9 };
  let menuSeq = null;

  function animateMenu(open) {
    if (menuSeq) Clock.stop(menuSeq);
    const duration = springDuration(MENU_SPRING);
    menuSeq = Clock.play({
      durationInFrames: duration,
      render: (f) => {
        const p = spring({ frame: f, fps: FPS, config: MENU_SPRING });
        const x = open ? interpolate(p, [0, 1], [100, 0]) : interpolate(p, [0, 1], [0, 100]);
        menu.style.transform = `translateX(${x}%)`;
      },
      onEnd: () => {
        if (!open) { menu.hidden = true; backdrop.hidden = true; }
        menuSeq = null;
      },
    });
  }

  function openMenu() {
    menu.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add('is-open'));
    document.body.classList.add('is-locked');
    burger.setAttribute('aria-expanded', 'true');
    animateMenu(true);
    $('[data-menu-close]').focus();
  }

  function closeMenu({ restoreFocus = true } = {}) {
    if (menu.hidden) return;
    backdrop.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    burger.setAttribute('aria-expanded', 'false');
    animateMenu(false);
    if (restoreFocus) burger.focus();
  }

  function initMenu() {
    burger.addEventListener('click', openMenu);
    $('[data-menu-close]').addEventListener('click', () => closeMenu());
    backdrop.addEventListener('click', () => closeMenu());
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu({ restoreFocus: false }); });
    document.addEventListener('keydown', (e) => {
      if (menu.hidden) return;
      if (e.key === 'Escape') closeMenu();
      if (e.key === 'Tab') {
        const items = $$('a[href], button:not([disabled])', menu);
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    matchMedia('(min-width: 1024px)').addEventListener('change', (m) => { if (m.matches) closeMenu({ restoreFocus: false }); });
    // Sélecteur de langue de l'en-tête : se referme au clic à côté et sur Échap
    const langMenu = $('.lang-menu');
    if (langMenu) {
      document.addEventListener('click', (e) => { if (langMenu.open && !langMenu.contains(e.target)) langMenu.open = false; });
      langMenu.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && langMenu.open) { langMenu.open = false; $('summary', langMenu).focus(); }
      });
    }
  }

  /* =========================================================================
     7. BANDEAU LIVE MUSIC — fine ligne refermable, pages Restaurant & bar
     ========================================================================= */

  const strip = $('[data-live-strip]');
  const STRIP_KEY = 'aston.liveStrip.dismissed';

  function updateStrip(view) {
    if (!strip) return; // pages générées : bandeaux gérés par le back-office (zone top-bar)
    const dismissed = storage.get('localStorage', STRIP_KEY) === true;
    const show = Boolean(view?.hasAttribute('data-live-strip-show')) && !dismissed;
    strip.hidden = !show;
    document.documentElement.style.setProperty('--strip-h', show ? '36px' : '0px');
  }

  function initStrip() {
    if (!strip) return;
    $('[data-live-strip-close]', strip).addEventListener('click', () => {
      storage.set('localStorage', STRIP_KEY, true);
      updateStrip(null);
    });
  }

  /* =========================================================================
     8. AVIS — note, avis récents filtrés par thème / chambre, réponses de l'hôtel
     ========================================================================= */

  const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });
  const TOPIC_LABELS = { sejour: 'Séjour', chambres: 'Chambres', 'petit-dejeuner': 'Petit-déjeuner', rooftop: 'Rooftop', restaurant: 'Restaurant', seminaire: 'Séminaire' };
  const topicLabel = (t) => ui(`ui.topic.${t}`, TOPIC_LABELS[t] || t);

  function stars(n) {
    const wrap = h('span', { class: 'stars', role: 'img', 'aria-label': ui('ui.reviews.stars', '{n} sur 5', { n: numberFmt.format(n) }) });
    for (let i = 1; i <= 5; i++) wrap.append(icon('i-star', i <= Math.round(n) ? '' : 'is-empty'));
    return wrap;
  }

  /** Logo Google (« G » quatre couleurs), exigé à côté des avis repris de Google. */
  const GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  const googleLogo = () => h('span', { class: 'google-g', role: 'img', 'aria-label': 'Google', html: GOOGLE_G });

  /** Avatar de l'auteur : sa photo Google, sinon (ou si elle ne charge pas) son initiale. */
  function avatar(it) {
    const initial = () => h('span', { class: 'review-card__avatar review-card__avatar--initial', 'aria-hidden': 'true' }, (it.author || '?').trim().charAt(0).toUpperCase());
    if (!it.photo) return initial();
    const img = h('img', { class: 'review-card__avatar', src: it.photo, alt: '', width: 40, height: 40, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(initial()), { once: true });
    return img;
  }

  /**
   * Avis Google : note globale de la fiche, avis visibles notés 4 ou 5 étoiles (choisis au build),
   * avec nom, avatar, lien vers Google Maps, logo Google et la mention des critères de sélection.
   * Un avis sans thème compte comme un avis sur le séjour.
   */
  function renderReviews(container) {
    const data = readJSON('data-reviews');
    if (!data) return;
    const topic = container.dataset.topic || 'all';
    const room = container.dataset.room;
    const limit = Number(container.dataset.limit || 3);
    const mode = container.dataset.summary || 'none';
    const withReplies = container.hasAttribute('data-replies');
    const google = data.google || {};

    const about = (it) => (it.topics.length ? it.topics : ['sejour']);
    let items = data.items.filter((it) => topic === 'all' || about(it).includes(topic));
    if (room) items = [...items.filter((it) => it.room === room), ...items.filter((it) => it.room !== room)];
    items = items.slice(0, limit);
    const demo = items.some((it) => it.sample);

    const parts = [];
    const rating = google.rating;
    if (rating && mode !== 'none' && rating >= (data.ratingThreshold ?? 0)) {
      const source = google.url
        ? h('a', { class: 'rating__source', href: google.url, target: '_blank', rel: 'noopener' }, ui('ui.reviews.google', 'Note moyenne Google'))
        : h('span', { class: 'rating__source' }, ui('ui.reviews.google', 'Note moyenne Google'));
      parts.push(h('div', { class: 'reviews__summary' },
        h('div', { class: 'rating' },
          h('span', { class: 'rating__value' }, numberFmt.format(rating)),
          h('span', {}, stars(rating), h('br'), source,
            google.count ? h('span', { class: 'rating__count' }, ui('ui.reviews.count', '{n} avis sur Google', { n: numberFmt.format(google.count) })) : null)),
        googleLogo()));
    }

    const list = h('div', { class: 'reviews__list' });
    items.forEach((it) => {
      const card = h('article', { class: 'review-card' },
        it.sample ? h('span', { class: 'review-card__demo' }, ui('ui.reviews.demo', 'Exemple')) : null,
        h('header', { class: 'review-card__head' },
          avatar(it),
          h('span', { class: 'review-card__who' },
            h('strong', {}, it.author),
            h('time', { datetime: it.date }, monthFmt.format(parseISO(it.date)))),
          googleLogo()),
        stars(it.rating),
        it.text ? h('blockquote', {}, `« ${it.text} »`) : null,
        withReplies && it.reply ? h('p', { class: 'review-card__reply' }, h('strong', {}, ui('ui.reviews.reply', "Réponse de l'hôtel")), it.reply) : null,
        it.topics.length ? h('footer', {}, h('span', {}, it.topics.map(topicLabel).join(' · '))) : null);
      list.append(card);
    });
    if (!items.length) list.append(h('p', { class: 'muted' }, ui('ui.reviews.empty', 'Aucun avis récent sur ce thème pour le moment.')));
    parts.push(list);
    if (items.length) {
      parts.push(h('p', { class: 'reviews__note' },
        googleLogo(), ' ', ui('ui.reviews.selection', "Sélection d'avis Google récents notés 4 ou 5 étoiles."),
        google.url ? [' ', h('a', { href: google.url, target: '_blank', rel: 'noopener' }, ui('ui.reviews.all', 'Voir tous les avis sur Google Maps'))] : null));
    }
    if (demo) parts.push(h('p', { class: 'reviews__note' }, ui('ui.reviews.demo-note', 'Avis de démonstration : à remplacer par le flux vérifié de la fiche Google Business Profile.')));
    container.replaceChildren(...parts);
  }

  function initReviewFilters(scope) {
    $$('[data-review-filters]', scope).forEach((bar) => {
      if (bar.dataset.ready) return;
      bar.dataset.ready = '1';
      const target = bar.parentElement.querySelector('[data-reviews]');
      bar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        $$('[data-filter]', bar).forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
        target.dataset.topic = btn.dataset.filter;
        renderReviews(target);
      });
    });
  }

  /* =========================================================================
     9. OFFRES — filtres Séjour / Restaurant / Séminaires, transition FLIP au ressort
     ========================================================================= */

  const FLIP_SPRING = { damping: 18, stiffness: 130 };

  function filterOffers(container, family) {
    const cards = $$('.offer-card', container);
    const first = new Map(cards.map((c) => [c, c.getBoundingClientRect()]));
    cards.forEach((c) => { c.hidden = !(family === 'all' || c.dataset.family === family); });
    cards.filter((c) => !c.hidden).forEach((c, i) => {
      const a = first.get(c);
      const b = c.getBoundingClientRect();
      const appearing = a.width === 0;
      const dx = appearing ? 0 : a.left - b.left;
      const dy = appearing ? 26 : a.top - b.top;
      Clock.play({
        delay: i * 2,
        durationInFrames: springDuration(FLIP_SPRING),
        render: (f) => {
          const p = spring({ frame: f, fps: FPS, config: FLIP_SPRING });
          c.style.transform = `translate(${interpolate(p, [0, 1], [dx, 0])}px, ${interpolate(p, [0, 1], [dy, 0])}px)`;
          c.style.opacity = appearing ? interpolate(f, [0, 8], [0, 1], CLAMP) : '';
        },
        onEnd: () => { c.style.transform = ''; c.style.opacity = ''; },
      });
    });
  }

  function initOfferFilters(scope, query) {
    $$('[data-filters]', scope).forEach((bar) => {
      const container = bar.parentElement.querySelector('[data-offers]');
      const select = (family) => {
        $$('[data-filter]', bar).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.filter === family)));
        filterOffers(container, family);
      };
      if (!bar.dataset.ready) {
        bar.dataset.ready = '1';
        bar.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-filter]');
          if (btn) select(btn.dataset.filter);
        });
      }
      const wanted = query.get('famille');
      if (wanted && $(`[data-filter="${wanted}"]`, bar)) select(wanted);
    });
  }

  /* =========================================================================
     10. FORMULAIRES — devis pré-rempli, envoi (endpoint ou e-mail pré-rempli)
     ========================================================================= */

  function initQuoteForms(scope, query) {
    $$('[data-quote-form]', scope).forEach((form) => {
      const offer = $('[data-quote-offer]', form);
      const wanted = query.get('offre') || query.get('salle');
      if (offer && wanted && $(`option[value="${CSS.escape(wanted)}"]`, offer)) offer.value = wanted;
      if (form.dataset.ready) return;
      form.dataset.ready = '1';
      const status = $('[data-form-status]', form);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const invalid = $$('[required]', form).filter((f) => !f.value.trim() || (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.value)));
        $$('[aria-invalid]', form).forEach((f) => f.removeAttribute('aria-invalid'));
        if (invalid.length) {
          invalid.forEach((f) => f.setAttribute('aria-invalid', 'true'));
          status.textContent = ui('ui.form.invalid', 'Merci de compléter les champs indiqués.');
          status.classList.add('is-error');
          status.hidden = false;
          invalid[0].focus();
          return;
        }
        const data = Object.fromEntries(new FormData(form));
        const label = offer?.selectedOptions[0]?.textContent;
        document.dispatchEvent(new CustomEvent('aston:quote', { detail: { form, offer: data.offre || data.salle || null } }));
        if (form.dataset.endpoint) {
          try {
            const res = await fetch(form.dataset.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            if (!res.ok) throw new Error(res.statusText);
            status.textContent = ui('ui.form.sent', 'Merci, votre demande est bien envoyée.');
            status.classList.remove('is-error');
            form.reset();
          } catch {
            status.textContent = ui('ui.form.failed', "L'envoi a échoué. Écrivez-nous à {email}.", { email: form.dataset.mailto });
            status.classList.add('is-error');
          }
        } else {
          const subject = form.dataset.subject || `${ui('ui.form.subject', 'Demande de devis')}${label && data.offre ? ` : ${label}` : ''}`;
          const body = Object.entries(data).filter(([, v]) => v).map(([k, v]) => `${k} : ${v}`).join('\n');
          location.href = `mailto:${form.dataset.mailto}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
          status.textContent = ui('ui.form.mailto', 'Votre messagerie s’ouvre avec la demande pré-remplie : il ne reste qu’à l’envoyer.');
          status.classList.remove('is-error');
        }
        status.hidden = false;
      });
    });
  }

  /** Refus de la mesure d'audience (page Politique de confidentialité) : drapeau lu par track.js. */
  function initNoStats() {
    const NO_STATS = 'aston.no-stats';
    const signal = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
    for (const box of $$('[data-no-stats]')) {
      const button = $('[data-no-stats-toggle]', box);
      const show = () => {
        let off = signal;
        try { off ||= localStorage.getItem(NO_STATS) === '1'; } catch { /* stockage indisponible */ }
        $('[data-no-stats-off]', box).hidden = !off;
        button.hidden = signal; // signal du navigateur : rien à changer ici
        for (const label of $$('[data-no-stats-label]', button)) label.hidden = (label.dataset.noStatsLabel === 'on') !== off;
      };
      button.addEventListener('click', () => {
        try {
          if (localStorage.getItem(NO_STATS) === '1') localStorage.removeItem(NO_STATS);
          else localStorage.setItem(NO_STATS, '1');
        } catch { /* stockage indisponible : choix impossible à retenir */ }
        show();
      });
      show();
      box.hidden = false;
    }
  }

  /* =========================================================================
     11. CARTE — plan schématique interactif, Google Maps chargée à la demande
     ========================================================================= */

  function initMaps(scope) {
    $$('[data-map-load]', scope).forEach((btn) => {
      if (btn.dataset.ready) return;
      btn.dataset.ready = '1';
      btn.addEventListener('click', () => {
        const map = btn.closest('[data-map]');
        map.append(h('iframe', {
          src: map.dataset.mapSrc,
          title: ui('ui.map.title', 'Carte Google : hôtel Aston La Scala, 12 avenue Félix Faure, Nice'),
          loading: 'lazy',
          referrerpolicy: 'no-referrer-when-downgrade',
          allowfullscreen: true,
        }));
        map.classList.add('is-loaded');
      });
    });
    $$('[data-poi-list]', scope).forEach((list) => {
      if (list.dataset.ready) return;
      list.dataset.ready = '1';
      const plan = list.closest('.split')?.querySelector('.map__plan');
      const activate = (id) => {
        $$('[data-poi]', list).forEach((li) => li.classList.toggle('is-active', li.dataset.poi === id));
        if (!plan) return;
        $$('[data-route-to]', plan).forEach((p) => p.classList.toggle('is-active', p.dataset.routeTo === id));
        $$('[data-poi-dot]', plan).forEach((g) => g.classList.toggle('is-active', g.dataset.poiDot === id));
        // Tracé du trajet : stroke-dashoffset piloté par la frame
        const path = $(`[data-route-to="${id}"]`, plan);
        if (path) {
          Clock.play({
            durationInFrames: 24,
            render: (f) => { path.style.strokeDashoffset = String(interpolate(f, [0, 24], [72, 0], { easing: Easing.out(Easing.cubic) })); },
          });
        }
      };
      $$('[data-poi]', list).forEach((li) => {
        li.tabIndex = 0;
        const on = () => activate(li.dataset.poi);
        li.addEventListener('mouseenter', on);
        li.addEventListener('focus', on);
        li.addEventListener('click', on);
      });
      activate('vieilleville');
    });
  }

  /* =========================================================================
     12. VIDÉOS ÉCONOMES — la photo d'abord si la connexion est faible ;
         la vidéo sinon, ou si elle est déjà en cache (service worker sw.js)
     ========================================================================= */

  const connection = navigator.connection || null;
  // Recette : ajouter ?reseau=lent ou ?reseau=rapide à l'adresse force le profil réseau
  const networkOverride = new URLSearchParams(location.search).get('reseau');
  const LOW_DOWNLINK = 1.5;    // Mb/s : en dessous, les boucles (4 à 6 Mo) ne sont pas lancées
  const START_TIMEOUT = 5000;  // ms : vidéo pas démarrée à temps -> on l'abandonne, la photo reste

  /** Profil réseau : 'low' | 'good' | 'unknown'. */
  function networkProfile() {
    if (networkOverride === 'lent') return 'low';
    if (networkOverride === 'rapide') return 'good';
    if (connection) {
      if (connection.saveData) return 'low';
      if (/^(slow-2g|2g|3g)$/.test(connection.effectiveType || '')) return 'low';
      if (connection.downlink > 0 && connection.downlink < LOW_DOWNLINK) return 'low';
      return 'good';
    }
    // Safari et Firefox n'exposent pas l'API : débit estimé sur le téléchargement du poster
    const entry = performance.getEntriesByType('resource').find((r) => /(poster|hero-piscine[^/]*)\.webp$/.test(r.name) && r.transferSize > 0);
    if (entry && entry.responseEnd > entry.requestStart) {
      const mbps = (entry.encodedBodySize * 8) / ((entry.responseEnd - entry.requestStart) / 1000) / 1e6;
      return mbps < LOW_DOWNLINK ? 'low' : 'good';
    }
    return 'unknown';
  }

  async function mediaCached(url) {
    if (!('caches' in window)) return false;
    try { return Boolean(await caches.match(url)); } catch { return false; }
  }

  /** Demande au service worker de garder la vidéo pour les visites suivantes. */
  async function cacheForNextVisit(url) {
    if (!('serviceWorker' in navigator) || networkProfile() === 'low' || (await mediaCached(url))) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const worker = reg && (reg.active || reg.waiting || reg.installing);
    if (worker) worker.postMessage({ type: 'cache-media', url });
  }

  /** Rappelle cb dès que la connexion devient bonne (API Network Information). */
  function onceConnectionGood(cb) {
    if (!connection || networkOverride) return;
    const check = () => {
      if (networkProfile() !== 'good') return;
      connection.removeEventListener('change', check);
      cb();
    };
    connection.addEventListener('change', check);
  }

  const videoObserver = new IntersectionObserver((entries) => {
    entries.forEach(({ target: v, isIntersecting }) => {
      if (!isIntersecting) {
        if (!v.paused) v.pause();
        return;
      }
      v.play().catch(() => {});
      armWatchdog(v);
    });
  }, { rootMargin: '200px 0px' });

  /** Minuteur de garde réseau (temps réel, pas une animation) : la vidéo doit démarrer à temps. */
  function armWatchdog(v) {
    if (!v._watchdog || v._watchdogArmed || v.classList.contains('is-playing')) return;
    v._watchdogArmed = true;
    const timer = setTimeout(() => {
      if (v.classList.contains('is-playing')) return;
      videoObserver.unobserve(v);
      v.pause();
      v.removeAttribute('src');
      v.load(); // interrompt le téléchargement : la photo reste affichée
      onceConnectionGood(() => playVideo(v, true));
    }, START_TIMEOUT);
    v.addEventListener('playing', () => clearTimeout(timer), { once: true });
  }

  function playVideo(v, watchdog) {
    v._watchdog = watchdog;
    v._watchdogArmed = false;
    v.src = v.dataset.videoSrc;
    videoObserver.observe(v);
  }

  async function initVideo(v) {
    // Source choisie une fois pour toutes (attribut media des <source>), puis retirée du DOM :
    // sans src ni autoplay, rien n'est téléchargé tant que le script n'a pas décidé.
    const sources = $$('source', v);
    const pick = sources.find((s) => !s.media || matchMedia(s.media).matches) || sources[0];
    if (!pick) return;
    const url = new URL(pick.getAttribute('src') || pick.dataset.src, location.href).href;
    sources.forEach((s) => s.remove());
    v.dataset.videoSrc = url;
    v.autoplay = false;
    v.muted = true;
    v.addEventListener('playing', () => {
      v.classList.add('is-playing');
      const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 3000));
      idle(() => cacheForNextVisit(url));
    }, { once: true });

    if (prefersReducedMotion.matches) return; // image fixe uniquement
    const cached = await mediaCached(url);
    if (cached || networkProfile() !== 'low') {
      playVideo(v, !cached); // depuis le cache : aucun délai réseau à surveiller
    } else {
      onceConnectionGood(() => playVideo(v, true)); // connexion faible : la photo reste
    }
  }

  function initVideos(scope) {
    $$('video[data-adaptive-video], video[data-lazy-video]', scope).forEach((v) => {
      if (v.dataset.ready) return;
      v.dataset.ready = '1';
      initVideo(v);
    });
  }

  function registerServiceWorker() {
    // Les service workers n'existent qu'en contexte sécurisé : HTTPS ou localhost
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    if (STATIC && !SITE_CONFIG.sw) return; // prévisualisation : pas de mise en cache
    navigator.serviceWorker.register(STATIC ? SITE_CONFIG.sw : 'sw.js').catch((err) => console.warn('[remotion-vanilla] service worker', err));
  }

  /* =========================================================================
     13. GABARITS — fiches chambres et services (données JSON de index.html)
     ========================================================================= */

  function fill(root, name) {
    const node = root.querySelector(`[data-f="${name}"]`);
    if (node) node.removeAttribute('data-f');
    return node;
  }

  function renderRoom(view, slug) {
    const rooms = readJSON('data-rooms');
    const amenities = readJSON('data-amenities');
    const r = rooms[slug];
    if (!r) return null;
    const frag = document.getElementById('tpl-room').content.cloneNode(true);
    fill(frag, 'name').textContent = r.name;
    fill(frag, 'category').textContent = r.category;
    fill(frag, 'h1').textContent = r.h1;
    fill(frag, 'shortName').textContent = r.shortName;
    fill(frag, 'facts').replaceChildren(...r.facts.map((t) => h('span', {}, t)));
    const track = fill(frag, 'galleryLabel');
    track.setAttribute('aria-label', `Photos : ${r.name}, faites glisser`);
    r.gallery.forEach((g, i) => track.append(
      h('figure', {},
        h('img', { src: CDN + g.src, alt: g.alt, width: g.w, height: g.h, loading: i ? 'lazy' : 'eager', decoding: 'async' }),
        h('figcaption', {}, g.kind))));
    fill(frag, 'description').textContent = r.description;
    const variants = fill(frag, 'variants');
    if (r.variants) {
      variants.className = 'variants';
      r.variants.forEach((v) => variants.append(h('div', { class: 'variant' }, h('h3', {}, v.title), h('p', {}, v.text))));
    }
    fill(frag, 'amenities').replaceChildren(...r.amenities.map((key) => {
      const a = amenities[key];
      return h('li', {}, icon(a.icon), a.label);
    }));
    fill(frag, 'amenitiesFull').replaceChildren(...r.amenitiesFull.map((t) => h('li', {}, t)));
    const reviews = fill(frag, 'reviews');
    reviews.dataset.topic = r.reviewTopic;
    reviews.dataset.room = slug;
    fill(frag, 'otherRooms').replaceChildren(...Object.entries(rooms)
      .filter(([k]) => k !== slug)
      .map(([k, o]) => h('li', {}, h('a', { href: `#/chambres/${k}` }, o.name))));
    $('[data-room-select]', frag).value = slug;
    view.replaceChildren(frag);
    return {
      title: r.title,
      description: r.metaDescription,
      ld: {
        '@context': 'https://schema.org',
        '@type': 'HotelRoom',
        name: r.name,
        description: r.description,
        floorSize: { '@type': 'QuantitativeValue', value: r.sizeM2, unitCode: 'MTK' },
        occupancy: { '@type': 'QuantitativeValue', maxValue: r.maxGuests },
        amenityFeature: r.amenitiesFull.map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true })),
        image: r.gallery.map((g) => CDN + g.src),
        containedInPlace: { '@id': 'https://www.hotel-aston.com/#hotel' },
      },
    };
  }

  function renderService(view, slug) {
    const s = readJSON('data-services')[slug];
    if (!s) return null;
    const frag = document.getElementById('tpl-service').content.cloneNode(true);
    fill(frag, 'name').textContent = s.name;
    fill(frag, 'h1').textContent = s.h1;
    fill(frag, 'lede').textContent = s.lede;
    fill(frag, 'photos').replaceChildren(...s.photos.map((p) => h('figure', {}, h('img', { src: CDN + p.src, alt: p.alt, width: p.w, height: p.h, decoding: 'async' }))));
    fill(frag, 'body').innerHTML = s.body; // contenu éditorial interne (data-services), pas une saisie utilisateur
    fill(frag, 'facts').replaceChildren(...s.facts.map(([dt, dd]) => h('div', {}, h('dt', {}, dt), h('dd', {}, dd))));
    const faq = fill(frag, 'faq');
    faq.append(h('h2', {}, `Questions fréquentes : ${s.name.toLowerCase()}`));
    s.faq.forEach(([q, a]) => faq.append(h('details', {}, h('summary', {}, q), h('p', {}, a))));
    view.replaceChildren(frag);
    return { title: s.title, description: s.metaDescription, ld: null };
  }

  /* Infos pratiques clonées depuis l'accueil (une seule source de vérité) */
  function fillHouseRules(scope) {
    const src = $('[data-house-rules-source]');
    if (!src) return;
    $$('[data-house-rules]', scope).forEach((slot) => {
      if (slot.childElementCount) return;
      const copy = src.cloneNode(true);
      copy.removeAttribute('data-house-rules-source');
      $$('[id]', copy).forEach((n) => n.removeAttribute('id'));
      slot.append(copy);
    });
  }

  /* Soirées Live Music : prochains vendredis et samedis */
  function renderGigs(scope) {
    const list = $('[data-gig-list]', scope);
    if (!list || list.childElementCount) return;
    const fmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
    const dates = [];
    for (let d = today(); dates.length < 6; d = addDays(d, 1)) if (d.getDay() === 5 || d.getDay() === 6) dates.push(d);
    list.replaceChildren(...dates.map((d) => h('li', {},
      h('time', { datetime: isoDate(d) }, fmt.format(d)),
      h('span', {}, ui('ui.gigs.line', 'Live Music · blues & soul · Moon Bar ou Aston Club selon la météo')),
      h('span', {}, ui('ui.gigs.artist', 'Artiste annoncé prochainement')))));
  }

  /* =========================================================================
     14. CHAT — réponse immédiate, coordonnées demandées seulement si utile
     ========================================================================= */

  const chatRoot = $('[data-chat]');
  const chatPanel = $('[data-chat-panel]');
  const chatToggle = $('[data-chat-toggle]');
  const chatLog = $('[data-chat-log]');
  let chatStarted = false;

  function chatSay(html, role = 'bot') {
    const msg = h('div', { class: `chat__msg chat__msg--${role}` });
    if (role === 'bot') msg.innerHTML = html; // réponses issues de la base interne data-chat
    else msg.textContent = html;
    chatLog.append(msg);
    Clock.play({
      durationInFrames: 14,
      render: (f) => {
        const p = spring({ frame: f, fps: FPS, config: { damping: 16, stiffness: 180 } });
        msg.style.opacity = interpolate(f, [0, 5], [0, 1], CLAMP);
        msg.style.transform = `translateY(${interpolate(p, [0, 1], [10, 0])}px)`;
      },
      onEnd: () => { msg.style.transform = ''; msg.style.opacity = ''; },
    });
    chatLog.scrollTop = chatLog.scrollHeight;
    return msg;
  }

  function chatCapture(kind) {
    const isQuote = kind === 'devis';
    const form = h('form', { class: 'chat__capture' },
      isQuote
        ? [
            h('label', { class: 'sr-only', for: 'cc-name' }, ui('ui.chat.name', 'Nom')), h('input', { id: 'cc-name', name: 'nom', placeholder: ui('ui.chat.name-placeholder', 'Nom et société'), autocomplete: 'organization', required: true }),
            h('label', { class: 'sr-only', for: 'cc-mail' }, ui('ui.chat.email', 'E-mail')), h('input', { id: 'cc-mail', name: 'email', type: 'email', placeholder: ui('ui.chat.email', 'E-mail'), autocomplete: 'email', required: true }),
            h('label', { class: 'sr-only', for: 'cc-people' }, ui('ui.chat.people', 'Participants')), h('input', { id: 'cc-people', name: 'participants', type: 'number', min: '1', placeholder: ui('ui.chat.people-placeholder', 'Nombre de participants') }),
          ]
        : [
            h('label', { class: 'sr-only', for: 'cc-name' }, ui('ui.chat.firstname', 'Prénom')), h('input', { id: 'cc-name', name: 'prenom', placeholder: ui('ui.chat.firstname', 'Prénom'), autocomplete: 'given-name', required: true }),
            h('label', { class: 'sr-only', for: 'cc-tel' }, ui('ui.chat.phone', 'Téléphone')), h('input', { id: 'cc-tel', name: 'telephone', type: 'tel', placeholder: ui('ui.chat.phone', 'Téléphone'), autocomplete: 'tel', required: true }),
            h('label', { class: 'sr-only', for: 'cc-slot' }, ui('ui.chat.slot', 'Créneau')), h('select', { id: 'cc-slot', name: 'creneau' },
              h('option', {}, ui('ui.chat.slot-morning', 'Le matin')), h('option', {}, ui('ui.chat.slot-afternoon', "L'après-midi")), h('option', {}, ui('ui.chat.slot-evening', 'En soirée'))),
          ],
      h('button', { class: 'btn btn--primary', type: 'submit' }, isQuote ? ui('ui.chat.submit-quote', 'Recevoir ma proposition') : ui('ui.chat.submit-callback', 'Être rappelé')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form));
      const to = isQuote ? 'events@hotelastonlascala.com' : 'reception@hotelastonlascala.com';
      if (isQuote) document.dispatchEvent(new CustomEvent('aston:quote', { detail: { form, source: 'chat' } }));
      const subject = isQuote ? ui('ui.chat.subject-quote', 'Demande de devis (chat du site)') : ui('ui.chat.subject-callback', 'Demande de rappel (chat du site)');
      const body = Object.entries(data).map(([k, v]) => `${k} : ${v}`).join('\n');
      location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      form.replaceWith(h('p', { class: 'small muted' }, ui('ui.chat.prepared', 'Demande préparée.')));
      chatSay(isQuote
        ? ui('ui.chat.thanks-quote', "Merci ! Votre messagerie s'ouvre avec la demande prête à envoyer. Pour aller plus loin : <a href=\"{devis}\">formulaire de devis complet</a>.", { devis: pathFor('devis') })
        : ui('ui.chat.thanks-callback', "Merci ! Votre messagerie s'ouvre avec la demande prête à envoyer ; la réception vous rappelle sur le créneau choisi."));
    });
    chatLog.append(form);
    chatLog.scrollTop = chatLog.scrollHeight;
    $('input', form).focus();
  }

  async function chatAnswer(intentId, question) {
    const kb = readJSON('data-chat');
    if (question) chatSay(question, 'user');
    let intent = kb.intents.find((i) => i.id === intentId);
    if (!intent && question) {
      const q = normalize(question);
      let best = 0;
      for (const it of kb.intents) {
        const score = it.keywords.reduce((n, k) => n + (q.includes(normalize(k)) ? 1 : 0), 0);
        if (score > best) { best = score; intent = it; }
      }
    }
    document.dispatchEvent(new CustomEvent('aston:chat', { detail: { intent: intent?.id || null } })); // thème seulement, jamais le texte tapé
    await Clock.wait(prefersReducedMotion.matches ? 0 : 12);
    if (!intent) {
      chatSay(kb.fallback);
      return;
    }
    chatSay(intent.answer);
    if (intent.capture) chatCapture(intent.capture);
  }

  function setChat(open) {
    chatPanel.hidden = !open;
    chatToggle.setAttribute('aria-expanded', String(open));
    if (!open) { chatToggle.focus(); return; }
    if (!chatStarted) { chatStarted = true; chatSay(readJSON('data-chat').greeting); }
    Clock.play({
      durationInFrames: springDuration({ damping: 18, stiffness: 200 }),
      render: (f) => {
        const p = spring({ frame: f, fps: FPS, config: { damping: 18, stiffness: 200 } });
        chatPanel.style.opacity = interpolate(f, [0, 5], [0, 1], CLAMP);
        chatPanel.style.transform = `scale(${interpolate(p, [0, 1], [0.92, 1])})`;
      },
      onEnd: () => { chatPanel.style.transform = ''; chatPanel.style.opacity = ''; },
    });
    // Pas de focus automatique au doigt : le clavier virtuel masquerait les réponses rapides
    if (matchMedia('(pointer: fine)').matches) $('#chat-input').focus();
  }

  function initChat() {
    chatToggle.addEventListener('click', () => setChat(chatPanel.hidden));
    $('[data-chat-close]', chatRoot).addEventListener('click', () => setChat(false));
    $('[data-chat-chips]', chatRoot).addEventListener('click', (e) => {
      const b = e.target.closest('[data-ask]');
      if (b) chatAnswer(b.dataset.ask, b.textContent);
    });
    $('[data-chat-form]', chatRoot).addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#chat-input');
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      chatAnswer(null, q);
    });
    chatPanel.addEventListener('keydown', (e) => { if (e.key === 'Escape') setChat(false); });
  }

  /* =========================================================================
     15. ROUTEUR — vues « multi-pages » avec <title>, meta et H1 propres
     ========================================================================= */

  const views = $$('.view[data-route]').map((el) => ({ el, parts: el.dataset.route.split('/').filter(Boolean) }));
  const metaDescription = $('meta[name="description"]');
  const canonical = $('link[rel="canonical"]');
  const ogTitle = $('meta[property="og:title"]');
  const ogDescription = $('meta[property="og:description"]');
  const NAV_GROUPS = {
    chambres: 'chambres', appartements: 'chambres',
    'restaurant-bar': 'restaurant-bar', 'restaurant-horloge': 'restaurant-bar', 'aston-club': 'restaurant-bar', 'moon-bar': 'restaurant-bar',
    'carte-moon-bar': 'restaurant-bar', 'carte-tapas': 'restaurant-bar', 'live-music': 'restaurant-bar',
    seminaires: 'seminaires', devis: 'seminaires', 'salle-seminaire-nice': 'seminaires', 'seminaire-residentiel-nice': 'seminaires', 'comite-entreprise-nice': 'seminaires',
    offres: 'offres',
    'acces-contact': 'acces-contact',
    blog: 'blog',
  };
  let currentPath = null;
  let lastRealHash = '#/';

  function parseHash() {
    const raw = location.hash;
    if (!raw.startsWith('#/')) return { path: '', query: new URLSearchParams(), anchor: raw.slice(1) || null };
    const [path, qs] = raw.slice(2).split('?');
    return { path: path.replace(/\/+$/, ''), query: new URLSearchParams(qs || ''), anchor: null };
  }

  function matchRoute(path) {
    const segs = path.split('/').filter(Boolean);
    for (const v of views) {
      if (v.parts.length !== segs.length) continue;
      const params = {};
      const ok = v.parts.every((p, i) => {
        if (p.startsWith(':')) { params[p.slice(1)] = decodeURIComponent(segs[i]); return true; }
        return p === segs[i];
      });
      if (ok) return { view: v.el, params };
    }
    return null;
  }

  function setMeta({ title, description, path, ld }) {
    document.title = title;
    metaDescription.setAttribute('content', description);
    ogTitle.setAttribute('content', title);
    ogDescription.setAttribute('content', description);
    canonical.setAttribute('href', SITE + path);
    let ldNode = $('#ld-view');
    if (ld) {
      if (!ldNode) { ldNode = h('script', { type: 'application/ld+json', id: 'ld-view' }); document.head.append(ldNode); }
      ldNode.textContent = JSON.stringify(ld);
    } else {
      ldNode?.remove();
    }
  }

  function updateBottomBar(view, path) {
    const cta = $('[data-bottom-cta]');
    const call = $('[data-bottom-call]');
    const mode = view.dataset.cta || 'room';
    if (mode === 'table') {
      const targetId = view.dataset.tableTarget;
      const route = view.dataset.tableRoute || path;
      const tel = document.getElementById(targetId)?.querySelector('a[href^="tel:"]')?.getAttribute('href') || 'tel:+33492175309';
      cta.textContent = ui('ui.cta.table', 'Réserver une table');
      cta.setAttribute('href', `${pathFor(route)}?a=${targetId}`);
      cta.removeAttribute('data-book');
      call.setAttribute('href', tel);
    } else if (mode === 'devis') {
      cta.textContent = ui('ui.cta.quote', 'Demander un devis');
      cta.setAttribute('href', pathFor('devis'));
      cta.removeAttribute('data-book');
      call.setAttribute('href', 'tel:+33492175394');
    } else {
      cta.textContent = ui('ui.cta.room', 'Réserver une chambre');
      cta.setAttribute('href', STATIC ? BOOKING_ENGINE.base : '#/reserver');
      cta.setAttribute('data-book', '');
      const slug = path.startsWith('chambres/') ? path.split('/')[1] : '';
      if (slug) cta.dataset.roomType = slug; else delete cta.dataset.roomType;
      call.setAttribute('href', 'tel:+33497202524');
    }
  }

  function initScope(scope, query) {
    $$('[data-booking-form]', scope).forEach(initBookingForm);
    $$('[data-slider]', scope).forEach(initSlider);
    $$('[data-reviews]', scope).forEach(renderReviews);
    initReviewFilters(scope);
    initOfferFilters(scope, query);
    initQuoteForms(scope, query);
    initMaps(scope);
    initVideos(scope);
    fillHouseRules(scope);
    renderGigs(scope);
    autoAnim(scope);
    fadeImages(scope);
    $$('[data-anim]:not(.is-done)', scope).forEach((el) => enterObserver.observe(el));
    $$('[data-count-to]', scope).forEach((el) => counterObserver.observe(el));
  }

  /** Pages réelles : une seule vue par page, déjà remplie par le build (titre, meta, fiche). */
  function routeStatic() {
    const view = $('.view[data-route]');
    if (!view) return;
    const key = view.dataset.route;
    const query = new URLSearchParams(location.search);
    view.classList.add('is-active');
    document.body.dataset.currentView = view.dataset.view;
    document.documentElement.dataset.currentView = view.dataset.view;
    updateBottomBar(view, key);
    updateStrip(view);
    const group = NAV_GROUPS[key.split('/')[0]];
    $$('[data-nav]').forEach((a) => (a.dataset.nav === group ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    initScope(view, query);
    const anchor = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : null;
    const target = (query.get('a') && document.getElementById(query.get('a'))) || (anchor && document.getElementById(anchor));
    if (target) {
      target.scrollIntoView({ behavior: 'auto', block: 'start' });
      if (target.matches('[data-table-booking]')) target.classList.add('is-highlight');
    }
  }

  function route({ initial = false } = {}) {
    if (STATIC) { routeStatic(); return; }
    const { path, query, anchor } = parseHash();

    if (path === 'reserver') {
      // Lien générique « Réserver » : module de dates, puis retour à la page d'origine
      history.replaceState(null, '', lastRealHash);
      if (!initial) { openBookingDialog({ roomType: query.get('room') || '', offerId: query.get('offre') || '' }); return; }
      route({ initial });
      openBookingDialog({ roomType: query.get('room') || '', offerId: query.get('offre') || '' });
      return;
    }

    const found = matchRoute(path) || matchRoute('');
    const { view } = found;
    let meta = { title: view.dataset.title, description: view.dataset.description, path, ld: null };

    if (view.dataset.template) {
      const slug = found.params.slug;
      const rendered = view.dataset.template === 'tpl-room' ? renderRoom(view, slug) : renderService(view, slug);
      if (!rendered) { location.replace(view.dataset.template === 'tpl-room' ? '#/chambres' : '#/services'); return; }
      meta = { ...meta, ...rendered };
    }

    const changed = currentPath !== path || view.dataset.template;
    views.forEach(({ el }) => el.classList.toggle('is-active', el === view));
    document.body.dataset.currentView = view.dataset.view;
    document.documentElement.dataset.currentView = view.dataset.view;
    setMeta(meta);
    updateBottomBar(view, path);
    updateStrip(view);
    const group = NAV_GROUPS[path.split('/')[0]];
    $$('[data-nav]').forEach((a) => (a.dataset.nav === group ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    initScope(view, query);
    currentPath = path;
    lastRealHash = location.hash || '#/';

    const target = (query.get('a') && document.getElementById(query.get('a'))) || (anchor && document.getElementById(anchor));
    if (target) {
      // Appel direct (pas de rAF) : fonctionne aussi dans un onglet en arrière-plan
      target.scrollIntoView({ behavior: prefersReducedMotion.matches || initial ? 'auto' : 'smooth', block: 'start' });
      if (target.matches('[data-table-booking]')) {
        target.classList.remove('is-highlight');
        void target.offsetWidth;
        target.classList.add('is-highlight');
      }
    } else if (changed && !initial) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    if (changed && !initial) {
      const h1 = $('h1', view);
      if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    }
  }

  function initLinks() {
    document.addEventListener('click', (e) => {
      const book = e.target.closest('[data-book]');
      if (book) { e.preventDefault(); closeMenu({ restoreFocus: false }); handleBook(book); return; }
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (href === '#main') { e.preventDefault(); $('#main').focus(); return; }
      if (!href.startsWith('#/')) {
        // Ancre interne : on défile sans quitter la vue courante
        const el = document.getElementById(href.slice(1));
        if (el) { e.preventDefault(); el.scrollIntoView({ behavior: prefersReducedMotion.matches ? 'auto' : 'smooth' }); }
        return;
      }
      if (href === location.hash) { e.preventDefault(); route(); }
    });
    if (!STATIC) window.addEventListener('hashchange', () => route());
  }

  /* =========================================================================
     16. EN-TÊTE & PARALLAXE — pilotés par la position de défilement
     ========================================================================= */

  function initScrollEffects() {
    const header = $('[data-header]');
    const parallax = $$('[data-parallax]');
    let ticking = false;
    const update = () => {
      ticking = false;
      const y = window.scrollY;
      header.classList.toggle('is-scrolled', y > 24);
      if (prefersReducedMotion.matches) return;
      const vh = Math.max(1, window.innerHeight); // 0 dans un onglet masqué : plage invalide pour interpolate()
      parallax.forEach((el) => {
        if (!el.offsetParent) return;
        const factor = Number(el.dataset.parallax);
        el.style.transform = `translate3d(0, ${interpolate(y, [0, vh], [0, vh * factor], CLAMP)}px, 0)`;
      });
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  /* =========================================================================
     17. DÉMARRAGE
     ========================================================================= */

  /** Un module en panne ne doit pas empêcher les autres de démarrer. */
  const safe = (name, fn) => {
    try { fn(); } catch (err) { console.error(`[remotion-vanilla] ${name}`, err); }
  };

  function init() {
    if (/[?&#]audit\b/.test(location.href)) document.documentElement.classList.add('audit');
    if (prefersReducedMotion.matches) document.documentElement.classList.add('no-motion');
    safe('menu', initMenu);
    safe('bandeau', initStrip);
    safe('réservation', initDialog);
    safe('chat', initChat);
    safe('liens', initLinks);
    safe('mesure d’audience', initNoStats);
    safe('défilement', initScrollEffects);
    safe('service worker', registerServiceWorker);
    safe('routeur', () => route({ initial: true }));
    document.documentElement.classList.add('routed');
    window.RemotionVanilla.ready = true;
  }

  // API publique : le moteur reste réutilisable par d'autres scripts du site
  window.RemotionVanilla = { interpolate, spring, measureSpring, Easing, Clock, buildBookingUrl, BOOKING_ENGINE, ready: false };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
