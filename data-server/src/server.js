import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_ROOT = path.join(ROOT, "data");
const PORT = Number(process.env.DATA_SERVER_PORT || 3848);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,OPTIONS"
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...CORS,
    ...headers
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function safeUserId(id) {
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid user id");
  }
  return id;
}

function userDir(userId) {
  return path.join(DATA_ROOT, safeUserId(userId));
}

async function ensureUser(userId) {
  const dir = userDir(userId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function readUserJson(userId, file, fallback) {
  const full = path.join(userDir(userId), file);
  try {
    const text = await fs.readFile(full, "utf8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeUserJson(userId, file, data) {
  const dir = await ensureUser(userId);
  const full = path.join(dir, file);
  await fs.writeFile(full, JSON.stringify(data, null, 2) + "\n", "utf8");
  return full;
}

function resumeCandidates(profile) {
  const named = profile?.documents?.resumeFileName || profile?.resumeFileName || "resume.pdf";
  return [
    named,
    "Yi_Wang_Resume.pdf",
    "resume.pdf",
    "resume.docx",
    "cv.pdf",
    "CV.pdf"
  ];
}

async function findResume(userId, profile) {
  const dir = userDir(userId);
  for (const name of resumeCandidates(profile)) {
    const full = path.join(dir, name);
    if (existsSync(full)) return { full, name };
  }
  return null;
}

/** Map a learned Q&A onto profile fields when the question matches known facts. */
function applyAnswerToProfile(profile, question, answer) {
  const q = String(question || "").toLowerCase();
  const a = String(answer ?? "").trim();
  if (!a) return { profile, updatedKeys: [] };

  const p = structuredClone(profile && typeof profile === "object" ? profile : {});
  p.personal = p.personal || {};
  p.work = p.work || {};
  p.answers = p.answers || {};
  p.documents = p.documents || {};
  if (!Array.isArray(p.education)) p.education = [];
  if (!Array.isArray(p.experience)) p.experience = [];
  const updatedKeys = [];

  const set = (pathKeys, value) => {
    let cur = p;
    for (let i = 0; i < pathKeys.length - 1; i++) {
      if (!cur[pathKeys[i]] || typeof cur[pathKeys[i]] !== "object") cur[pathKeys[i]] = {};
      cur = cur[pathKeys[i]];
    }
    cur[pathKeys[pathKeys.length - 1]] = value;
    updatedKeys.push(pathKeys.join("."));
  };

  const yes = /^(yes|y|true)$/i.test(a);
  const no = /^(no|n|false)$/i.test(a);

  if (/first name|given name/.test(q)) set(["personal", "firstName"], a);
  else if (/last name|surname|family name/.test(q)) set(["personal", "lastName"], a);
  else if (/e-?mail/.test(q)) set(["personal", "email"], a);
  else if (/phone|mobile|telephone/.test(q)) set(["personal", "phone"], a);
  else if (/linkedin/.test(q)) set(["personal", "linkedinUrl"], a);
  else if (/github/.test(q)) set(["personal", "githubUrl"], a);
  else if (/portfolio|personal website|website/.test(q)) set(["personal", "portfolioUrl"], a);
  else if (/city|town/.test(q) && !/university|school/.test(q)) set(["personal", "city"], a);
  else if (/\bstate\b|province/.test(q)) set(["personal", "state"], a);
  else if (/country/.test(q)) set(["personal", "country"], a);
  else if (/years of experience|how many years/.test(q)) set(["work", "yearsExperience"], a);
  else if (/current title|job title|most recent title/.test(q)) set(["work", "currentTitle"], a);
  else if (/authorized to work|legally authorized|work authorization/.test(q)) {
    set(["work", "authorizedToWorkUS"], yes ? true : no ? false : p.work.authorizedToWorkUS);
  } else if (/sponsorship|visa/.test(q)) {
    set(["work", "needsSponsorship"], yes ? true : no ? false : p.work.needsSponsorship);
  } else if (/relocat/.test(q)) {
    set(["work", "willingToRelocate"], yes ? true : no ? false : p.work.willingToRelocate);
  } else if (/start date|when can you start|earliest start|availability/.test(q)) {
    set(["work", "earliestStartDate"], a);
  } else if (/salary|compensation|expected pay/.test(q)) set(["work", "desiredSalary"], a);
  else if (/why (do you want|are you interested)|cover letter|tell us about yourself/.test(q)) {
    set(["answers", "whyThisRole"], a);
  } else if (/additional information|anything else/.test(q)) {
    set(["answers", "additionalInfo"], a);
  }

  return { profile: p, updatedKeys };
}

function upsertAnswer(list, entry) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const n = norm(entry.question);
  const idx = list.findIndex((e) => norm(e.question) === n);
  const row = {
    question: String(entry.question || "").trim(),
    answer: String(entry.answer ?? "").trim(),
    fieldType: entry.fieldType || "text",
    ats: entry.ats || "generic",
    updatedAt: Date.now()
  };
  if (idx >= 0) list[idx] = row;
  else list.unshift(row);
  return list.slice(0, 1000);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, "");

    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/health") {
      const users = existsSync(DATA_ROOT)
        ? (await fs.readdir(DATA_ROOT, { withFileTypes: true }))
            .filter((d) => d.isDirectory() && !d.name.startsWith("."))
            .map((d) => d.name)
        : [];
      return send(res, 200, { ok: true, port: PORT, users });
    }

    // GET /api/users
    if (req.method === "GET" && parts[0] === "api" && parts[1] === "users" && parts.length === 2) {
      const users = existsSync(DATA_ROOT)
        ? (await fs.readdir(DATA_ROOT, { withFileTypes: true }))
            .filter((d) => d.isDirectory() && !d.name.startsWith("."))
            .map((d) => d.name)
        : [];
      return send(res, 200, { users });
    }

    // /api/users/:id/...
    if (parts[0] === "api" && parts[1] === "users" && parts[2]) {
      const userId = safeUserId(parts[2]);
      const action = parts[3];

      if (req.method === "GET" && action === "profile") {
        const profile = await readUserJson(userId, "profile.json", null);
        if (!profile) return send(res, 404, { error: `No profile for user ${userId}` });
        return send(res, 200, profile);
      }

      if (req.method === "PUT" && action === "profile") {
        const body = await readJson(req);
        await writeUserJson(userId, "profile.json", body);
        return send(res, 200, { ok: true });
      }

      if (req.method === "GET" && action === "answers") {
        const answers = await readUserJson(userId, "answers.json", []);
        return send(res, 200, { answers });
      }

      if (req.method === "POST" && action === "answers") {
        const body = await readJson(req);
        const entries = Array.isArray(body.entries) ? body.entries : body.answer ? [body] : [];
        let answers = await readUserJson(userId, "answers.json", []);
        let profile = await readUserJson(userId, "profile.json", {});
        const profileUpdates = [];

        for (const entry of entries) {
          answers = upsertAnswer(answers, entry);
          const applied = applyAnswerToProfile(profile, entry.question, entry.answer);
          profile = applied.profile;
          profileUpdates.push(...applied.updatedKeys);
        }

        await writeUserJson(userId, "answers.json", answers);
        if (profileUpdates.length) await writeUserJson(userId, "profile.json", profile);

        return send(res, 200, {
          ok: true,
          answerCount: answers.length,
          profileUpdates: [...new Set(profileUpdates)]
        });
      }

      if (req.method === "GET" && action === "resume") {
        const profile = await readUserJson(userId, "profile.json", {});
        const found = await findResume(userId, profile);
        if (!found) {
          return send(res, 404, {
            error: `No resume file in data/${userId}/. Put resume.pdf there.`
          });
        }
        const stat = await fs.stat(found.full);
        res.writeHead(200, {
          "Content-Type": found.name.endsWith(".pdf")
            ? "application/pdf"
            : "application/octet-stream",
          "Content-Length": stat.size,
          "Content-Disposition": `attachment; filename="${found.name}"`,
          ...CORS
        });
        createReadStream(found.full).pipe(res);
        return;
      }

      if (req.method === "GET" && action === "bundle") {
        const profile = await readUserJson(userId, "profile.json", null);
        if (!profile) return send(res, 404, { error: `No profile for user ${userId}` });
        const answers = await readUserJson(userId, "answers.json", []);
        const resume = await findResume(userId, profile);
        return send(res, 200, {
          userId,
          profile,
          answers,
          resume: resume ? { fileName: resume.name, url: `/api/users/${userId}/resume` } : null
        });
      }
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    return send(res, 500, { error: err.message || String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local ATS data server on http://127.0.0.1:${PORT}`);
  console.log(`Serving user folders from ${DATA_ROOT}`);
  console.log(`Default user: me  →  edit data/me/profile.json and add data/me/resume.pdf`);
});
