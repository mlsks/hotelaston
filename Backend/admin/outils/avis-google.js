/**
 * Avis Google automatique (voir avis-google.html) :
 *   1. connexion Google (Google Identity Services, scope business.manage) ;
 *   2. compte et fiche de l'hôtel (API Account Management et Business Information) ;
 *   3. avis du plus récent au plus ancien (API v4 reviews), page par page, jusqu'au nombre voulu ;
 *   4. reviews-seed.json téléchargé (format de l'import du back-office, identifiants Google gardés :
 *      la future synchronisation par le serveur mettra à jour les mêmes avis) ;
 *   5. import dans le back-office (POST /api/google-reviews/import) ;
 *   6. résumé.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SCOPE = 'https://www.googleapis.com/auth/business.manage';
  const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  const MAX_PAGES = 20;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
  };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dayFr = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  $('origin').textContent = location.origin;
  $('clientId').value = store.get('aston.gbp.clientId') || '';
  $('clientId').addEventListener('change', () => store.set('aston.gbp.clientId', $('clientId').value.trim()));

  // Identifiant OAuth du serveur (GBP_CLIENT_ID), s'il est réglé et que la personne est connectée au back-office
  fetch('/api/google-reviews').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (d?.clientId && !$('clientId').value) $('clientId').value = d.clientId;
    if (!$('clientId').value) $('setup').open = true;
  }).catch(() => {});

  // Google Identity Services, chargé d'avance : la fenêtre de connexion doit s'ouvrir dans le clic sur Start
  const gis = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error('Le service de connexion Google ne se charge pas (connexion Internet ?).'));
    document.head.append(s);
  });
  gis.catch(() => {});

  /* ---------- Avancement ---------- */
  function step(text) {
    const li = document.createElement('li');
    li.className = 'run';
    li.innerHTML = '<span class="i">…</span><span><span class="t"></span> <small></small></span>';
    li.querySelector('.t').textContent = text;
    $('steps').append(li);
    const set = (cls, icon, detail) => {
      li.className = cls;
      li.querySelector('.i').textContent = icon;
      if (detail !== undefined) li.querySelector('small').textContent = detail;
    };
    return { info: (d) => set('run', '…', d), ok: (d) => set('ok', '✓', d), warn: (d) => set('warn', '!', d), fail: (d) => set('err', '✗', d) };
  }

  /* ---------- Google ---------- */
  function signIn(clientId) {
    return gis.then((google) => new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: (res) => (res.error ? reject(new Error(`Connexion Google refusée (${res.error_description || res.error}).`)) : resolve(res.access_token)),
        error_callback: (err) => reject(new Error(err.type === 'popup_closed' ? 'Fenêtre de connexion Google fermée.' : `Connexion Google impossible (${err.message || err.type}).`)),
      });
      client.requestAccessToken();
    }));
  }

  function googleApi(token) {
    return async (url) => {
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error?.message || `erreur ${res.status}`;
        if (res.status === 403 && /has not been used|disabled|not enabled/i.test(msg)) throw new Error(`API non activée dans le projet Google Cloud : ${msg}`);
        if (res.status === 403 || res.status === 429) throw new Error(`Accès refusé par Google : ${msg} (l’accès à l’API Google Business Profile doit être accordé par Google, et le quota ne doit pas être à 0).`);
        throw new Error(`Google : ${msg}`);
      }
      return data;
    };
  }

  /* ---------- Déroulé ---------- */
  let seed = null;

  function download() {
    const blob = new Blob([JSON.stringify(seed, null, 2) + '\n'], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'reviews-seed.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function importIntoBackOffice() {
    const me = await fetch('/api/auth/me');
    if (me.status === 401) throw new Error('vous n’êtes pas connecté au back-office : connectez-vous, puis importez le fichier dans Avis Google → Importer un JSON.');
    const { csrf } = await me.json();
    const res = await fetch('/api/google-reviews/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ data: seed }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `erreur ${res.status}`);
    return data;
  }

  async function run() {
    const clientId = $('clientId').value.trim();
    const target = Math.max(1, Math.min(50, Number($('target').value) || 8));
    const min = Number($('minRating').value);
    const facts = [];
    const fact = (k, v) => facts.push([k, v]);
    let outcome = 'ok';

    $('steps').replaceChildren();
    $('progress').hidden = false;
    $('summary').hidden = true;
    $('start').disabled = true;

    try {
      // 1. Connexion
      const s1 = step('Connexion à Google');
      if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
        $('setup').open = true;
        throw Object.assign(new Error('Renseignez d’abord l’identifiant client OAuth (Réglage Google).'), { step: s1 });
      }
      s1.info('choisissez le compte qui gère la fiche de l’hôtel');
      let api;
      try {
        api = googleApi(await signIn(clientId));
      } catch (err) { err.step = s1; throw err; }
      s1.ok('');

      // 2. Compte et fiche
      const s2 = step('Recherche de la fiche de l’hôtel');
      let account;
      let location;
      try {
        const { accounts = [] } = await api('https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
        if (!accounts.length) throw new Error('aucun compte Google Business Profile pour ce compte Google.');
        const found = [];
        for (const acc of accounts) {
          const { locations = [] } = await api(`https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?readMask=name,title&pageSize=100`);
          for (const loc of locations) found.push({ acc, loc });
        }
        const pickLoc = found.find((f) => /aston/i.test(f.loc.title || '')) || found[0];
        if (!pickLoc) throw new Error('ce compte ne gère aucune fiche. Demandez à l’hôtel de vous ajouter comme gestionnaire.');
        ({ acc: account, loc: location } = pickLoc);
      } catch (err) { err.step = s2; throw err; }
      s2.ok(location.title || location.name);
      fact('Fiche', location.title || location.name);

      // 3. Avis
      const s3 = step('Lecture des avis, du plus récent au plus ancien');
      const accountId = account.name.split('/').pop();
      const locationId = location.name.split('/').pop();
      const kept = [];
      let read = 0;
      let below = 0;
      let average = null;
      let total = null;
      let pageToken = '';
      try {
        for (let page = 0; page < MAX_PAGES && kept.length < target; page += 1) {
          const qs = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc', ...(pageToken ? { pageToken } : {}) });
          const data = await api(`https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews?${qs}`);
          average ??= data.averageRating ?? null;
          total ??= data.totalReviewCount ?? null;
          for (const r of data.reviews || []) {
            read += 1;
            const rating = STARS[r.starRating];
            if (!(rating >= min)) { below += 1; continue; }
            if (kept.length < target) kept.push(r);
          }
          s3.info(`${read} lus, ${kept.length}/${target} gardés`);
          pageToken = data.nextPageToken;
          if (!pageToken) break;
        }
      } catch (err) { err.step = s3; throw err; }
      if (kept.length < target) { s3.warn(`${read} lus : seulement ${kept.length} notés ${min} étoiles ou plus`); outcome = 'partial'; }
      else s3.ok(`${read} lus, ${below} notés moins de ${min} étoiles écartés`);

      // 4. Fichier
      const s4 = step('Préparation de reviews-seed.json');
      seed = {
        _source: `Google Business Profile, ${location.title || location.name}, extrait le ${ymd(new Date())} (${kept.length} avis notés ${min} étoiles ou plus)`,
        ...(average != null ? { averageRating: Math.round(average * 10) / 10 } : {}),
        ...(total != null ? { totalReviewCount: total } : {}),
        reviews: kept.map((r) => ({
          review_id: r.reviewId,
          author_name: r.reviewer?.isAnonymous ? 'Un client Google' : (r.reviewer?.displayName || ''),
          author_photo_url: r.reviewer?.profilePhotoUrl || null,
          rating: STARS[r.starRating],
          comment: r.comment || '',
          published_at: r.createTime,
          review_url: null,
          is_visible: true,
          reply_comment: r.reviewReply?.comment || null,
          reply_at: r.reviewReply?.updateTime || null,
        })),
      };
      if (!kept.length) { s4.warn('aucun avis à enregistrer'); outcome = 'partial'; }
      else { download(); s4.ok('fichier téléchargé'); }

      // 5. Import
      if (kept.length && $('autoImport').checked) {
        const s5 = step('Import dans le back-office');
        try {
          const res = await importIntoBackOffice();
          s5.ok(`${res.added} ajoutés, ${res.updated} mis à jour${res.unchanged ? `, ${res.unchanged} déjà à jour` : ''}`);
          fact('Back-office', `${res.added} avis ajoutés, ${res.updated} mis à jour${res.unchanged ? `, ${res.unchanged} déjà à jour` : ''}${res.place ? ', note globale et nombre d’avis enregistrés' : ''}`);
        } catch (err) {
          s5.warn(err.message);
          fact('Back-office', 'pas importé : importez reviews-seed.json dans Avis Google → Importer un JSON');
          outcome = 'partial';
        }
      }

      fact('Note globale de la fiche', average != null ? `${String(Math.round(average * 10) / 10).replace('.', ',')} / 5` : 'non fournie');
      fact('Avis sur la fiche', total != null ? total.toLocaleString('fr-FR') : 'non fourni');
      fact('Avis lus', `${read} (${below} notés moins de ${min} étoiles écartés)`);
      fact('Avis gardés', `${kept.length} sur ${target} demandés`);
      if (kept.length) {
        fact('Période', `du ${dayFr(kept[kept.length - 1].createTime)} au ${dayFr(kept[0].createTime)}`);
        fact('Avec une réponse de l’hôtel', String(kept.filter((r) => r.reviewReply?.comment).length));
        fact('Fichier', 'reviews-seed.json téléchargé');
      }
      showSummary(outcome, facts, kept);
    } catch (err) {
      (err.step || step('Erreur')).fail(err.message);
      fact('Arrêt', err.message);
      showSummary('failed', facts, []);
    } finally {
      $('start').disabled = false;
    }
  }

  function showSummary(outcome, facts, kept) {
    const titles = {
      ok: 'Terminé',
      partial: 'Terminé en partie',
      failed: 'Arrêté',
    };
    $('summary').className = `card summary ${outcome === 'ok' ? '' : outcome}`;
    $('summaryTitle').textContent = titles[outcome];
    $('facts').replaceChildren(...facts.flatMap(([k, v]) => [Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v })]));
    if (outcome !== 'failed' && kept.length) {
      $('facts').append(Object.assign(document.createElement('dt'), { textContent: 'Reste à faire' }),
        Object.assign(document.createElement('dd'), { textContent: 'Publier le site pour mettre les avis en ligne (et supprimer les exemples s’il en reste).' }));
    }
    $('cards').replaceChildren(...kept.map((r) => {
      const card = document.createElement('article');
      card.className = 'rev';
      const name = r.reviewer?.isAnonymous ? 'Un client Google' : (r.reviewer?.displayName || '?');
      const pic = r.reviewer?.profilePhotoUrl
        ? Object.assign(document.createElement('img'), { src: r.reviewer.profilePhotoUrl, alt: '', referrerPolicy: 'no-referrer' })
        : Object.assign(document.createElement('span'), { className: 'ini', textContent: name.charAt(0).toUpperCase() });
      const head = document.createElement('div');
      const n = STARS[r.starRating];
      head.append(Object.assign(document.createElement('strong'), { textContent: name }), ' ',
        Object.assign(document.createElement('span'), { className: 'stars', textContent: '★'.repeat(n) + '☆'.repeat(5 - n) }), ' ',
        Object.assign(document.createElement('span'), { className: 'hint', textContent: dayFr(r.createTime) }));
      card.append(pic, head, Object.assign(document.createElement('p'), { textContent: r.comment || '(note sans texte)' }));
      return card;
    }));
    $('json').textContent = seed ? JSON.stringify(seed, null, 2) : '';
    $('download').hidden = $('copy').hidden = !(seed && kept.length);
    $('summary').hidden = false;
    $('summary').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('start').addEventListener('click', run);
  $('download').addEventListener('click', download);
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(seed, null, 2)); $('copyStatus').textContent = 'Copié.'; } catch { $('copyStatus').textContent = 'Copie impossible.'; }
  });
})();
