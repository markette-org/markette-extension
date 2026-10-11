// Character counting the way each network counts (port of markette-web's text-count.ts),
// network colours and marks (port of providers.ts).

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

let segmenter;
function countGraphemes(text) {
  if (segmenter === undefined) {
    try {
      segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    } catch {
      segmenter = null;
    }
  }
  if (!segmenter) return Array.from(text).length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

function xWeight(chunk) {
  let w = 0;
  for (const ch of chunk) {
    const cp = ch.codePointAt(0) ?? 0;
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    w += light ? 1 : 2;
  }
  return w;
}

function countX(text) {
  let length = 0;
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    length += xWeight(text.slice(last, start)) + 23;
    last = start + m[0].length;
  }
  return length + xWeight(text.slice(last));
}

function countCodepoints(text) {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

export function measure(text, mode = 'chars') {
  switch (mode) {
    case 'graphemes':
      return countGraphemes(text);
    case 'x':
      return countX(text);
    case 'mastodon':
      return countCodepoints(text.replace(URL_RE, 'x'.repeat(23)));
    default:
      return countCodepoints(text);
  }
}

const META = {
  x: ['X', '#111111', '𝕏'],
  bluesky: ['Bluesky', '#1185fe', 'bsky'],
  mastodon: ['Mastodon', '#6364ff', 'M'],
  linkedin: ['LinkedIn', '#0a66c2', 'in'],
  facebook: ['Facebook', '#1877f2', 'f'],
  instagram: ['Instagram', '#e1306c', 'ig'],
  telegram: ['Telegram', '#26a5e4', 'tg'],
  whatsapp: ['WhatsApp', '#25D366', 'wa'],
  wechat: ['WeChat', '#07C160', '微'],
  qq: ['QQ', '#12B7F5', 'QQ'],
  reddit: ['Reddit', '#FF4500', 'r/'],
  threads: ['Threads', '#000000', '@'],
  youtube: ['YouTube', '#FF0000', '▶'],
  discord: ['Discord', '#5865F2', 'dc'],
  slack: ['Slack', '#4A154B', '#'],
  ghost: ['Ghost', '#15171A', 'gh'],
  brevo: ['Brevo', '#0B996E', 'br'],
  listmonk: ['Listmonk', '#0055D4', 'lm'],
  webhook: ['Webhook', '#6B7280', '↗'],
  wordpress: ['WordPress', '#21759b', 'W'],
  drupal: ['Drupal', '#0678be', 'D'],
  medium: ['Medium', '#000000', 'M'],
  devto: ['DEV', '#0A0A0A', 'DEV'],
  hugo: ['Hugo', '#ff4088', 'H'],
};

export function providerMeta(key) {
  const m = META[key];
  if (m) return { label: m[0], color: m[1], mark: m[2] };
  return { label: key ? key[0].toUpperCase() + key.slice(1) : 'Channel', color: '#7a7695', mark: (key || '?')[0].toUpperCase() };
}
