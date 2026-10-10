import { ApiError, Markette, appUrlFor, getSettings, hasServerPermission, saveSettings } from './lib/api.js';
import { signIn } from './lib/session.js';
import { measure, providerMeta } from './lib/text.js';

const $ = (id) => document.getElementById(id);
const SHARE_MAX_AGE = 5 * 60_000;
const MAX_MEDIA = 4;
const SUBMIT_LABELS = { draft: 'Save draft', best_time: 'Schedule', queue: 'Add to queue', exact: 'Schedule', now: 'Publish now' };

const state = {
  settings: null,
  api: null,
  workspaces: [],
  providers: new Map(),
  channels: [],
  selected: new Set(),
  /** {key, blob, name, url} */
  media: [],
  tab: null,
  draftKey: '',
  busy: false,
  /** Draft created by a submit whose scheduling failed: the next submit updates it. */
  postId: null,
};

if (new URLSearchParams(location.search).has('window')) document.body.classList.add('window');

function show(section) {
  for (const id of ['loading', 'signin', 'compose', 'done']) $(id).hidden = id !== section;
  $('workspace').hidden = section !== 'compose' || state.workspaces.length < 2;
}

function setError(el, message) {
  el.textContent = message || '';
  el.hidden = !message;
}

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

/* ---------- start ---------- */

async function start() {
  state.settings = await getSettings();
  state.tab = await activeTab();
  if (!state.settings.token || !(await hasServerPermission(state.settings.server))) {
    showSignIn();
    return;
  }
  state.api = new Markette(state.settings);
  try {
    await loadWorkspaces();
  } catch (err) {
    if (err.status === 401) {
      showSignIn(err.message);
      return;
    }
    show('compose');
    setError($('error'), err.message);
    return;
  }
  await prefill();
  show('compose');
  $('body').focus();
}

async function activeTab() {
  if (!new URLSearchParams(location.search).has('window')) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }
  // Opened as a window (context menu fallback): the tab that was shared, else the active tab of
  // the last focused browser window.
  const { share } = await chrome.storage.session.get('share');
  if (share?.tabId != null) {
    const tab = await chrome.tabs.get(share.tabId).catch(() => null);
    if (tab) return tab;
  }
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  const [tab] = await chrome.tabs.query(win ? { active: true, windowId: win.id } : { active: true, windowType: 'normal' });
  return tab || null;
}

/* ---------- sign in ---------- */

function showSignIn(message = '') {
  $('server').value = state.settings.server;
  setError($('signin-error'), message);
  show('signin');
  ($('email').value ? $('password') : $('email')).focus();
}

$('toggle-token').addEventListener('click', () => {
  const useToken = $('token-fields').hidden;
  $('token-fields').hidden = !useToken;
  $('password-fields').hidden = useToken;
  $('toggle-token').textContent = useToken ? 'Use email and password instead' : 'Use an API token instead (single sign-on accounts)';
});

$('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError($('signin-error'), '');
  $('signin-btn').disabled = true;
  $('signin-btn').textContent = 'Signing in…';
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
    await start();
  } catch (err) {
    setError($('signin-error'), err.message);
  } finally {
    $('signin-btn').disabled = false;
    $('signin-btn').textContent = 'Sign in';
  }
});

/* ---------- workspace and channels ---------- */

async function loadWorkspaces() {
  const all = await state.api.workspaces();
  state.workspaces = all.filter((w) => !w.is_archived && w.role && w.role !== 'viewer');
  const select = $('workspace');
  select.replaceChildren(
    ...state.workspaces.map((w) => {
      const o = document.createElement('option');
      o.value = w.slug;
      o.textContent = w.organization_name && w.organization_name !== w.name ? `${w.name} · ${w.organization_name}` : w.name;
      return o;
    }),
  );
  if (!state.workspaces.length) throw new ApiError('You have no workspace where you can write posts. Ask an admin for editor access.', 403);
  const slug = state.workspaces.some((w) => w.slug === state.settings.workspace) ? state.settings.workspace : state.workspaces[0].slug;
  select.value = slug;
  await useWorkspace(slug);
}

$('workspace').addEventListener('change', async (e) => {
  await useWorkspace(e.target.value);
  $('workspace').hidden = state.workspaces.length < 2;
});

