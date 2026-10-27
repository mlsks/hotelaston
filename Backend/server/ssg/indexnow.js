/**
 * IndexNow : signale à Bing, Yandex et aux autres moteurs participants les adresses
 * ajoutées ou modifiées par une publication. Google ne participe pas : il relit le sitemap.
 */
export async function notifyIndexNow({ siteUrl, key, urls, log = console.log }) {
  if (!key || !urls.length) return;
  const { host } = new URL(siteUrl);
  if (/^(localhost|127\.|\[::1\])/.test(host)) return;
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation: `${siteUrl}/${key}.txt`, urlList: urls.slice(0, 10000) }),
      signal: AbortSignal.timeout(15000),
    });
    log(`IndexNow : ${urls.length} adresse(s) signalée(s), réponse ${res.status}.`);
  } catch (err) {
    log(`IndexNow : envoi impossible (${err.message}). Le sitemap reste à jour.`);
  }
}
