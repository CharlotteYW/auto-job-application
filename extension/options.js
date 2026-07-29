import { normalizeProfile, normalizeSettings } from "./shared/profile.js";

const $ = (id) => document.getElementById(id);

function readForm() {
  const skills = $("skills").value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const profile = normalizeProfile({
    personal: {
      firstName: $("firstName").value.trim(),
      lastName: $("lastName").value.trim(),
      email: $("email").value.trim(),
      phone: $("phone").value.trim(),
      city: $("city").value.trim(),
      state: $("state").value.trim(),
      country: $("country").value.trim(),
      linkedinUrl: $("linkedinUrl").value.trim(),
      githubUrl: $("githubUrl").value.trim(),
      portfolioUrl: $("portfolioUrl").value.trim(),
      website: $("portfolioUrl").value.trim()
    },
    work: {
      currentTitle: $("currentTitle").value.trim(),
      yearsExperience: $("yearsExperience").value.trim(),
      summary: $("summary").value.trim(),
      skills,
      authorizedToWorkUS: $("authorizedToWorkUS").checked,
      needsSponsorship: $("needsSponsorship").checked,
      willingToRelocate: $("willingToRelocate").checked,
      preferredWorkMode: $("preferredWorkMode").value,
      noticePeriodDays: $("noticePeriodDays").value.trim(),
      earliestStartDate: $("earliestStartDate").value.trim(),
      desiredSalary: $("desiredSalary").value.trim()
    },
    education: {
      school: $("school").value.trim(),
      degree: $("degree").value.trim(),
      field: $("field").value.trim(),
      graduationYear: $("graduationYear").value.trim()
    },
    answers: {
      whyThisRole: $("whyThisRole").value.trim(),
      additionalInfo: $("additionalInfo").value.trim()
    }
  });

  const settings = normalizeSettings({
    llmProvider: $("llmProvider").value,
    ollamaBaseUrl: $("ollamaBaseUrl").value.trim(),
    ollamaModel: $("ollamaModel").value.trim(),
    openaiApiKey: $("openaiApiKey").value.trim(),
    openaiModel: $("openaiModel").value.trim(),
    anthropicApiKey: $("anthropicApiKey").value.trim(),
    anthropicModel: $("anthropicModel").value.trim(),
    useCursorBridge: $("useCursorBridge").checked,
    cursorBridgeUrl: $("cursorBridgeUrl").value.trim(),
    dataServerUrl: $("dataServerUrl").value.trim(),
    activeUser: $("activeUser").value.trim() || "me",
    syncOnFill: $("syncOnFill").checked,
    askUnknownQuestions: $("askUnknownQuestions").checked
  });

  return { profile, settings };
}

function writeForm(profile, settings, memory) {
  const p = normalizeProfile(profile);
  const s = normalizeSettings(settings);

  $("firstName").value = p.personal.firstName;
  $("lastName").value = p.personal.lastName;
  $("email").value = p.personal.email;
  $("phone").value = p.personal.phone;
  $("city").value = p.personal.city;
  $("state").value = p.personal.state;
  $("country").value = p.personal.country;
  $("linkedinUrl").value = p.personal.linkedinUrl;
  $("githubUrl").value = p.personal.githubUrl;
  $("portfolioUrl").value = p.personal.portfolioUrl || p.personal.website;
  $("currentTitle").value = p.work.currentTitle;
  $("yearsExperience").value = p.work.yearsExperience;
  $("desiredSalary").value = p.work.desiredSalary;
  $("earliestStartDate").value = p.work.earliestStartDate;
  $("noticePeriodDays").value = p.work.noticePeriodDays;
  $("preferredWorkMode").value = p.work.preferredWorkMode || "hybrid";
  $("authorizedToWorkUS").checked = !!p.work.authorizedToWorkUS;
  $("needsSponsorship").checked = !!p.work.needsSponsorship;
  $("willingToRelocate").checked = !!p.work.willingToRelocate;
  $("school").value = p.education.school;
  $("degree").value = p.education.degree;
  $("field").value = p.education.field;
  $("graduationYear").value = p.education.graduationYear;
  $("skills").value = (p.work.skills || []).join(", ");
  $("summary").value = p.work.summary;
  $("whyThisRole").value = p.answers.whyThisRole;
  $("additionalInfo").value = p.answers.additionalInfo;

  $("llmProvider").value = s.llmProvider;
  $("ollamaBaseUrl").value = s.ollamaBaseUrl;
  $("ollamaModel").value = s.ollamaModel;
  $("openaiApiKey").value = s.openaiApiKey;
  $("openaiModel").value = s.openaiModel;
  $("anthropicApiKey").value = s.anthropicApiKey;
  $("anthropicModel").value = s.anthropicModel;
  $("useCursorBridge").checked = !!s.useCursorBridge;
  $("cursorBridgeUrl").value = s.cursorBridgeUrl;
  $("dataServerUrl").value = s.dataServerUrl;
  $("activeUser").value = s.activeUser || "me";
  $("syncOnFill").checked = s.syncOnFill !== false;
  $("askUnknownQuestions").checked = s.askUnknownQuestions !== false;

  $("memoryInfo").textContent = `${(memory || []).length} remembered answers`;
}