async function useWorkspace(slug) {
  state.postId = null;
  delete $('open-app').dataset.post;
  $('open-app').textContent = 'Edit in Markette';
  state.api.workspace = slug;
  state.settings.workspace = slug;
  await saveSettings({ workspace: slug });
  const [providers, channels] = await Promise.all([state.providers.size ? null : state.api.providers(), state.api.channels()]);
  if (providers) state.providers = new Map(providers.map((p) => [p.key, p]));
  state.channels = channels
    .filter((c) => c.status !== 'disabled')
    .sort((a, b) => Number(b.relevant !== false) - Number(a.relevant !== false) || a.name.localeCompare(b.name));
  const remembered = state.settings.channelsByWorkspace[slug] || [];
  state.selected = new Set(remembered.filter((id) => state.channels.some((c) => c.id === id && c.status === 'active')));
  renderChannels();
  $('connect-link').href = `${appUrlFor(state.settings)}/channels?ws=${encodeURIComponent(slug)}`;
}

function renderChannels() {
  const box = $('channels');
  box.replaceChildren(
    ...state.channels.map((c) => {
      const meta = providerMeta(c.provider);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (c.status === 'needs_reauth' ? ' warn' : '');
      b.style.setProperty('--c', c.color || meta.color);
      b.setAttribute('aria-pressed', String(state.selected.has(c.id)));
      b.title = `${meta.label}${c.handle ? ` · ${c.handle}` : ''}${c.status === 'needs_reauth' ? ' — needs to be reconnected in Markette' : ''}`;
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = meta.mark;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = c.name || c.handle || meta.label;
      b.append(mark, name);
      b.addEventListener('click', () => {
        if (state.selected.has(c.id)) state.selected.delete(c.id);
        else state.selected.add(c.id);
        b.setAttribute('aria-pressed', String(state.selected.has(c.id)));
        rememberChannels();
        update();
      });
      return b;
    }),
  );
  $('no-channels').hidden = state.channels.length > 0;
  $('all-channels').hidden = state.channels.length < 2;
  update();
}

$('all-channels').addEventListener('click', () => {
  const active = state.channels.filter((c) => c.status === 'active');
  const all = active.every((c) => state.selected.has(c.id));
  state.selected = all ? new Set() : new Set(active.map((c) => c.id));
  rememberChannels();
  renderChannels();
});

function rememberChannels() {
  const map = { ...state.settings.channelsByWorkspace, [state.api.workspace]: [...state.selected] };
  state.settings.channelsByWorkspace = map;
  saveSettings({ channelsByWorkspace: map });
}

/* ---------- content ---------- */

async function prefill() {
  const { share } = await chrome.storage.session.get('share');
  const fresh = share && Date.now() - share.at < SHARE_MAX_AGE;
  if (fresh) await chrome.storage.session.remove('share');
  const url = fresh ? share.url : state.tab?.url || '';
  state.draftKey = `draft:${url}`;
  const saved = (await chrome.storage.session.get(state.draftKey))[state.draftKey];

  let title = state.tab?.title || '';
  let body = '';
  let link = /^https?:/.test(url) ? url : '';
  if (fresh) {
    title = share.title || title;
    body = share.text ? quote(share.text) : '';
    if (share.link) link = share.link;
    if (share.note) showNotice(share.note);
    if (share.image) addMedia(dataUrlToBlob(share.image.dataUrl), share.image.name);
    else if (share.source === 'image' && !share.imageDone) waitForImage();
  } else if (saved) {
    ({ title, body, link } = saved);
  } else {
    const selection = await readSelection();
    if (selection) body = quote(selection);
  }
  if (!body && !saved) body = title;
  $('title').value = title;
  $('body').value = body;
  $('link').value = link;
  $('when').value = state.settings.when in SUBMIT_LABELS ? state.settings.when : 'draft';
  $('at').value = defaultAt();
  update();
}

function quote(text) {
  const t = text.trim();
  return t.length > 2 && !/^["“«]/.test(t) ? `“${t}”` : t;
}

async function readSelection() {
  if (!state.tab?.id || !/^https?:|^file:/.test(state.tab.url || '')) return '';
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: state.tab.id }, func: () => String(getSelection() || '') });
    return (res?.result || '').trim().slice(0, 5000);
  } catch {
    return '';
  }
}

/** The background worker is still downloading a context-menu image: add it when it lands. */
function waitForImage() {
  const listener = (changes, area) => {
    const next = area === 'session' && changes.share?.newValue;
    if (!next?.imageDone) return;
    chrome.storage.onChanged.removeListener(listener);
    chrome.storage.session.remove('share');
    if (next.image) addMedia(dataUrlToBlob(next.image.dataUrl), next.image.name);
    else {
      if (next.link && !$('link').value) $('link').value = next.link;
      if (next.note) showNotice(next.note);
    }
  };
  chrome.storage.onChanged.addListener(listener);
}

function showNotice(text) {
  $('notice').textContent = text;
  $('notice').hidden = false;
}

