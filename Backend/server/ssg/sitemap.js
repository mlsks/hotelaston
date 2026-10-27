/**
 * sitemap.xml multilingue (alternatives hreflang, images), robots.txt et redirections Caddy.
 */
const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/**
 * @param entries [{ loc, lastmod, alternates: [{ lang, href }], xDefault, images: [url] }]
 */
export function sitemapXml(entries) {
  const urls = entries.map((e) => {
    const lines = [`  <url>`, `    <loc>${xml(e.loc)}</loc>`];
    if (e.lastmod) lines.push(`    <lastmod>${xml(e.lastmod)}</lastmod>`);
    if (e.alternates.length > 1) {
      for (const a of e.alternates) lines.push(`    <xhtml:link rel="alternate" hreflang="${xml(a.lang)}" href="${xml(a.href)}"/>`);
      if (e.xDefault) lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${xml(e.xDefault)}"/>`);
    }
    for (const img of e.images) lines.push(`    <image:image><image:loc>${xml(img)}</image:loc></image:image>`);
    lines.push('  </url>');
    return lines.join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * Robots des moteurs de réponse et des assistants IA (GEO), nommés un par un : un groupe propre à un robot
 * remplace le groupe « * » pour lui, donc chacun reprend les mêmes interdictions.
 * Recherche et citation (OAI-SearchBot, PerplexityBot, Claude-SearchBot…), lecture à la demande d'un utilisateur
 * (ChatGPT-User, Perplexity-User, Claude-User…) et entraînement des modèles (GPTBot, ClaudeBot, Google-Extended,
 * Applebot-Extended, CCBot…) : tous autorisés, pour que l'hôtel soit connu et cité. Retirer un robot de la liste
 * ne suffit pas à le bloquer : il faut lui écrire un groupe « Disallow: / ».
 */
export const AI_BOTS = [
  'OAI-SearchBot', 'ChatGPT-User', 'GPTBot',
  'PerplexityBot', 'Perplexity-User',
  'Claude-SearchBot', 'Claude-User', 'ClaudeBot',
  'Google-Extended', 'Applebot-Extended', 'Bingbot',
  'MistralAI-User', 'DuckAssistBot', 'Meta-ExternalAgent', 'Amazonbot', 'CCBot',
];

export function robotsTxt(siteUrl) {
  const rules = ['Allow: /', 'Disallow: /preview/', 'Disallow: /admin/', 'Disallow: /api/'];
  return [
    'User-agent: *', ...rules, '',
    '# Moteurs de réponse et assistants IA : bienvenus (résumé du site pour eux : /llms.txt)',
    ...AI_BOTS.map((bot) => `User-agent: ${bot}`), ...rules, '',
    `Sitemap: ${siteUrl}/sitemap.xml`, '',
  ].join('\n');
}

/** Directives importées par le Caddyfile (anciennes adresses → nouvelles, racine → langue par défaut). */
export function redirectsCaddy({ redirects, defaultLang }) {
  const lines = ['# Généré par le build : ne pas modifier à la main.', `redir / /${defaultLang}/ 302`];
  for (const r of redirects) lines.push(`redir ${r.from} ${r.to} ${r.code}`);
  return `${lines.join('\n')}\n`;
}
