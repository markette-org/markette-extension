// Markette REST API client and extension settings.
// The extension authenticates with a personal API token (mkt_…): either pasted by the user or
// created at sign-in. Passwords are never stored.

export const DEFAULT_SERVER = 'https://api.markette.org';
const HOSTED = { 'https://api.markette.org': 'https://app.markette.org' };

const SETTINGS_KEYS = ['server', 'appUrl', 'token', 'tokenId', 'user', 'workspace', 'channelsByWorkspace', 'when'];

export async function getSettings() {
  const s = await chrome.storage.local.get(SETTINGS_KEYS);
  return {
    server: s.server || DEFAULT_SERVER,
    appUrl: s.appUrl || '',
    token: s.token || '',
    tokenId: s.tokenId || null,
    user: s.user || null,
    workspace: s.workspace || '',
    channelsByWorkspace: s.channelsByWorkspace || {},
    when: s.when || 'draft',
  };
}

export function saveSettings(patch) {
  return chrome.storage.local.set(patch);
}

/** The web app's URL: set explicitly, known for the hosted service, else the server itself. */
export function appUrlFor(settings) {
  return (settings.appUrl || HOSTED[settings.server] || settings.server).replace(/\/+$/, '');
}

/** Normalises what the user typed: adds https://, strips trailing slashes and a trailing /api. */
export function normalizeServer(input) {
  let v = (input || '').trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    const path = u.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return null;
  }
}

/** Host permission pattern for a server URL (needed to call it from the extension). */
export function originPattern(server) {
  const u = new URL(server);
  return `${u.protocol}//${u.host}/*`;
}

export async function hasServerPermission(server) {
  return chrome.permissions.contains({ origins: [originPattern(server)] });
}

/** Must run inside a user gesture (a click handler). */
export async function requestServerPermission(server) {
  if (await hasServerPermission(server)) return true;
  return chrome.permissions.request({ origins: [originPattern(server)] });
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** Turns a DRF error body into one readable line. */
export function errorMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data === 'string') return data.slice(0, 300);
  if (data.detail) return String(data.detail);
  const parts = [];
  for (const [key, value] of Object.entries(data)) {
    const text = Array.isArray(value) ? value.join(' ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
    parts.push(key === 'non_field_errors' || key === 'general' ? text : `${key}: ${text}`);
  }
  return parts.join(' · ') || fallback;
}

export class Markette {
  constructor({ server, token, workspace }) {
    this.server = server.replace(/\/+$/, '');
    this.token = token;
    this.workspace = workspace;
  }

  async request(method, path, { body, form, auth, workspace = this.workspace, query } = {}) {
    const url = new URL(`${this.server}/api/${path}`);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const headers = { Accept: 'application/json' };
    const token = auth ?? this.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (workspace) headers['X-Workspace'] = workspace;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, { method, headers, body: payload, credentials: 'omit' });
    } catch {
      throw new ApiError(`Cannot reach ${this.server}. Check the server address and your connection.`, 0, null);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const fallback = res.status === 401 ? 'Your sign-in has expired or the token was revoked. Sign in again.' : `Request failed (${res.status}).`;
      throw new ApiError(res.status === 401 ? fallback : errorMessage(data, fallback), res.status, data);
    }
    return data;
  }

  get(path, opts) {
    return this.request('GET', path, opts);
  }
  post(path, body, opts = {}) {
    return this.request('POST', path, { ...opts, body });
  }

  async list(path, opts = {}) {
    const data = await this.get(path, { ...opts, query: { limit: 500, ...(opts.query || {}) } });
    return Array.isArray(data) ? data : data?.results || [];
  }

  publicInfo() {
    return this.get('platform/public/', { auth: '', workspace: '' });
  }
  me() {
    return this.get('auth/me/', { workspace: '' });
  }
  workspaces() {
    return this.list('workspaces/', { workspace: '' });
  }
  providers() {
    return this.list('providers/');
  }
  channels() {
    return this.list('channels/');
  }

  /** Email + password → short-lived JWT → a personal API token for the extension. */
  async createExtensionToken(email, password) {
    const jwt = await this.request('POST', 'auth/token/', { body: { email, password }, auth: '', workspace: '' });
    const created = await this.request('POST', 'auth/tokens/', {
      body: { name: `Chrome extension (${new Date().toISOString().slice(0, 10)})`, expires_in_days: 365 },
      auth: jwt.access,
      workspace: '',
    });
    return created;
  }

  revokeToken(id) {
    return this.request('DELETE', `auth/tokens/${id}/`, { workspace: '' });
  }

  upload(blob, name, altText = '') {
    const form = new FormData();
    form.append('file', blob, name);
    if (altText) form.append('alt_text', altText);
    return this.request('POST', 'media/', { form });
  }

  createPost(data) {
    return this.post('posts/', data);
  }

  updatePost(id, data) {
    return this.request('PATCH', `posts/${id}/`, { body: data });
  }

  schedule(id, payload) {
    return this.post(`posts/${id}/schedule/`, payload);
  }
}

export async function client() {
  const s = await getSettings();
  return new Markette(s);
}