function defaultAt() {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

for (const id of ['title', 'body', 'link']) $(id).addEventListener('input', () => {
  update();
  saveDraft();
});

let saveTimer;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!state.draftKey) return;
    chrome.storage.session.set({ [state.draftKey]: { title: $('title').value, body: $('body').value, link: $('link').value } });
  }, 300);
}

$('when').addEventListener('change', () => {
  saveSettings({ when: $('when').value });
  update();
});

/* ---------- media ---------- */

function addMedia(blob, name) {
  if (state.media.length >= MAX_MEDIA) {
    showNotice(`Up to ${MAX_MEDIA} images from the extension; add more in Markette.`);
    return;
  }
  state.media.push({ key: crypto.randomUUID(), blob, name, url: URL.createObjectURL(blob) });
  renderMedia();
}

function renderMedia() {
  $('media').replaceChildren(
    ...state.media.map((m) => {
      const box = document.createElement('div');
      box.className = 'thumb';
      const img = document.createElement('img');
      img.src = m.url;
      img.alt = m.name;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '✕';
      rm.title = 'Remove';
      rm.setAttribute('aria-label', `Remove ${m.name}`);
      rm.addEventListener('click', () => {
        URL.revokeObjectURL(m.url);
        state.media = state.media.filter((x) => x.key !== m.key);
        renderMedia();
      });
      box.append(img, rm);
      return box;
    }),
  );
  update();
}

$('screenshot').addEventListener('click', async () => {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(state.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT, { format: 'png' });
    addMedia(dataUrlToBlob(dataUrl), 'screenshot.png');
  } catch {
    showNotice('This page cannot be captured (browser pages and the Web Store are protected).');
  }
});

