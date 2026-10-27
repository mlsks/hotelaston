/**
 * popup.js — popup du back-office (chargé uniquement sur les pages qui en ont un).
 * Déclencheur : délai, pourcentage de défilement ou intention de sortie (ordinateur).
 * Sur mobile : jamais avant la première interaction, déclencheur de repli choisi dans l'admin.
 * Fréquence mémorisée dans le navigateur (une fois, une fois par session, tous les N jours).
 */
(() => {
  'use strict';
  const node = document.getElementById('cms-popup-config');
  const dialog = document.querySelector('dialog[data-popup]');
  if (!node || !dialog || typeof dialog.showModal !== 'function') return;
  let cfg;
  try { cfg = JSON.parse(node.textContent); } catch { return; }

  const now = Date.now();
  if ((cfg.start && Date.parse(cfg.start) > now) || (cfg.end && Date.parse(cfg.end) <= now)) return;

  const key = `aston.popup.${cfg.id}.${cfg.version}`;
  const store = cfg.frequency === 'session' ? 'sessionStorage' : 'localStorage';
  const read = () => { try { return JSON.parse(window[store].getItem(key)); } catch { return null; } };
  const write = (v) => { try { window[store].setItem(key, JSON.stringify(v)); } catch { /* stockage indisponible : une fois par page */ } };
  const seen = read();
  if (seen && (cfg.frequency !== 'days' || now - seen < (cfg.days || 7) * 864e5)) return;

  const mobile = matchMedia('(max-width: 599.98px), (pointer: coarse)').matches;
  const trigger = mobile ? cfg.mobileTrigger : cfg.trigger;
  if (!trigger || trigger === 'none') return;

  let opened = false;
  let disarm = () => {};
  const open = () => {
    if (opened) return;
    if (document.querySelector('dialog[open]')) return; // une autre fenêtre (réservation) est ouverte
    opened = true;
    disarm();
    const video = dialog.querySelector('video[data-src]');
    if (video) {
      video.src = video.dataset.src;
      video.play().catch(() => {});
    }
    dialog.showModal();
    write(cfg.frequency === 'days' ? Date.now() : true);
    dialog.dispatchEvent(new CustomEvent('cms:popup-view', { bubbles: true }));
  };
  dialog.addEventListener('close', () => dialog.querySelectorAll('video, audio').forEach((m) => m.pause()));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // clic sur le fond

  const arm = () => {
    if (trigger === 'delay') {
      const t = setTimeout(open, Math.max(0, Number(cfg.value) || 0) * 1000);
      disarm = () => clearTimeout(t);
    } else if (trigger === 'scroll') {
      const onScroll = () => {
        const max = document.documentElement.scrollHeight - innerHeight;
        if (max > 0 && (scrollY / max) * 100 >= (Number(cfg.value) || 50)) open();
      };
      addEventListener('scroll', onScroll, { passive: true });
      disarm = () => removeEventListener('scroll', onScroll);
    } else if (trigger === 'exit_intent') {
      const onOut = (e) => { if (!e.relatedTarget && e.clientY <= 0) open(); };
      document.addEventListener('mouseout', onOut);
      disarm = () => document.removeEventListener('mouseout', onOut);
    }
  };

  if (mobile) {
    // Un vrai geste du visiteur : le défilement restauré au rechargement ne compte pas
    const GESTURES = ['touchstart', 'pointerdown', 'keydown', 'wheel'];
    let armed = false;
    const first = () => {
      if (armed) return;
      armed = true;
      GESTURES.forEach((t) => removeEventListener(t, first));
      arm();
    };
    GESTURES.forEach((t) => addEventListener(t, first, { passive: true }));
  } else {
    arm();
  }
})();
