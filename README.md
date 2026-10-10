# Markette for Chrome

Share what you're reading to your social channels with [Markette](https://markette.org): the page, a
selection, a link or an image. Save a draft, schedule it at the best time or in the next queue slot,
pick an exact time, publish right away, or continue in the full Markette composer.

Works with the hosted service (`https://api.markette.org`) and with any self-hosted Markette server.

## Features

- **Toolbar button** (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>): the composer opens with the page
  title as text and the page address as link. If you selected text, it is quoted instead.
- **Right-click menus**: *Share this page / selection / link / image with Markette*. The images are
  downloaded and attached to the post.
- **Screenshot** of the visible part of the page, attached as an image.
- **Channels and workspaces**: pick the workspace and the channels. The extension remembers your last
  choice for each workspace.
- **Character counters** for each network, counting the same way the network does (X weights links
  and emoji, Bluesky counts graphemes…). A title field appears when a selected channel needs one.
- **When**: draft, best time, next queue slot, an exact time, or now. The server checks every post
  before it is scheduled: problems are shown for each channel, and the post stays a draft so you can
  fix it and try again.
- **Edit in Markette** opens the full composer with the text, the link, the images and the channels
  already filled in.
- Approval workflows are honoured: posts that need a review are sent for approval.
- Unfinished text is kept while you switch tabs (until the browser closes).

## Install

### From a release

1. Download `markette-extension-<version>.zip` from
   [Releases](https://github.com/markette-org/markette-extension/releases) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, and click **Load unpacked**. Choose the
   unzipped folder.

### From source

```bash
git clone https://github.com/markette-org/markette-extension.git
```

Then use **Load unpacked** on the `src/` folder. There is no build step: plain JavaScript modules,
Manifest V3. Edge, Brave, Vivaldi and other Chromium browsers work the same way.

## Sign in

Click the toolbar button and enter:

- **Server**: `https://api.markette.org` for the hosted service, or the address of your own server
  (the one you open Markette at).
- **Email and password**. The extension creates a personal API token named "Chrome extension (date)",
  valid for one year, and keeps only that token. Your password is never stored. Signing out revokes
  the token.
- **Or an API token** (needed for single sign-on accounts). Create one in Markette → Settings →
  API & MCP.

For a self-hosted server, Chrome asks once for permission to reach that address.

If the web app is not at the same address as the server (as with the hosted service, where the app
is on `app.markette.org`), set **Web app address** in the extension's options. The hosted service
does not need it.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Read the address, title and selection of the tab you share, and take its screenshot. It applies only when you click the button, menu entry or shortcut. |
| `scripting` | Read the selected text, and download an image from inside the page when the image server doesn't allow downloads from elsewhere. |
| `contextMenus` | The right-click entries. |
| `storage` | The server address, the API token, the last workspace and channels, and unfinished drafts. |
| `api.markette.org` + optional hosts | Calling the Markette API. Other servers are requested only when you sign in to them. |

The extension sends data only to the Markette server you sign in to.

## Development

```bash
node scripts/check.mjs   # manifest and syntax checks (CI runs these)
./scripts/pack.sh        # dist/markette-extension-<version>.zip
```

To release, bump `version` in `src/manifest.json` and push a `v<version>` tag. The
[Release workflow](.github/workflows/release.yml) attaches the zip to a GitHub release. When the
`CWS_*` secrets are set, it also uploads the zip to the Chrome Web Store and publishes it.

The extension uses the public REST API (`/api/workspaces/`, `/api/channels/`, `/api/providers/`,
`/api/media/`, `/api/posts/`, `/api/posts/<id>/schedule/`). "Edit in Markette" opens
`/compose?ws=&title=&text=&link=&media=&channels=` in the web app.

## License

[GNU AGPL v3](LICENSE). Part of [Markette](https://github.com/markette-org).