function dataUrlToBlob(dataUrl) {
  const [head, data] = dataUrl.split(',');
  const mime = head.slice(5).split(';')[0] || 'image/png';
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* ---------- counters and validation ---------- */

function selectedChannels() {
  return state.channels.filter((c) => state.selected.has(c.id));
}

function update() {
  const chans = selectedChannels();
  const body = $('body').value;
  const needsTitle = chans.some((c) => {
    const p = state.providers.get(c.provider);
    return p && (p.supports_title || p.kind === 'blog' || p.kind === 'newsletter');
  });
  $('title-wrap').hidden = !needsTitle;

  // One counter per network (channels of the same network count the same way).
  const seen = new Map();
  for (const c of chans) {
    const p = state.providers.get(c.provider);
    if (!p?.max_chars || seen.has(c.provider)) continue;
    seen.set(c.provider, { label: providerMeta(c.provider).label, count: measure(body, p.count_mode), max: p.max_chars });
  }
  $('counts').replaceChildren(
    ...[...seen.values()].map((s) => {
      const el = document.createElement('span');
      el.className = 'count' + (s.count > s.max ? ' over' : '');
      el.textContent = `${s.label} ${s.count}/${s.max}`;
      return el;
    }),
  );

  const when = $('when').value;
  $('at-wrap').hidden = when !== 'exact';
  $('submit').textContent = SUBMIT_LABELS[when] || 'Save draft';
  $('submit').disabled = state.busy;
  $('open-app').disabled = state.busy;
}

function problemsBeforeSubmit(when) {
  const hasContent = $('body').value.trim() || $('link').value.trim() || state.media.length;
  if (!hasContent) return 'Write something, add a link or an image.';
  const link = $('link').value.trim();
  if (link && !/^https?:\/\/\S+$/i.test(link)) return 'The link must start with http:// or https://';
  if (when === 'draft') return '';
  if (!state.selected.size) return 'Pick at least one channel.';
  const inactive = selectedChannels().filter((c) => c.status !== 'active');
  if (inactive.length) return `Reconnect ${inactive.map((c) => c.name).join(', ')} in Markette first.`;
  if (when === 'exact') {
    const at = new Date($('at').value);
    if (Number.isNaN(at.getTime())) return 'Pick a date and time.';
    if (at.getTime() < Date.now() - 60_000) return 'That time is in the past.';
  }
  return '';
}

/* ---------- submit ---------- */

async function uploadMedia() {
  const ids = [];
  for (const m of state.media) {
    // Uploaded once per workspace (a retry or "Edit in Markette" reuses it).
    if (m.workspace !== state.api.workspace) {
      m.assetId = (await state.api.upload(m.blob, m.name)).id;
      m.workspace = state.api.workspace;
    }
    ids.push(m.assetId);
  }
  return ids;
}

function setBusy(busy, label) {
  state.busy = busy;
  update();
  if (busy && label) $('submit').textContent = label;
}

$('submit').addEventListener('click', async () => {
  const when = $('when').value;
  const problem = problemsBeforeSubmit(when);
  setError($('error'), problem);
  if (problem) return;
  setBusy(true, state.media.length ? 'Uploading…' : 'Saving…');
  let post = null;
  try {
    const mediaIds = await uploadMedia();
    setBusy(true, 'Saving…');
    const data = {
      body: $('body').value.trim(),
      link: $('link').value.trim(),
      media_ids: mediaIds,
      targets: [...state.selected].map((channel) => ({ channel })),
    };
    if (!$('title-wrap').hidden && $('title').value.trim()) data.title = $('title').value.trim();
    post = state.postId ? await state.api.updatePost(state.postId, data) : await state.api.createPost(data);
    state.postId = post.id;
    if (when !== 'draft') {
      setBusy(true, when === 'now' ? 'Publishing…' : 'Scheduling…');
      const payload = { mode: when };
      if (when === 'exact') payload.at = new Date($('at').value).toISOString();
      post = await state.api.schedule(post.id, payload);
    }
    clearTimeout(saveTimer);
    await chrome.storage.session.remove(state.draftKey);
    state.postId = null;
    showDone(post, when);
  } catch (err) {
    setError($('error'), post ? `${scheduleProblem(err, post)}\nThe post was saved as a draft: fix it in Markette.` : err.message);
    if (post) offerOpenPost(post);
  } finally {
    setBusy(false);
  }
});

/** Maps {"targets": {"<target id>": [problems]}} to channel names. */
function scheduleProblem(err, post) {
  const problems = err instanceof ApiError && err.data?.targets;
  if (!problems || typeof problems !== 'object' || Array.isArray(problems)) return err.message;
  const names = new Map((post.targets || []).map((t) => [String(t.id), t.channel_detail?.name || `Channel ${t.channel}`]));
  return Object.entries(problems)
    .map(([id, list]) => `${names.get(id) || id}: ${[].concat(list).join(' ')}`)
    .join('\n');
}

function postUrl(post) {
  return `${appUrlFor(state.settings)}/posts/${post.id}?ws=${encodeURIComponent(state.api.workspace)}`;
}

function offerOpenPost(post) {
  $('open-app').textContent = 'Open the draft';
  $('open-app').dataset.post = postUrl(post);
}

function showDone(post, when) {
  const pending = post.approval_status === 'pending';
  const times = (post.targets || []).map((t) => t.scheduled_at).filter(Boolean).sort();
  let title = 'Draft saved';
  let text = 'Find it in Markette under Posts.';
  if (pending) {
    title = 'Sent for approval';
    text = 'A reviewer has to approve it before it goes out.';
  } else if (when === 'now') {
    title = 'Publishing';
    text = 'It goes out in a few seconds; check the result in Markette.';
  } else if (when !== 'draft') {
    title = 'Scheduled';
    text = times.length ? `Goes out ${formatTime(times[0])}${times.length > 1 && times.at(-1) !== times[0] ? ` – ${formatTime(times.at(-1))}` : ''}.` : 'Scheduled.';
  }
  $('done-title').textContent = title;
  $('done-text').textContent = text;
  $('done-link').href = postUrl(post);
  show('done');
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

$('again').addEventListener('click', () => {
  state.postId = null;
  delete $('open-app').dataset.post;
  $('open-app').textContent = 'Edit in Markette';
  for (const m of state.media) URL.revokeObjectURL(m.url);
  state.media = [];
  renderMedia();
  $('body').value = '';
  $('title').value = state.tab?.title || '';
  $('link').value = '';
  $('notice').hidden = true;
  setError($('error'), '');
  show('compose');
  $('body').focus();
});

/* ---------- continue in the web app ---------- */

$('open-app').addEventListener('click', async () => {
  if ($('open-app').dataset.post) {
    chrome.tabs.create({ url: $('open-app').dataset.post });
    window.close();
    return;
  }
  setError($('error'), '');
  setBusy(true);
  try {
    const mediaIds = await uploadMedia();
    const q = new URLSearchParams({ ws: state.api.workspace });
    const title = $('title').value.trim();
    if (title && !$('title-wrap').hidden) q.set('title', title);
    if ($('body').value.trim()) q.set('text', $('body').value.trim());
    if ($('link').value.trim()) q.set('link', $('link').value.trim());
    if (mediaIds.length) q.set('media', mediaIds.join(','));
    if (state.selected.size) q.set('channels', [...state.selected].join(','));
    clearTimeout(saveTimer);
    await chrome.storage.session.remove(state.draftKey);
    await chrome.tabs.create({ url: `${appUrlFor(state.settings)}/compose?${q}` });
    window.close();
  } catch (err) {
    setError($('error'), err.message);
  } finally {
    setBusy(false);
  }
});

start().catch((err) => {
  show('compose');
  setError($('error'), err.message || String(err));
});
