# Chrome Extension 101 (for this project)

You have never built a Chrome extension before — this doc explains only what you need for **Local ATS Autofill**.

## What is a Chrome extension?

A folder of files Chrome can load. The important one is `manifest.json` — it tells Chrome:

- the name / icons
- which pages the scripts may run on (Greenhouse, Lever, Ashby)
- which local URLs it may call (Ollama on `127.0.0.1:11434`)

This project uses **Manifest V3**.

## Parts of this extension

| Piece | File(s) | What you see |
|-------|---------|--------------|
| Manifest | `extension/manifest.json` | Permissions + wiring |
| Service worker | `extension/background.js` | Invisible background brain: storage + Ollama calls |
| Content script | `extension/content/*` | Runs **inside** the job application page; scans/fills DOM |
| Popup | `extension/popup.*` | Small UI when you click the toolbar icon |
| Options | `extension/options.*` | Full settings page for your profile |

```text
You click Fill
  → popup or floating panel
  → content script scans inputs
  → asks background for profile + LLM answers
  → content script types into the form
  → YOU click the site's Submit
```

## Install (Load unpacked)

1. Visit `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → choose `extension/` (the folder that contains `manifest.json`)
4. Pin the extension

There is **no build step**. No `npm run build` for the extension itself.

## Everyday edit loop

1. Change a file under `extension/`
2. `chrome://extensions` → click **Reload** on Local ATS Autofill
3. Refresh the job application tab (important — content scripts load on navigation)
4. Try Fill again

If Fill says it failed, refresh the tab first. Content scripts only inject when the page loads.

## Permissions you granted

- `storage` — save profile / memory on disk via Chrome
- `activeTab` / `scripting` — talk to the current tab
- Host access to Greenhouse / Lever / Ashby pages
- Host access to `http://127.0.0.1:11434` (Ollama) and optional bridge / cloud APIs

Chrome may show a warning about local network access — that is expected for Ollama.

## Debugging

- **Popup / options errors:** right-click popup → Inspect
- **Background errors:** `chrome://extensions` → Service worker → Inspect
- **Page fill errors:** on the application page → DevTools Console (look for content script logs)

## Uninstall / reset

On `chrome://extensions`, remove the extension.  
To wipe saved profile/memory: Options → Clear memory, or remove the extension (storage goes with it unless you re-import).

## Publishing later (optional)

For personal use, Load unpacked is enough.  
Chrome Web Store packaging is a separate process (`zip` the `extension/` folder, pay developer fee, review). Not required for you or for people who clone the repo.
