/**
 * Classement des visites : appareil, robot, canal d'arrivée (dont les assistants IA).
 */

const BOT = /bot\b|bot\/|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|python-requests|python-urllib|curl\/|wget\/|go-http|axios\/|node-fetch|java\/|httpclient|okhttp|scrapy|phantomjs|preview/i;

export const isBot = (ua) => !ua || BOT.test(ua);

export function deviceOf(ua = '') {
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Opera Mini|IEMobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** Domaine d'une adresse (sans « www. »), ou null. */
export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Ordre important : « mail.google.com » est un webmail avant d'être un domaine Google
const RULES = [
  ['ai', /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|claude\.ai|you\.com|phind\.com|poe\.com|mistral\.ai|deepseek\.com|meta\.ai)$/],
  ['email', /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|mail\.yahoo\.com|webmail\.[a-z.]+|mail\.[a-z.]+)$/],
  ['metasearch', /(^|\.)(booking\.com|expedia\.[a-z.]+|hotels\.com|trivago\.[a-z.]+|kayak\.[a-z.]+|tripadvisor\.[a-z.]+|agoda\.com|hrs\.[a-z.]+|momondo\.[a-z.]+|skyscanner\.[a-z.]+)$/],
  ['social', /(^|\.)(facebook\.com|instagram\.com|t\.co|twitter\.com|x\.com|linkedin\.com|lnkd\.in|pinterest\.[a-z.]+|tiktok\.com|youtube\.com|threads\.net|reddit\.com|snapchat\.com|whatsapp\.com)$/],
  ['organic', /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|qwant\.com|ecosia\.org|yahoo\.[a-z.]+|yandex\.[a-z.]+|baidu\.com|startpage\.com|search\.brave\.com|lilo\.org|seznam\.cz|naver\.com)$/],
];

/**
 * Canal d'une visite : campagne UTM d'abord, puis domaine du site d'origine.
 * @param referrer domaine (sans www) ou null ; utm { source, medium } ; paid = clic publicitaire (gclid…)
 */
export function channelOf({ referrer, utm = {}, paid = false }) {
  const medium = String(utm.medium || '').toLowerCase();
  const source = String(utm.source || '').toLowerCase();
  if (paid || /^(cpc|ppc|paid|paidsearch|paid_social|display|cpm)$/.test(medium)) return 'paid';
  if (/^(e-?mail|newsletter)$/.test(medium)) return 'email';
  if (/(chatgpt|openai|perplexity|gemini|copilot|claude)/.test(source)) return 'ai';
  if (/^(social|social-network|social_media)$/.test(medium)) return 'social';
  if (/(booking|expedia|trivago|tripadvisor|google_hotel|hotelads|kayak|metasearch)/.test(source)) return 'metasearch';
  if (medium === 'organic') return 'organic';
  if (!referrer) return medium || source ? 'referral' : 'direct';
  for (const [channel, re] of RULES) if (re.test(referrer)) return channel;
  return 'referral';
}
