# Local ATS Autofill

Local-first Chrome extension that autofills **company ATS forms** (Greenhouse, Lever, Ashby) using a **folder of your real data** on disk — profile, education, experience, learned answers, and resume upload.

- Does **not** auto-submit (you review, then submit)
- Does **not** target LinkedIn Easy Apply
- Default LLM: local **Ollama**
- Optional: Cursor SDK bridge / OpenAI / Anthropic

---

## Your data folder (source of truth)

```text
data/
  me/                    ← you (default user)
    profile.json         ← name, work auth, education[], experience[], …
    answers.json         ← grows when you answer new questions
    resume.pdf           ← put your real resume here (gitignored)
```

Later multi-user: copy `me/` → `data/alice/`, set Active user = `alice`.

---

## Daily workflow

### 1. Fill in your info + resume

```bash
# edit this file with your real details
open data/me/profile.json

# copy your resume
cp ~/Desktop/MyResume.pdf data/me/resume.pdf
```

### 2. Start the data server (keeps the folder readable by the extension)

```bash
cd /Users/jeslin/Documents/Study/auto-job-application
npm run data-server
```

Leave this terminal open. It listens on `http://127.0.0.1:3848`.

### 3. Start Ollama (for smart leftover questions)

```bash
ollama serve
# model example:
ollama pull llama3.1:8b
```

### 4. Install / reload the Chrome extension

1. `chrome://extensions` → Developer mode → **Load unpacked**
2. Select `extension/`
3. After code changes: click **Reload**, then refresh the job page

Details: [docs/chrome-extension-101.md](docs/chrome-extension-101.md)

### 5. Sync once in Options

Extension icon → **Open settings / profile** → **Test data server** → **Sync from data folder** → Save

### 6. Apply

1. Open a Greenhouse / Lever / Ashby application
2. Click **Fill this page**
3. Extension will:
   - Sync `data/me`
   - Auto-upload `resume.pdf` into Resume/CV file inputs
   - Fill known fields from profile + past answers
   - Ask Ollama for leftovers
   - **Ask you** about still-unknown questions in the side panel
4. Your answers are written back to `data/me/answers.json` (and matching `profile.json` fields when possible)
5. You click the site’s Submit

---

## How “ask me once” works

If a required/unknown question remains after autofill, the floating panel lists it.

1. You type / select the answer  
2. Click **Save answers & fill**  
3. Saved to:
   - `data/me/answers.json` (always)
   - `data/me/profile.json` when the question maps to a known field (email, sponsorship, start date, …)
4. Next similar question is answered from memory automatically

---

## Project layout

```text
data/me/             # your personal folder
data-server/         # tiny Node server that serves/writes that folder
extension/           # Chrome MV3 extension (no build step)
local-bridge/        # optional Cursor SDK bridge
docs/                # beginner Chrome extension guide
```

---

## Privacy

- Profile + resume stay on your machine under `data/`
- Extension talks only to localhost data-server / Ollama (unless you enable cloud APIs)
- Resume files are gitignored — don’t commit them

---

## Limitations

- Some ATS use custom upload widgets; if auto-upload fails, upload once manually
- Workday-specific widgets still TODO
- LLM will leave blanks rather than invent facts

## Troubleshooting

### `content/content.js` import / stack trace errors

That file is no longer the real content script (we use `content/main-classic.js`).
If Chrome still shows an error about `content/content.js` imports:

1. Open `chrome://extensions`
2. **Remove** Local ATS Autofill (do not only click Reload)
3. **Load unpacked** again and select the `extension/` folder
4. Hard-refresh the job application tab (`Cmd+R`)

Confirm the extension version is **0.1.8** or newer on the extensions page.
There must be **no** `content/content.js` file — only `content/main-classic.js`.
If Errors still mention `content.js`, you are running a stale install: Remove, then Load unpacked again.

---

## License

MIT
