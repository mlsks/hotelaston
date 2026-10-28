/**
 * Bandeaux et popup injectés au build.
 *
 * Bandeaux : chaque emplacement data-cms-zone reçoit les bandeaux actifs de la page, dans la
 * limite de la zone. Leurs dates sont aussi écrites en data-start / data-end : un petit script
 * (dans le <head> du layout) les masque dès qu'ils expirent entre deux builds, et applique la
 * fermeture choisie par le visiteur, avant l'affichage.
 * Popup : un seul par page (le plus prioritaire), configuration en JSON, piloté par popup.js.
 * Sans traduction prête, bandeaux et popup s'affichent en anglais, sinon dans la langue par défaut
 * (Source.translated), avec l'attribut lang de la langue réellement affichée.
 */
import { sha } from '../lib/util.js';
import { esc, mediaHtml } from './media-render.js';
import { jsonForScript } from './jsonld.js';

const HORIZON_MS = 25 * 3600 * 1000; // jusqu'au prochain build planifié, avec une marge
const stripTags = (html) => String(html).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#${esc(id)}"></use></svg>`;
/** Texte affiché dans une langue de repli : le signaler aux lecteurs d'écran. */
const langAttr = (t, lang) => (t.lang && t.lang !== lang ? ` lang="${esc(t.lang)}"` : '');
const isActive = (item, now) => (!item.start_at || item.start_at <= now.toISOString()) && (!item.end_at || item.end_at > now.toISOString());

/**
 * Adresse d'un appel à l'action. Les cibles internes restent en « #/route » :
 * la réécriture des liens du build les transforme ensuite en adresses de la langue.
 */
export function ctaLink(source, kind, target) {
  if (kind === 'booking' && !target) return { href: '#/reserver', attrs: ' data-book' }; // réservation sans chambre ni offre imposée
  if (!kind || kind === 'none' || !target) return null;
  if (kind === 'url') return { href: target, attrs: /^https?:/.test(target) ? ' target="_blank" rel="noopener"' : '' };
  if (kind === 'page') {
    const key = target.replace(/^page:/, '');
    return { href: key === 'accueil' ? '#/' : `#/${key}`, attrs: '' };
  }
  if (kind === 'item') {
    const [collection, itemKey] = target.replace(/^item:/, '').split('/');
    const parent = source.pagesById.get(source.collections.get(collection)?.parent_page);
    return parent ? { href: `#/${parent.key}/${itemKey}`, attrs: '' } : null;
  }
  if (kind === 'booking') {
    const [type, value] = target.split(':');
    const data = type === 'room' ? ` data-room-type="${esc(value)}"` : type === 'offer' ? ` data-offer-id="${esc(value)}"` : '';
    return { href: '#/reserver', attrs: ` data-book${data}` };
  }
  return null;
}

function bannerHtml(b, zone, { source, lang, now, uiText, preview }) {
  const t = b.i18n;
  const strip = zone === 'top-bar';
  const version = sha(String(b.updated_at), 8);
  const colors = b.bg_color || b.text_color
    ? ` style="${b.bg_color ? `--banner-bg: ${esc(b.bg_color)};` : ''}${b.text_color ? ` --banner-fg: ${esc(b.text_color)};` : ''}"`
    : '';
  const dates = `${b.start_at ? ` data-start="${esc(b.start_at)}"` : ''}${b.end_at ? ` data-end="${esc(b.end_at)}"` : ''}`;
  // Bandeau du haut : caché par défaut, révélé par le script (sans JavaScript, la page reste lisible)
  const hidden = strip || !isActive(b, now) ? ' hidden' : '';
  const cta = ctaLink(source, b.cta_kind, t.cta_url || b.cta_target);
  const ctaHtml = cta && t.cta_label
    ? `<a${strip ? '' : ' class="btn btn--gold"'} href="${esc(cta.href)}"${cta.attrs} data-track="banner_click" data-track-source="banner:${b.id}">${esc(t.cta_label)}</a>`
    : '';
  const close = b.dismissible
    ? `<button class="${strip ? 'live-strip__close' : 'cms-banner__close'}" type="button" data-banner-close aria-label="${esc(uiText('ui.banner.close'))}">${icon('i-close')}</button>`
    : '';
  const classes = ['cms-banner', `cms-banner--${b.variant}`, strip ? 'live-strip cms-banner--strip' : `cms-banner--block cms-banner--${zone}`, colors ? 'has-colors' : ''].filter(Boolean).join(' ');
  const flag = t.missing && preview ? ' data-preview-missing' : '';
  const attrs = `class="${classes}" data-banner="${b.id}" data-banner-version="${version}"${dates} aria-label="${esc(stripTags(t.text).slice(0, 120))}" data-track-view="banner:${b.id}"${colors}${hidden}${flag}${langAttr(t, lang)}`;
  const inner = `${b.icon ? icon(b.icon) : ''}${strip ? `<p>${t.text}</p>` : `<div class="cms-banner__text">${t.text}</div>`}${ctaHtml}${close}`;
  if (strip) return `<aside ${attrs}><div class="container live-strip__inner">${inner}</div></aside>`;
  const wrapped = zone === 'hero-sub' ? `<div class="cms-banner__inner">${inner}</div>` : `<div class="container"><div class="cms-banner__inner">${inner}</div></div>`;
  return `<aside ${attrs}>${wrapped}</aside>`;
}

