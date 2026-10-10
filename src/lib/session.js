import { Markette, normalizeServer, requestServerPermission, saveSettings, getSettings, ApiError } from './api.js';

/**
 * Signs in with email + password (creates an API token for this browser) or with a pasted token.
 * Must be called from a click handler: it may ask for permission to reach the server.
 */
export async function signIn({ server: rawServer, email, password, token }) {
  const server = normalizeServer(rawServer);
  if (!server) throw new ApiError('Enter the address of your Markette server, e.g. https://api.markette.org', 0, null);
  if (!(await requestServerPermission(server))) {
    throw new ApiError('The extension needs permission to reach your server to sign in.', 0, null);
  }
  const api = new Markette({ server, token: '', workspace: '' });
  try {
    await api.publicInfo();
  } catch (err) {
    if (err.status === 0) throw err;
    throw new ApiError(`${server} does not look like a Markette server.`, err.status, null);
  }
  let tokenValue = (token || '').trim();
  let tokenId = null;
  if (!tokenValue) {
    if (!email || !password) throw new ApiError('Enter your email and password.', 0, null);
    try {
      const created = await api.createExtensionToken(email.trim(), password);
      tokenValue = created.token;
      tokenId = created.id;
    } catch (err) {
      if (err.status === 401 || err.status === 400) throw new ApiError('Wrong email or password.', err.status, err.data);
      throw err;
    }
  } else if (!tokenValue.startsWith('mkt_')) {
    throw new ApiError('API tokens start with mkt_. Create one in Markette → Settings → API & MCP.', 0, null);
  }
  api.token = tokenValue;
  const user = await api.me();
  const prev = await getSettings();
  await saveSettings({
    server,
    token: tokenValue,
    tokenId,
    user: { email: user.email, name: user.name || '' },
    workspace: prev.server === server ? prev.workspace : '',
  });
  return user;
}

/** Signs out; revokes the token if the extension created it. */
export async function signOut() {
  const s = await getSettings();
  if (s.token && s.tokenId) {
    try {
      await new Markette(s).revokeToken(s.tokenId);
    } catch {
      // Already revoked or server unreachable: forget it locally anyway.
    }
  }
  await chrome.storage.local.remove(['token', 'tokenId', 'user', 'workspace']);
}