async function load() {
  const res = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!res?.ok) throw new Error(res?.error || "load failed");
  writeForm(res.profile, res.settings, res.memory);
}

$("saveBtn").addEventListener("click", async () => {
  const { profile, settings } = readForm();
  await chrome.runtime.sendMessage({ type: "SAVE_PROFILE", profile });
  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  $("saveStatus").textContent = `Saved at ${new Date().toLocaleTimeString()}`;
});

$("probeOllama").addEventListener("click", async () => {
  // save URL/model first so probe uses latest
  const { settings } = readForm();
  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  const res = await chrome.runtime.sendMessage({ type: "PROBE_OLLAMA" });
  $("probeResult").textContent = res?.ok
    ? `Connected. Models: ${(res.models || []).slice(0, 8).join(", ")}`
    : `Failed: ${res?.error || "unknown"}`;
});

$("probeData").addEventListener("click", async () => {
  const { settings } = readForm();
  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  const res = await chrome.runtime.sendMessage({ type: "PROBE_DATA_SERVER" });
  $("dataResult").textContent = res?.ok
    ? `OK — users: ${(res.users || []).join(", ") || "(none)"}`
    : `Failed: ${res?.error || "unknown"}`;
});

$("syncData").addEventListener("click", async () => {
  const { settings } = readForm();
  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  const res = await chrome.runtime.sendMessage({ type: "SYNC_FROM_DATA_SERVER" });
  if (res?.ok) {
    writeForm(res.profile, settings, res.memory);
    $("dataResult").textContent = `Synced user ${res.userId}. Resume: ${res.resume?.fileName || "not found"}`;
  } else {
    $("dataResult").textContent = `Sync failed: ${res?.error || "unknown"}`;
  }
});

$("clearMemory").addEventListener("click", async () => {
  if (!confirm("Clear all remembered answers?")) return;
  await chrome.runtime.sendMessage({ type: "CLEAR_MEMORY" });
  $("memoryInfo").textContent = "0 remembered answers";
});

$("exportBtn").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  const blob = new Blob([JSON.stringify({ profile: res.profile, settings: { ...res.settings, openaiApiKey: "", anthropicApiKey: "" }, memory: res.memory }, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "local-ats-autofill-export.json";
  a.click();
  URL.revokeObjectURL(url);
});

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const data = JSON.parse(text);
  if (data.profile) await chrome.runtime.sendMessage({ type: "SAVE_PROFILE", profile: data.profile });
  if (data.settings) await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: data.settings });
  if (Array.isArray(data.memory)) {
    await chrome.runtime.sendMessage({ type: "CLEAR_MEMORY" });
    await chrome.runtime.sendMessage({ type: "SAVE_MEMORY_BATCH", entries: data.memory });
  }
  await load();
  $("saveStatus").textContent = "Imported.";
});

load().catch((err) => {
  $("saveStatus").textContent = err.message || String(err);
});
