import { DEFAULT_PROFILE, DEFAULT_SETTINGS, normalizeProfile, normalizeSettings } from "./shared/profile.js";
import { upsertMemory } from "./shared/memory.js";

async function loadState() {
  const data = await chrome.storage.local.get(["profile", "settings", "memory"]);
  return {
    profile: normalizeProfile(data.profile || DEFAULT_PROFILE),
    settings: normalizeSettings(data.settings || DEFAULT_SETTINGS),
    memory: Array.isArray(data.memory) ? data.memory : []
  };
}

async function savePartial(partial) {
  await chrome.storage.local.set(partial);
}

function dataBase(settings) {
  return (settings.dataServerUrl || "http://127.0.0.1:3848").replace(/\/$/, "");
}

function activeUser(settings) {
  return settings.activeUser || "me";
}

async function syncFromDataServer() {
  const state = await loadState();
  const settings = state.settings;
  const user = activeUser(settings);
  const base = dataBase(settings);

  const res = await fetch(`${base}/api/users/${encodeURIComponent(user)}/bundle`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Data server ${res.status}: ${body.slice(0, 180)}`);
  }
  const bundle = await res.json();
  const profile = normalizeProfile(bundle.profile || {});
  const folderAnswers = Array.isArray(bundle.answers) ? bundle.answers : [];

  // Folder answers are source of truth; merge with any newer in-browser-only entries by question
  let memory = folderAnswers.slice();
  for (const entry of state.memory || []) {
    memory = upsertMemory(memory, entry);
  }

  await savePartial({ profile, memory });
  return {
    profile,
    memory,
    resume: bundle.resume || null,
    userId: bundle.userId || user
  };
}

async function getResumeFromServer() {
  const state = await loadState();
  const settings = state.settings;
  const user = activeUser(settings);
  const base = dataBase(settings);
  const res = await fetch(`${base}/api/users/${encodeURIComponent(user)}/resume`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body.slice(0, 200) || `Resume HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  const fileName =
    state.profile?.documents?.resumeFileName ||
    state.profile?.resumeFileName ||
    "resume.pdf";
  const mimeType = res.headers.get("Content-Type") || "application/pdf";
  return { base64, fileName, mimeType, byteLength: bytes.length };
}

async function saveLearnedAnswers(entries) {
  const state = await loadState();
  const settings = state.settings;
  const user = activeUser(settings);
  const base = dataBase(settings);

  let memory = state.memory;
  for (const entry of entries || []) memory = upsertMemory(memory, entry);
  await savePartial({ memory });

  try {
    const res = await fetch(`${base}/api/users/${encodeURIComponent(user)}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries })
    });
    if (!res.ok) {
      return { ok: false, error: await res.text(), memoryCount: memory.length };
    }
    const data = await res.json();
    // Re-sync profile if server updated fields
    if (data.profileUpdates?.length) {
      await syncFromDataServer();
    }
    return { ok: true, ...data, memoryCount: memory.length };
  } catch (err) {
    return { ok: false, error: err.message || String(err), memoryCount: memory.length };
  }
}

function buildPrompt({ fields, facts, job, ats }) {
  return `You fill job application form fields. Use ONLY facts from the candidate profile. Never invent employers, degrees, dates, or skills.
If you lack a reliable answer, return an empty string for that field.
For select/radio/checkbox fields, answer MUST be copied exactly from the provided options list when possible.
Always answer "No" to questions about previously working at / being employed by this company.
For salary / compensation expectation questions, use facts.desired_salary exactly (this may already be the posted range minimum).

Return ONLY valid JSON:
{"answers":[{"id":"field-id","value":"string","confidence":0.0}]}

ATS: ${ats}
Job title: ${job?.title || ""}
Company: ${job?.company || ""}
Posted salary min (if detected): ${job?.salaryMinFromPage || ""}
Job description (truncated): ${(job?.description || "").slice(0, 2500)}

Candidate facts (JSON):
${JSON.stringify(facts, null, 2)}

Fields to fill (JSON):
${JSON.stringify(fields, null, 2)}
`;
}

function parseJsonFromText(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("LLM did not return JSON");
  }
}

async function callOllama(settings, prompt) {
  const base = (settings.ollamaBaseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.ollamaModel || "gemma4:31b",
      stream: false,
      format: "json",
      options: { temperature: 0.1 },
      messages: [
        {
          role: "system",
          content: "You are a careful job-application form filler. Output JSON only."
        },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.message?.content || "";
}

async function callOpenAI(settings, prompt) {
  if (!settings.openaiApiKey) throw new Error("OpenAI API key missing in Options");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.openaiApiKey}`
    },
    body: JSON.stringify({
      model: settings.openaiModel || "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a careful job-application form filler. Output JSON only." },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callAnthropic(settings, prompt) {
  if (!settings.anthropicApiKey) throw new Error("Anthropic API key missing in Options");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: settings.anthropicModel || "claude-3-5-haiku-latest",
      max_tokens: 2000,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.content?.map((c) => c.text || "").join("") || "";
}

async function callCursorBridge(settings, prompt) {
  const base = (settings.cursorBridgeUrl || "http://127.0.0.1:3847").replace(/\/$/, "");
  const res = await fetch(`${base}/fill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt })
  });
  if (!res.ok) throw new Error(`Cursor bridge ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.text || data.content || JSON.stringify(data);
}

async function llmFill(payload) {
  const settings = normalizeSettings(payload.settings || {});
  const prompt = buildPrompt(payload);
  let text = "";

  if (settings.useCursorBridge) {
    text = await callCursorBridge(settings, prompt);
  } else if (settings.llmProvider === "openai") {
    text = await callOpenAI(settings, prompt);
  } else if (settings.llmProvider === "anthropic") {
    text = await callAnthropic(settings, prompt);
  } else if (settings.llmProvider === "off") {
    return { answers: [] };
  } else {
    text = await callOllama(settings, prompt);
  }

  const parsed = parseJsonFromText(text);
  const answers = Array.isArray(parsed.answers) ? parsed.answers : [];
  return {
    answers: answers.map((a) => ({
      id: a.id,
      value: a.value == null ? "" : String(a.value),
      confidence: typeof a.confidence === "number" ? a.confidence : 0.7
    }))
  };
}

async function probeOllama(settings) {
  const base = (settings.ollamaBaseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  const res = await fetch(`${base}/api/tags`);
  if (!res.ok) throw new Error(`Ollama not reachable (${res.status})`);
  const data = await res.json();
  return { models: (data.models || []).map((m) => m.name) };
}

async function probeDataServer(settings) {
  const base = dataBase(settings);
  const res = await fetch(`${base}/health`);
  if (!res.ok) throw new Error(`Data server HTTP ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "GET_STATE") {
      const state = await loadState();
      return { ok: true, ...state };
    }
    if (msg?.type === "SAVE_PROFILE") {
      await savePartial({ profile: normalizeProfile(msg.profile) });
      return { ok: true };
    }
    if (msg?.type === "SAVE_SETTINGS") {
      await savePartial({ settings: normalizeSettings(msg.settings) });
      return { ok: true };
    }
    if (msg?.type === "SAVE_MEMORY_BATCH") {
      const state = await loadState();
      let memory = state.memory;
      for (const entry of msg.entries || []) memory = upsertMemory(memory, entry);
      await savePartial({ memory });
      return { ok: true, count: memory.length };
    }
    if (msg?.type === "CLEAR_MEMORY") {
      await savePartial({ memory: [] });
      return { ok: true };
    }
    if (msg?.type === "SYNC_FROM_DATA_SERVER") {
      try {
        const result = await syncFromDataServer();
        return { ok: true, ...result };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    }
    if (msg?.type === "GET_RESUME") {
      try {
        const resume = await getResumeFromServer();
        return { ok: true, ...resume };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    }
    if (msg?.type === "SAVE_LEARNED_ANSWERS") {
      return saveLearnedAnswers(msg.entries || []);
    }
    if (msg?.type === "LLM_FILL") {
      try {
        const result = await llmFill(msg.payload || {});
        return { ok: true, ...result };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    }
    if (msg?.type === "PROBE_OLLAMA") {
      try {
        const state = await loadState();
        const result = await probeOllama(state.settings);
        return { ok: true, ...result };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    }
    if (msg?.type === "PROBE_DATA_SERVER") {
      try {
        const state = await loadState();
        const result = await probeDataServer(state.settings);
        return { ok: true, ...result };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    }
    return { ok: false, error: "Unknown message" };
  })()
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(["profile", "settings", "memory"]);
  const patch = {};
  if (!existing.profile) patch.profile = DEFAULT_PROFILE;
  if (!existing.settings) patch.settings = DEFAULT_SETTINGS;
  if (!existing.memory) patch.memory = [];
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
});
