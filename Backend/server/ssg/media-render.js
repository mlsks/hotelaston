/**
 * Rendu des médias de la médiathèque : images WebP en tailles adaptées (<picture> avec
 * recadrage portrait pour les téléphones), vidéos avec image d'attente, sons, liens externes.
 */
const url = (variant) => `/media/${variant.path}`;
const widthVariants = (variants) => variants.filter((v) => /^w\d+$/.test(v.purpose) && v.format === 'webp').sort((a, b) => a.width - b.width);

/** Texte d'attribut / HTML échappé. */
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const focalStyle = (media) => (media.focal_x === 0.5 && media.focal_y === 0.5 ? '' : ` style="object-position: ${Math.round(media.focal_x * 100)}% ${Math.round(media.focal_y * 100)}%"`);

/** <picture> complet pour une image (variantes WebP + recadrage portrait pour les écrans verticaux, sauf si portrait: false). */
export function pictureHtml(info, { sizes = '100vw', className = '', loading = 'lazy', fetchpriority = '', portrait: withPortrait = true } = {}) {
  const { media, variants, alt } = info;
  const ws = widthVariants(variants);
  if (!ws.length) return '';
  const portrait = withPortrait && variants.find((v) => v.purpose === 'portrait');
  const fallback = ws.find((v) => v.width >= 1024) || ws[ws.length - 1];
  const srcset = ws.map((v) => `${url(v)} ${v.width}w`).join(', ');
  const ratio = media.height && media.width ? media.height / media.width : fallback.height / fallback.width;
  const attrs = [
    className && `class="${esc(className)}"`,
    `src="${url(fallback)}"`,
    `srcset="${srcset}"`,
    `sizes="${esc(sizes)}"`,
    `width="${fallback.width}"`,
    `height="${Math.round(fallback.width * ratio)}"`,
    `alt="${esc(alt)}"`,
    loading && `loading="${loading}"`,
    fetchpriority && `fetchpriority="${fetchpriority}"`,
    'decoding="async"',
  ].filter(Boolean).join(' ');
  return `<picture>${portrait ? `<source media="(max-aspect-ratio: 4/5)" srcset="${url(portrait)}" type="image/webp">` : ''}<img ${attrs}${focalStyle(media)}></picture>`;
}

export function videoHtml(info, { className = '', lazy = true } = {}) {
  const file = info.variants.find((v) => v.purpose === 'original');
  if (!file) return '';
  const poster = info.variants.find((v) => v.purpose === 'poster');
  const src = lazy ? `data-src="${url(file)}"` : `src="${url(file)}"`;
  return `<video${className ? ` class="${esc(className)}"` : ''} muted loop playsinline preload="none"${poster ? ` poster="${url(poster)}"` : ''} ${src} aria-label="${esc(info.alt)}"></video>`;
}

export function audioHtml(info) {
  const file = info.variants.find((v) => v.purpose === 'original');
  return file ? `<audio controls preload="none" src="${url(file)}" aria-label="${esc(info.alt)}"></audio>` : '';
}

/** Lien externe : chargé seulement sur action du visiteur (aucun cookie tiers avant). */
export function embedHtml(info) {
  const { media, title, alt } = info;
  return `<a class="cms-embed" href="${esc(media.embed_url)}" target="_blank" rel="noopener" data-embed="${esc(media.embed_provider || 'other')}">${esc(title || alt || media.embed_url)}</a>`;
}

export function mediaHtml(info, opts) {
  if (!info) return '';
  switch (info.media.kind) {
    case 'image': return pictureHtml(info, opts);
    case 'video': return videoHtml(info, opts);
    case 'audio': return audioHtml(info);
    case 'embed': return embedHtml(info);
    default: return '';
  }
}

/**
 * Remplace un <img data-cms-media="clé"> par l'image de la médiathèque choisie pour cette clé.
 * Le gabarit garde ses classes et son chargement (loading, fetchpriority). Le texte alternatif
 * écrit dans le gabarit (souvent traduit par data-cms-attr) l'emporte sur celui de la médiathèque ;
 * data-cms-decorative force un alt vide, data-cms-portrait="off" retire le recadrage pour téléphone,
 * data-cms-media-optional rend la photo facultative (voir data-cms-media-fallback ci-dessous).
 */
export function injectMedia($, source, lang, onMissing) {
  $('[data-cms-media]').each((i, el) => {
    const key = el.attribs['data-cms-media'];
    const entry = source.entries.get(key);
    const rows = entry ? source.values.get(entry.id) || {} : {};
    const own = source.usable(rows[lang], lang) ? rows[lang] : null;
    const row = own?.media_id ? own : rows[source.defaultLang];
    const info = source.mediaFor(row?.media_id, lang);
    // Photo facultative (data-cms-media-optional) : sans image choisie, elle s'efface et son remplaçant
    // voisin (data-cms-media-fallback, un pictogramme) reste ; avec une image, c'est le remplaçant qui part.
    const optional = 'data-cms-media-optional' in el.attribs;
    const fallback = $(el).siblings('[data-cms-media-fallback]');
    if (!info) {
      if (!optional) return void onMissing(key);
      fallback.removeAttr('data-cms-media-fallback');
      return void $(el).remove();
    }
    fallback.remove();
    const alt = 'data-cms-decorative' in el.attribs ? '' : el.attribs.alt || info.alt;
    const html = mediaHtml({ ...info, alt }, {
      sizes: el.attribs['data-cms-sizes'] || el.attribs.sizes || '100vw',
      portrait: el.attribs['data-cms-portrait'] !== 'off',
      className: el.attribs.class || '',
      loading: el.attribs.loading || (info.media.kind === 'image' ? 'lazy' : ''),
      fetchpriority: el.attribs.fetchpriority || '',
    });
    const host = el.parent?.name === 'picture' ? $(el.parent) : $(el);
    host.replaceWith(html);
  });
}
