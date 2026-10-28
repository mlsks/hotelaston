/**
 * Dégradé du bandeau photo d'une page (module CSS hero-veil, section 6 de styles.css).
 *
 * Dans un gabarit : data-cms-hero sur le bandeau ; data-cms-hero="veil" pose le dégradé par défaut,
 * data-cms-hero="" le laisse au voile propre du bandeau (accueil). Une page sans data-cms-hero
 * (Moon Bar) n'a pas de réglage. Le réglage de la page (cms_pages.hero_veil) l'emporte sur le gabarit.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { config } from '../config.js';

export const VEIL_DEFAULT = { opacity: 0.5, width: 70 };

/** Réglage par défaut du gabarit d'une page, ou null s'il n'a pas de bandeau réglable. */
export function heroDefault(templateHtml) {
  const $ = cheerio.load(templateHtml || '', null, false);
  const el = $('[data-cms-hero]').first();
  return el.length ? { on: el.attr('data-cms-hero') === 'veil', ...VEIL_DEFAULT } : null;
}

/** Bandeau réglable d'une page (gabarit lu sur le disque) : { default } ou null. */
export function pageHero(page) {
  const file = path.join(config.templatesDir, page.template);
  const def = fs.existsSync(file) ? heroDefault(fs.readFileSync(file, 'utf8')) : null;
  return def ? { default: def } : null;
}

/** Réglage effectif : celui de la page, sinon celui du gabarit. */
export function veilOf(page, el) {
  let saved = null;
  try { saved = page?.hero_veil ? JSON.parse(page.hero_veil) : null; } catch { /* réglage illisible : gabarit */ }
  const def = { on: el.attr('data-cms-hero') === 'veil', ...VEIL_DEFAULT };
  return saved ? { ...def, ...saved } : def;
}

/** Pose le dégradé sur le bandeau de la page, avec son opacité et son étendue. */
export function applyHeroVeil($, root, page) {
  $(root).find('[data-cms-hero]').each((i, node) => {
    const el = $(node);
    const veil = veilOf(page, el);
    el.removeAttr('data-cms-hero');
    if (!veil.on) return;
    el.addClass('hero-veil');
    const vars = [];
    if (Number(veil.opacity) !== VEIL_DEFAULT.opacity) vars.push(`--veil-opacity: ${Number(veil.opacity)}`);
    if (Number(veil.width) !== VEIL_DEFAULT.width) vars.push(`--veil-width: ${Number(veil.width)}%`);
    if (vars.length) el.attr('style', [el.attr('style'), vars.join('; ')].filter(Boolean).join('; '));
  });
}
