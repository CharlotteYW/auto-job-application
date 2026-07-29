# User data folders

Each subdirectory is one user profile.

```text
data/
  me/                 ← default user (use this now)
    profile.json      ← contact, work auth, education[], experience[]
    answers.json      ← learned Q&A (grows as you answer new questions)
    resume.pdf        ← your resume (gitignored; put the real file here)
  alice/              ← future: another user on the same machine
  ...
```

## Today (single user)

1. Edit `data/me/profile.json` with your real info
2. Put `data/me/resume.pdf`
3. Run `npm run data-server` from the repo root
4. In the extension Options, keep Active user = `me` and Data server = `http://127.0.0.1:3848`
5. Click **Sync from data folder**

When the extension asks you a new question and you answer, it writes back to `data/me/answers.json` (and updates matching profile fields when possible).

## Later (multi-user)

Copy `me/` to `data/<someone>/`, point Active user to that folder name, Sync.
