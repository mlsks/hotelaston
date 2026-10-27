/**
 * Appels à l'API du back-office : jeton CSRF sur chaque écriture, erreurs lisibles,
 * session expirée signalée à l'application (retour à l'écran de connexion).
 */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const session = { csrf: null };

export async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (method !== 'GET') opts.headers['x-csrf-token'] = session.csrf || '';
  let res;
  try {
    res = await fetch(`/api${url}`, opts);
  } catch {
    throw new ApiError(0, 'Serveur injoignable : vérifiez la connexion.');
  }
  if (res.status === 401 && !url.startsWith('/auth/')) {
    window.dispatchEvent(new CustomEvent('admin:expired'));
    throw new ApiError(401, 'Session expirée : reconnectez-vous.');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || `Erreur ${res.status}`);
  return data;
}

export const get = (url) => api('GET', url);
export const post = (url, body) => api('POST', url, body);
export const put = (url, body) => api('PUT', url, body);
export const patch = (url, body) => api('PATCH', url, body);
export const del = (url) => api('DELETE', url);

/** Envoi d'un fichier avec suivi de progression (fetch ne le permet pas). */
export function upload(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${url}`);
    xhr.setRequestHeader('x-csrf-token', session.csrf || '');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* réponse vide */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error || `Erreur ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Envoi interrompu.'));
    xhr.send(formData);
  });
}

/** Chaîne de requête à partir d'un objet (valeurs vides ignorées). */
export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
