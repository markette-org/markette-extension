import { appUrlFor, getSettings, normalizeServer, saveSettings } from './lib/api.js';
import { signIn, signOut } from './lib/session.js';

const $ = (id) => document.getElementById(id);

async function render() {
  const s = await getSettings();
  const signedIn = !!s.token;
  $('signed-in').hidden = !signedIn;
  $('signin-form').hidden = signedIn;
  $('server').value = s.server;
  $('app-url').value = s.appUrl;
  if (signedIn) {
    $('who-server').textContent = s.server;
    $('who').textContent = s.user ? (s.user.name ? `${s.user.name} (${s.user.email})` : s.user.email) : 'API token';
    $('open-app').href = appUrlFor(s);
    $('token-note').textContent = s.tokenId
      ? 'Signing out revokes the API token this extension created.'
      : 'Signed in with a token you pasted: signing out forgets it here; revoke it in Markette if you no longer need it.';
  }
}

$('toggle-token').addEventListener('click', () => {
  const useToken = $('token-fields').hidden;
  $('token-fields').hidden = !useToken;
  $('password-fields').hidden = useToken;
  $('toggle-token').textContent = useToken ? 'Use email and password instead' : 'Use an API token instead';
});

$('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('signin-error').hidden = true;
  $('signin-btn').disabled = true;
  try {
    const useToken = !$('token-fields').hidden;
    await signIn({
      server: $('server').value,
      email: useToken ? '' : $('email').value,
      password: useToken ? '' : $('password').value,
      token: useToken ? $('token').value : '',
    });
    $('password').value = '';
    $('token').value = '';
    await render();
  } catch (err) {
    $('signin-error').textContent = err.message;
    $('signin-error').hidden = false;
  } finally {
    $('signin-btn').disabled = false;
  }
});

$('signout').addEventListener('click', async () => {
  $('signout').disabled = true;
  await signOut();
  $('signout').disabled = false;
  await render();
});

$('app-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = $('app-url').value.trim();
  const value = raw ? normalizeServer(raw) : '';
  if (raw && !value) {
    $('app-url').setCustomValidity('Enter a web address, e.g. https://app.example.org');
    $('app-url').reportValidity();
    return;
  }
  $('app-url').setCustomValidity('');
  await saveSettings({ appUrl: value });
  $('app-url').value = value;
  $('app-saved').hidden = false;
  setTimeout(() => ($('app-saved').hidden = true), 1500);
  await render();
});

render();
