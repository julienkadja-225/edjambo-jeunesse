const KEY = 'edjambo.tokens';

let tokens = null;
try { tokens = JSON.parse(localStorage.getItem(KEY)); } catch { /* ignore */ }

export const getTokens = () => tokens;
export function setTokens(t) {
  tokens = t;
  try { t ? localStorage.setItem(KEY, JSON.stringify(t)) : localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

let onLogout = () => {};
let onPasswordChange = () => {};
export const setLogoutHandler = (fn) => { onLogout = fn; };
export const setPasswordChangeHandler = (fn) => { onPasswordChange = fn; };

let refreshing = null;
function refresh() {
  if (!tokens?.refreshToken) return Promise.resolve(false);
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      const d = await r.json();
      setTokens({ accessToken: d.accessToken, refreshToken: d.refreshToken });
      return true;
    })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

export function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== '' && v != null && v !== false) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function send(path, { method = 'GET', body, form } = {}, retry = true) {
  const headers = {};
  if (tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch('/api' + path, { method, headers, body: payload });
  if (res.status === 401 && retry && tokens?.refreshToken && !path.startsWith('/auth/')) {
    if (await refresh()) return send(path, { method, body, form }, false);
    setTokens(null);
    onLogout();
  }
  return res;
}

export async function api(path, opts) {
  const res = await send(path, opts);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (data?.code === 'PASSWORD_CHANGE_REQUIRED') onPasswordChange();
    throw new ApiError(data?.error || `Erreur ${res.status}`, res.status, data?.code);
  }
  return data;
}

/** Récupère un fichier protégé (preuve de paiement) sous forme d'URL blob. */
export async function fetchBlobUrl(path) {
  const res = await send(path);
  if (!res.ok) throw new ApiError('Fichier indisponible', res.status);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}

export const get = (p, params) => api(p + qs(params));
export const post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });
export const upload = (p, form, method = 'POST') => api(p, { method, form });

/** Télécharge un fichier protégé (export CSV) avec le jeton d'authentification. */
export async function download(path, params, filename) {
  const res = await send(path + qs(params));
  if (!res.ok) {
    let msg = 'Export impossible';
    try { msg = (await res.json()).error || msg; } catch { /* */ }
    throw new ApiError(msg, res.status);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
