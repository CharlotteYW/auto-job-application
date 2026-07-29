# Local ATS Autofill — Cursor SDK bridge (optional)

A tiny local HTTP server. The Chrome extension can send hard form-fill prompts here; the bridge answers with the Cursor SDK (`@cursor/sdk`) running on your machine.

## Prerequisites

- Node 20+
- A Cursor account API key (`CURSOR_API_KEY`)
- Cursor app installed for **local** runtime

## Setup

```bash
cd local-bridge
cp .env.example .env
# edit .env and set CURSOR_API_KEY
npm install
npm start
```

Server listens on `http://127.0.0.1:3847`.

## Extension settings

1. Open the extension **Options**
2. Check **Use Cursor SDK local bridge for hard questions**
3. Keep bridge URL as `http://127.0.0.1:3847`
4. Save, then Fill on an application page

If the bridge is down, uncheck the option to fall back to Ollama.

## API

`POST /fill`

```json
{ "prompt": "..." }
```

Response:

```json
{ "text": "{ \"answers\": [ ... ] }" }
```

`GET /health` → `{ "ok": true }`
