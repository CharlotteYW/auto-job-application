async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isSupported(url = "") {
  return /greenhouse\.io|lever\.co|ashbyhq\.com/i.test(url);
}

function isHttpPage(url = "") {
  return /^https?:\/\//i.test(url);
}

async function ping(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "PING" });
}

async function ensureContentScript(tabId) {
  try {
    await ping(tabId);
    return true;
  } catch (_) {
    /* inject */
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: ["page/autofill.css"]
    });
  } catch (_) {}

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["page/autofill.js"]
    });
  } catch (err) {
    console.error("executeScript failed", err);
    throw err;
  }

  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      await ping(tabId);
      return true;
    } catch (_) {}
  }
  return false;
}

async function refresh() {
  const tab = await activeTab();
  const pageInfo = document.getElementById("pageInfo");
  const fillBtn = document.getElementById("fillBtn");

  if (!tab?.id || !tab.url) {
    pageInfo.textContent = "No active tab.";
    fillBtn.disabled = true;
    return;
  }

  if (!isHttpPage(tab.url)) {
    pageInfo.textContent = "Open a job application page (https).";
    fillBtn.disabled = true;
    return;
  }

  if (isSupported(tab.url)) {
    pageInfo.textContent = "Ashby/Greenhouse/Lever page detected.";
    fillBtn.disabled = false;
  } else {
    pageInfo.textContent = "URL may need a refresh; Fill will still try to inject.";
    fillBtn.disabled = false;
  }

  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (state?.ok) {
    document.getElementById("llmLabel").textContent = state.settings.useCursorBridge
      ? "Cursor bridge"
      : state.settings.llmProvider || "ollama";
    document.getElementById("memoryCount").textContent = String((state.memory || []).length);
  }

  const probe = await chrome.runtime.sendMessage({ type: "PROBE_OLLAMA" });
  const ollamaEl = document.getElementById("ollamaStatus");
  if (probe?.ok) {
    const model = state?.settings?.ollamaModel || "llama3.1:8b";
    const has = (probe.models || []).includes(model);
    ollamaEl.textContent = has ? `ok (${model})` : `ok — pull ${model}`;
    ollamaEl.style.color = has ? "#1b7f4e" : "#c98500";
  } else {
    ollamaEl.textContent = "offline";
    ollamaEl.style.color = "#b00020";
  }

  const dataProbe = await chrome.runtime.sendMessage({ type: "PROBE_DATA_SERVER" });
  const dataEl = document.getElementById("dataStatus");
  if (dataProbe?.ok) {
    const user = state?.settings?.activeUser || "me";
    dataEl.textContent = `${user} @ :3848`;
    dataEl.style.color = "#1b7f4e";
  } else {
    dataEl.textContent = "offline — npm run data-server";
    dataEl.style.color = "#b00020";
  }
}

document.getElementById("fillBtn").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  const btn = document.getElementById("fillBtn");
  const pageInfo = document.getElementById("pageInfo");
  btn.disabled = true;
  btn.textContent = "Filling…";
  pageInfo.textContent = "Injecting into page…";

  try {
    const ready = await ensureContentScript(tab.id);
    if (!ready) {
      throw new Error("Inject failed. Reload extension, refresh Ashby tab (Cmd+R), try Fill again.");
    }
    pageInfo.textContent = "Filling form…";
    const res = await chrome.tabs.sendMessage(tab.id, { type: "RUN_FILL" });
    if (!res?.ok) throw new Error(res?.error || "Fill failed");
    window.close();
  } catch (err) {
    pageInfo.textContent = String(err.message || err);
    btn.disabled = false;
    btn.textContent = "Fill this page";
  }
});

document.getElementById("syncBtn").addEventListener("click", async () => {
  const el = document.getElementById("syncResult");
  el.textContent = "Syncing…";
  const res = await chrome.runtime.sendMessage({ type: "SYNC_FROM_DATA_SERVER" });
  if (res?.ok) {
    el.textContent = `Synced ${res.userId}. Resume: ${res.resume?.fileName || "missing"}`;
    el.style.color = "#1b7f4e";
    document.getElementById("memoryCount").textContent = String((res.memory || []).length);
  } else {
    el.textContent = `Sync failed: ${res?.error || "is data-server running on :3848?"}`;
    el.style.color = "#b00020";
  }
});

document.getElementById("optionsBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

refresh();