/** Remplit les emplacements de bandeaux ; un emplacement vide disparaît. */
export function renderZones($, ctx) {
  const { source, lang, pageId, now } = ctx;
  const horizon = new Date(now.getTime() + HORIZON_MS);
  const missing = [];
  $('[data-cms-zone]').each((i, el) => {
    const zone = el.attribs['data-cms-zone'];
    const def = source.zones.get(zone);
    const banners = def ? source.bannersFor(zone, pageId, lang, now, horizon).slice(0, def.max_banners) : [];
    if (!banners.length) {
      $(el).remove();
      return;
    }
    delete el.attribs['data-cms-zone'];
    el.attribs['data-zone'] = zone;
    $(el).append(banners.map((b) => bannerHtml(b, zone, ctx)).join(''));
    $(el).append('<script>__cmsZone(document.currentScript.parentNode)</script>');
    for (const b of banners) if (b.i18n.missing) missing.push(`banner:${b.id}`);
  });
  return missing;
}

/** Ajoute le popup de la page (fenêtre, configuration, script). */
export function renderPopup($, ctx) {
  const { source, lang, pageId, now, uiText, popupScript, preview } = ctx;
  const p = source.popupFor(pageId, lang, now, new Date(now.getTime() + HORIZON_MS));
  if (!p || !popupScript) return null;
  const t = p.i18n;
  const info = p.media_id ? source.mediaFor(p.media_id, lang) : null;
  const media = info ? `<div class="cms-popup__media">${mediaHtml(info, { sizes: '(min-width: 600px) 560px, 100vw', loading: 'lazy', portrait: false })}</div>` : '';
  const cta = ctaLink(source, t.cta_kind, t.cta_target);
  const ctaHtml = cta && t.cta_label
    ? `<a class="btn btn--gold" href="${esc(cta.href)}"${cta.attrs} data-track="popup_click" data-track-source="popup:${p.id}">${esc(t.cta_label)}</a>`
    : '';
  const version = `${p.version}-${sha(String(p.updated_at), 6)}`;
  $('body').append(`
  <dialog class="cms-popup" data-popup="${p.id}" aria-labelledby="cms-popup-title" data-track-view="popup:${p.id}"${t.missing && preview ? ' data-preview-missing' : ''}${langAttr(t, lang)}>
    <form method="dialog" class="cms-popup__close-form"><button class="cms-popup__close" value="close" aria-label="${esc(uiText('ui.popup.close'))}">${icon('i-close')}</button></form>
    ${media}
    <div class="cms-popup__body">
      <h2 id="cms-popup-title">${esc(t.title)}</h2>
      ${t.body ? `<div class="cms-popup__text">${t.body}</div>` : ''}
      ${ctaHtml}
    </div>
  </dialog>
  <script type="application/json" id="cms-popup-config">${jsonForScript({
    id: p.id, version, trigger: p.trigger_type, value: p.trigger_value, mobileTrigger: p.mobile_trigger,
    frequency: p.frequency, days: p.frequency_days, start: p.start_at, end: p.end_at,
  })}</script>
  <script src="${popupScript}" defer></script>`);
  return t.missing ? `popup:${p.id}` : null;
}
