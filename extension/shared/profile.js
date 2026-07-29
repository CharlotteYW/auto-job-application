/** Default profile + settings for Local ATS Autofill. */

export const DEFAULT_PROFILE = {
  id: "me",
  personal: {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    city: "",
    state: "",
    country: "United States",
    linkedinUrl: "",
    githubUrl: "",
    portfolioUrl: "",
    website: ""
  },
  work: {
    currentTitle: "",
    yearsExperience: "",
    summary: "",
    skills: [],
    authorizedToWorkUS: true,
    needsSponsorship: false,
    willingToRelocate: false,
    preferredWorkMode: "hybrid",
    noticePeriodDays: "14",
    earliestStartDate: "",
    desiredSalary: "",
    salaryCurrency: "USD"
  },
  /** Prefer array form; legacy single object still accepted. */
  education: [],
  experience: [],
  answers: {
    coverLetterStyle: "concise",
    whyThisRole: "",
    additionalInfo: ""
  },
  documents: {
    resumeFileName: "resume.pdf",
    coverLetterFileName: ""
  },
  resumeFileName: "resume.pdf"
};

export const DEFAULT_SETTINGS = {
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "gemma4:31b",
  llmProvider: "ollama",
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  anthropicApiKey: "",
  anthropicModel: "claude-3-5-haiku-latest",
  useCursorBridge: false,
  cursorBridgeUrl: "http://127.0.0.1:3847",
  dataServerUrl: "http://127.0.0.1:3848",
  activeUser: "me",
  syncOnFill: true,
  askUnknownQuestions: true,
  autoFillOnOpen: false,
  highlightFilled: true
};

export function normalizeProfile(raw = {}) {
  const merged = deepMerge(DEFAULT_PROFILE, raw || {});

  // Legacy single education object → array
  if (raw?.education && !Array.isArray(raw.education) && typeof raw.education === "object") {
    merged.education = [raw.education];
  }
  if (!Array.isArray(merged.education)) merged.education = [];
  if (!Array.isArray(merged.experience)) merged.experience = [];

  if (!merged.documents) merged.documents = { ...DEFAULT_PROFILE.documents };
  if (!merged.documents.resumeFileName) {
    merged.documents.resumeFileName = merged.resumeFileName || "resume.pdf";
  }
  return merged;
}

export function normalizeSettings(raw = {}) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  // Migrate previous default so existing installs pick up gemma4:31b
  if (!raw?.ollamaModel || raw.ollamaModel === "llama3.1:8b") {
    s.ollamaModel = DEFAULT_SETTINGS.ollamaModel;
  }
  return s;
}

function deepMerge(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? override : base.slice();
  if (base && typeof base === "object") {
    const out = { ...base };
    for (const key of Object.keys(base)) {
      out[key] = deepMerge(base[key], override?.[key]);
    }
    for (const key of Object.keys(override || {})) {
      if (!(key in out)) out[key] = override[key];
    }
    return out;
  }
  return override === undefined || override === null || override === "" ? base : override;
}

/** Flat key-value facts the mapper / LLM can use. */
export function profileFacts(profile) {
  const p = normalizeProfile(profile);
  const fullName = [p.personal.firstName, p.personal.lastName].filter(Boolean).join(" ");
  const edu0 = p.education[0] || {};
  const exp0 = p.experience[0] || {};

  const educationSummary = p.education
    .filter((e) => e.school || e.degree)
    .map((e) => [e.degree, e.field, e.school, e.graduationYear].filter(Boolean).join(", "))
    .join(" | ");

  const experienceSummary = p.experience
    .filter((e) => e.company || e.title)
    .map((e) => {
      const when = [e.startDate, e.current ? "Present" : e.endDate].filter(Boolean).join(" – ");
      return `${e.title || ""} at ${e.company || ""} (${when})`.trim();
    })
    .join(" | ");

  return {
    first_name: p.personal.firstName,
    last_name: p.personal.lastName,
    full_name: fullName,
    email: p.personal.email,
    phone: p.personal.phone,
    city: p.personal.city,
    state: p.personal.state,
    country: p.personal.country,
    location: [p.personal.city, p.personal.state, p.personal.country].filter(Boolean).join(", "),
    linkedin: p.personal.linkedinUrl,
    github: p.personal.githubUrl,
    portfolio: p.personal.portfolioUrl || p.personal.website,
    website: p.personal.website || p.personal.portfolioUrl,
    current_title: p.work.currentTitle || exp0.title || "",
    years_experience: p.work.yearsExperience,
    summary: p.work.summary,
    skills: (p.work.skills || []).join(", "),
    authorized_to_work_us: p.work.authorizedToWorkUS ? "Yes" : "No",
    needs_sponsorship: p.work.needsSponsorship ? "Yes" : "No",
    willing_to_relocate: p.work.willingToRelocate ? "Yes" : "No",
    work_mode: p.work.preferredWorkMode,
    notice_period_days: p.work.noticePeriodDays,
    earliest_start_date: p.work.earliestStartDate,
    desired_salary: p.work.desiredSalary,
    school: edu0.school || "",
    degree: edu0.degree || "",
    field_of_study: edu0.field || "",
    graduation_year: edu0.graduationYear || "",
    education_summary: educationSummary,
    company: exp0.company || "",
    experience_summary: experienceSummary,
    why_this_role: p.answers.whyThisRole,
    additional_info: p.answers.additionalInfo,
    resume_file_name: p.documents.resumeFileName || p.resumeFileName || "resume.pdf"
  };
}
