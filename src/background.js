// Context menus: share the page, a selection, a link or an image. The share is kept in session
// storage and the popup (or a small window when the popup can't open) picks it up.

const MENUS = [
  { id: 'page', title: 'Share this page with Markette', contexts: ['page'] },
  { id: 'selection', title: 'Share selection with Markette', contexts: ['selection'] },
  { id: 'link', title: 'Share link with Markette', contexts: ['link'] },
  { id: 'image', title: 'Share image with Markette', contexts: ['image'] },
];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.contextMenus.removeAll();
  for (const m of MENUS) chrome.contextMenus.create(m);
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const share = {
    source: info.menuItemId,
    tabId: tab?.id ?? null,
    title: tab?.title || '',
    url: info.pageUrl || tab?.url || '',
    text: '',
    link: '',
    image: null,
    note: '',
    at: Date.now(),
  };
  if (info.menuItemId === 'selection') share.text = info.selectionText || '';
  if (info.menuItemId === 'link') {
    share.link = info.linkUrl || '';
    share.text = info.selectionText || '';
  }
  // Open the popup first: it has to happen while the click still counts as a user gesture.
  await chrome.storage.session.set({ share });
  const opened = await openPopup();
  if (info.menuItemId === 'image' && info.srcUrl) {
    share.image = await grabImage(info.srcUrl, tab?.id);
    if (!share.image) {
      share.link = info.srcUrl.startsWith('data:') ? '' : info.srcUrl;
      share.note = 'The image could not be downloaded, so its address was added as the link.';
    }
    share.imageDone = true;
    await chrome.storage.session.set({ share });
  }
  if (!opened) {
    await chrome.windows.create({ url: chrome.runtime.getURL('popup.html?window=1'), type: 'popup', width: 440, height: 680 });
  }
});

async function openPopup() {
  try {
    await chrome.action.openPopup();
    return true;
  } catch {
    return false;
  }
}

/** Downloads an image: directly, else from inside the page (same cookies and origin). */
async function grabImage(src, tabId) {
  try {
    const res = await fetch(src, { credentials: 'omit' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.type.startsWith('image/') && blob.size <= MAX_IMAGE_BYTES) return { dataUrl: await blobToDataUrl(blob), name: fileName(src, blob.type) };
    }
  } catch {
    // Cross-origin without CORS: try from the page.
  }
  if (tabId == null) return null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [src, MAX_IMAGE_BYTES],
      func: async (url, max) => {
        const res = await fetch(url);
        const blob = await res.blob();
        if (!blob.type.startsWith('image/') || blob.size > max) return null;
        return await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => resolve(null);
          r.readAsDataURL(blob);
        });
      },
    });
    if (result?.result) return { dataUrl: result.result, name: fileName(src, result.result.slice(5, result.result.indexOf(';'))) };
  } catch {
    // Restricted page or blocked by CORS.
  }
  return null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function fileName(src, mime) {
  const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*$/, '');
  try {
    const last = new URL(src).pathname.split('/').pop() || '';
    if (/\.[a-z0-9]{2,5}$/i.test(last)) return decodeURIComponent(last).slice(-80);
  } catch {
    // data: URLs
  }
  return `image.${ext}`;
}
