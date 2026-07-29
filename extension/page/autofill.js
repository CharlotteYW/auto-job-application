/* Classic content script — no import/export. Works with scripting.executeScript. */
(function () {
  const BUILD = "0.2.3";
  if (window.__localAtsBuild === BUILD && window.__localAtsContentReady) return;
  window.__localAtsBuild = BUILD;
  window.__localAtsContentReady = true;
  window.__localAtsLoaded = true;

  const RULES = [
    { keys: ["first name", "firstname", "given name"], fact: "first_name", conf: 0.95 },
    { keys: ["last name", "lastname", "surname", "family name"], fact: "last_name", conf: 0.95 },
    { keys: ["full name", "legal name", "your name", "candidate name"], fact: "full_name", conf: 0.9 },
    { keys: ["email", "e-mail"], fact: "email", conf: 0.98 },
    { keys: ["phone", "mobile", "telephone", "cell"], fact: "phone", conf: 0.95 },
    { keys: ["linkedin"], fact: "linkedin", conf: 0.98 },
    { keys: ["github"], fact: "github", conf: 0.98 },
    { keys: ["portfolio", "personal website", "website", "personal url"], fact: "portfolio", conf: 0.9 },
    { keys: ["city", "town"], fact: "city", conf: 0.85 },
    { keys: ["state", "province", "region"], fact: "state", conf: 0.85 },
    { keys: ["country"], fact: "country", conf: 0.9 },
    { keys: ["location", "current location", "where are you based", "reside"], fact: "location", conf: 0.85 },
    { keys: ["years of experience", "years experience", "how many years", "total experience"], fact: "years_experience", conf: 0.9 },
    { keys: ["current title", "job title", "most recent title", "headline"], fact: "current_title", conf: 0.85 },
    { keys: ["authorized to work", "legally authorized", "work authorization", "eligible to work"], fact: "authorized_to_work_us", conf: 0.92 },
    { keys: ["require sponsorship", "need sponsorship", "visa sponsorship", "immigration sponsorship", "will you now or in the future"], fact: "needs_sponsorship", conf: 0.92 },
    { keys: ["relocat"], fact: "willing_to_relocate", conf: 0.85 },
    { keys: ["start date", "earliest start", "when can you start", "available to start", "availability date"], fact: "earliest_start_date", conf: 0.9 },
    { keys: ["notice period"], fact: "notice_period_days", conf: 0.8 },
    { keys: ["salary", "compensation", "expected pay", "desired pay", "pay expectation", "expected compensation", "salary expectation", "compensation expectation"], fact: "desired_salary", conf: 0.85 },
    { keys: ["school", "university", "college"], fact: "school", conf: 0.85 },
    { keys: ["degree"], fact: "degree", conf: 0.85 },
    { keys: ["field of study", "major"], fact: "field_of_study", conf: 0.85 },
    { keys: ["graduation", "grad year"], fact: "graduation_year", conf: 0.8 },
    { keys: ["cover letter", "why do you want", "why are you interested", "why this role", "why this company", "tell us about yourself"], fact: "why_this_role", conf: 0.7 },
    { keys: ["additional information", "anything else"], fact: "additional_info", conf: 0.75 }
  ];

  function isWorkedAtCompanyQuestion(label) {
    const t = String(label || "").toLowerCase();
    return (
      /previously (worked|employed)/.test(t) ||
      /former employee|current (or )?former employee/.test(t) ||
      /worked (at|for|with) (this|our|the) (company|organization|employer)/.test(t) ||
      /have you (ever )?(worked|been employed) (here|at|for|with)/.test(t) ||
      /are you (a |an )?(current|former|previous) employee/.test(t) ||
      /currently employed by/.test(t) ||
      /internal (candidate|applicant)/.test(t) ||
      /employee of (this|our|the) company/.test(t)
    );
  }

  function parseMoneyToken(raw) {
    const s0 = String(raw || "").trim().toLowerCase().replace(/[$,\s]/g, "");
    if (!s0) return null;
    const hasK = /k$/.test(s0);
    const n = Number(s0.replace(/k$/, ""));
    if (!Number.isFinite(n)) return null;
    let value = hasK ? n * 1000 : n;
    if (!hasK && value > 0 && value < 1000) value *= 1000;
    return value;
  }

  function extractSalaryMinFromPage() {
    const text = document.body?.innerText || "";
    const candidates = [];
    const patterns = [
      /\$\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:[-–—]|to)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?/gi,
      /([\d,]+)\s*k\s*(?:[-–—]|to)\s*([\d,]+)\s*k/gi,
      /(?:usd|us\$)\s*([\d,]+)\s*(?:[-–—]|to)\s*(?:usd|us\$)?\s*([\d,]+)/gi
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(text))) {
        let low = null;
        if (m[3] != null) low = parseMoneyToken(m[1] + (m[2] || ""));
        else low = parseMoneyToken(/k/i.test(m[0]) ? `${m[1]}k` : m[1]);
        if (low && low >= 20000 && low <= 1000000) candidates.push(low);
      }
    }
    if (!candidates.length) return null;
    return String(Math.round(candidates[0]));
  }

  function applySpecialAnswers(label, options) {
    if (isWorkedAtCompanyQuestion(label)) {
      const value = options?.length ? pickOption("No", options) || "No" : "No";
      return { value, confidence: 0.99, source: "rule" };
    }
    if (/how did you hear|where did you hear|referral source|source of (this )?opportunity|how did you find/i.test(label || "")) {
      if ((options || []).length >= 2) {
        const linkedin = options.find((o) => /linkedin/i.test(o));
        if (linkedin) return { value: linkedin, confidence: 0.92, source: "rule" };
      }
    }
    return null;
  }

  function isMultiSelectQuestion(label, fieldType) {
    if (fieldType === "checkbox" || fieldType === "multiselect") return true;
    return /select all that apply|check all that apply|all that apply|choose all that apply/i.test(label || "");
  }

  function optionLabelForInput(n) {
    let t = "";
    if (n.id) {
      try {
        t = cleanText(document.querySelector(`label[for="${CSS.escape(n.id)}"]`)?.textContent);
      } catch (_) {}
    }
    if (!t) t = cleanText(n.closest("label")?.textContent);
    if (!t) t = cleanText(n.getAttribute("aria-label"));
    if (!t) t = cleanText(n.value);
    if (t.length > 80) {
      const sibling = n.parentElement?.querySelector("span, p, div") || n.nextElementSibling;
      const short = cleanText(sibling?.textContent || "");
      if (short && short.length < t.length) t = short;
    }
    return t;
  }

  function questionContainer(el) {
    // Prefer the tightest Ashby/Greenhouse field wrapper — never climb to a whole section/form.
    return (
      el.closest(
        ".ashby-application-form-field-entry, [class*='fieldEntry'], fieldset, [role='group'], .field, .application-question, .question, [data-testid*='question'], [class*='FormField']"
      ) || el.parentElement
    );
  }

  function yesNoWrap(el) {
    return el?.closest?.("[class*='yesno'], [class*='YesNo']") || null;
  }

  function yesNoButtons(wrap) {
    if (!wrap) return [];
    return [...wrap.querySelectorAll(":scope > button, button")].filter((b) =>
      /^(yes|no)$/i.test(cleanText(b.textContent))
    );
  }

  function isYesNoControl(el) {
    if (!el) return false;
    const wrap = yesNoWrap(el) || el.parentElement;
    return yesNoButtons(wrap).length >= 2;
  }

  function yesNoLabel(el, wrap) {
    const entry =
      el?.closest?.(".ashby-application-form-field-entry, [class*='fieldEntry']") ||
      wrap?.closest?.(".ashby-application-form-field-entry, [class*='fieldEntry']") ||
      questionContainer(el);
    const title = entry?.querySelector?.(
      "label.ashby-application-form-question-title, label[class*='label'], legend, h3, h4"
    );
    const t = cleanText(title?.textContent);
    if (t && t.length >= 8 && t.length < 240) return t;
    if (el?.name) {
      try {
        const byFor = document.querySelector(`label[for="${CSS.escape(el.name)}"]`);
        const lt = cleanText(byFor?.textContent);
        if (lt) return lt;
      } catch (_) {}
    }
    return labelFor(el);
  }

  function isYesNoActive(btn) {
    if (!btn) return false;
    if (/_active_/.test(btn.className || "")) return true;
    if (/(^|\s)active(\s|$)/i.test(btn.className || "")) return true;
    if (/(^|\s)(is-)?selected(\s|$)/i.test(btn.className || "")) return true;
    return (
      btn.getAttribute("aria-pressed") === "true" ||
      btn.getAttribute("aria-checked") === "true" ||
      btn.getAttribute("aria-selected") === "true" ||
      btn.dataset.selected === "true"
    );
  }

  function pressButton(btn) {
    if (!btn) return;
    const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    try {
      btn.dispatchEvent(new PointerEvent("pointerdown", opts));
    } catch (_) {}
    btn.dispatchEvent(new MouseEvent("mousedown", opts));
    try {
      btn.dispatchEvent(new PointerEvent("pointerup", opts));
    } catch (_) {}
    btn.dispatchEvent(new MouseEvent("mouseup", opts));
    btn.dispatchEvent(new MouseEvent("click", opts));
    try {
      btn.click();
    } catch (_) {}
  }

  function makeYesNoField(checkbox, wrap, buttons) {
    const id = `ats-field-${++fieldSeq}`;
    if (checkbox) checkbox.dataset.atsFieldId = id;
    const entry = (checkbox || wrap)?.closest?.(".ashby-application-form-field-entry, [class*='fieldEntry']");
    const required =
      !!checkbox?.required ||
      checkbox?.getAttribute?.("aria-required") === "true" ||
      !!entry?.querySelector("label[class*='required'], .ashby-application-form-question-title[class*='required']");
    return {
      id,
      el: checkbox || buttons[0],
      elements: buttons,
      label: yesNoLabel(checkbox || buttons[0], wrap),
      type: "yesno",
      required,
      options: buttons.map((b) => cleanText(b.textContent)).filter(Boolean),
      name: checkbox?.name || "",
      multi: false
    };
  }

  function scanYesNoFields(root, seen) {
    const fields = [];
    const usedWraps = new WeakSet();

    // Pass A: hidden Ashby checkboxes inside yes/no widgets
    for (const el of root.querySelectorAll("input[type='checkbox']")) {
      if (seen.has(el) || !isYesNoControl(el)) continue;
      const wrap = yesNoWrap(el) || el.parentElement;
      if (!wrap || usedWraps.has(wrap)) continue;
      const buttons = yesNoButtons(wrap);
      if (buttons.length < 2) continue;
      usedWraps.add(wrap);
      seen.add(el);
      buttons.forEach((b) => seen.add(b));
      fields.push(makeYesNoField(el, wrap, buttons));
    }

    // Pass B: field entries that only expose Yes/No buttons
    for (const entry of root.querySelectorAll(
      ".ashby-application-form-field-entry, [class*='fieldEntry'], [class*='yesno'], [class*='YesNo']"
    )) {
      const wrap = yesNoWrap(entry) || entry;
      if (usedWraps.has(wrap)) continue;
      const buttons = yesNoButtons(wrap);
      if (buttons.length < 2) continue;
      const checkbox = wrap.querySelector("input[type='checkbox']");
      if (checkbox && seen.has(checkbox)) continue;
      usedWraps.add(wrap);
      if (checkbox) seen.add(checkbox);
      buttons.forEach((b) => seen.add(b));
      fields.push(makeYesNoField(checkbox, wrap, buttons));
    }

    return fields;
  }

  function normalizeQuestion(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function questionTokens(text) {
    const stop = new Set(["a", "an", "the", "is", "are", "do", "does", "you", "your", "to", "of", "in", "on", "for", "with", "and", "or", "what", "when", "how"]);
    return normalizeQuestion(text).split(" ").filter((t) => t.length > 1 && !stop.has(t));
  }

  function similarity(a, b) {
    const A = new Set(questionTokens(a));
    const B = new Set(questionTokens(b));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter += 1;
    return (2 * inter) / (A.size + B.size);
  }

  function findMemoryAnswer(memory, question, threshold = 0.72) {
    let best = null;
    let bestScore = 0;
    for (const entry of memory || []) {
      const score = similarity(entry.question, question);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    return best && bestScore >= threshold ? { answer: best.answer, score: bestScore } : null;
  }

  function pickOption(desired, options) {
    if (!desired || !options?.length) return null;
    const d = String(desired).trim().toLowerCase();
    const cleaned = options
      .map((o) => ({ raw: o, n: String(o).trim().toLowerCase() }))
      .filter((o) => o.n && !/^select|please select|--$/i.test(o.n));
    for (const o of cleaned) if (o.n === d) return o.raw;
    const yes = /^(yes|y|true)/i.test(d);
    const no = /^(no|n|false)/i.test(d);
    if (yes || no) {
      for (const o of cleaned) {
        const isYes =
          (/^\s*yes\b/.test(o.n) || /\byes\b/.test(o.n)) &&
          !/\bno\b|never|have not|haven't|not worked|not employed/.test(o.n);
        const isNo =
          /^\s*no\b/.test(o.n) ||
          /\bno\b/.test(o.n) ||
          /never|have not|haven't|not worked|not employed|i have not/.test(o.n);
        if (yes && isYes) return o.raw;
        if (no && isNo) return o.raw;
      }
    }
    for (const o of cleaned) if (o.n.includes(d) || d.includes(o.n)) return o.raw;
    return null;
  }

  function mapFieldLocally(label, facts, options) {
    const text = String(label || "").toLowerCase();
    if (!text.trim()) return null;

    const special = applySpecialAnswers(label, options);
    if (special) return special;

    for (const rule of RULES) {
      if (!rule.keys.some((k) => text.includes(k))) continue;
      const value = facts[rule.fact];
      if (value === undefined || value === null || value === "") continue;
      if (options?.length) {
        const picked = pickOption(String(value), options);
        if (!picked) return null;
        return { value: picked, confidence: rule.conf, source: "rule" };
      }
      return { value: String(value), confidence: rule.conf, source: "rule" };
    }
    return null;
  }

  function profileFacts(profile) {
    const p = profile || {};
    const personal = p.personal || {};
    const work = p.work || {};
    const education = Array.isArray(p.education) ? p.education : [];
    const experience = Array.isArray(p.experience) ? p.experience : [];
    const answers = p.answers || {};
    const edu0 = education[0] || (typeof p.education === "object" && !Array.isArray(p.education) ? p.education : {}) || {};
    const exp0 = experience[0] || {};
    const fullName = [personal.firstName, personal.lastName].filter(Boolean).join(" ");
    return {
      first_name: personal.firstName || "",
      last_name: personal.lastName || "",
      full_name: fullName,
      email: personal.email || "",
      phone: personal.phone || "",
      city: personal.city || "",
      state: personal.state || "",
      country: personal.country || "",
      location: [personal.city, personal.state, personal.country].filter(Boolean).join(", "),
      linkedin: personal.linkedinUrl || "",
      github: personal.githubUrl || "",
      portfolio: personal.portfolioUrl || personal.website || "",
      website: personal.website || personal.portfolioUrl || "",
      current_title: work.currentTitle || exp0.title || "",
      years_experience: work.yearsExperience || "",
      summary: work.summary || "",
      skills: Array.isArray(work.skills) ? work.skills.join(", ") : "",
      authorized_to_work_us: work.authorizedToWorkUS ? "Yes" : "No",
      needs_sponsorship: work.needsSponsorship ? "Yes" : "No",
      willing_to_relocate: work.willingToRelocate ? "Yes" : "No",
      work_mode: work.preferredWorkMode || "",
      notice_period_days: work.noticePeriodDays || "",
      earliest_start_date: work.earliestStartDate || "",
      desired_salary: work.desiredSalary || "",
      school: edu0.school || "",
      degree: edu0.degree || "",
      field_of_study: edu0.field || "",
      graduation_year: edu0.graduationYear || "",
      why_this_role: answers.whyThisRole || "",
      additional_info: answers.additionalInfo || ""
    };
  }

  function detectAts(hostname) {
    const h = (hostname || location.hostname).toLowerCase();
    if (h.includes("greenhouse")) return "greenhouse";
    if (h.includes("lever")) return "lever";
    if (h.includes("ashby")) return "ashby";
    return "generic";
  }

  function cleanText(t) {
    return String(t || "").replace(/\s+/g, " ").replace(/\*/g, "").trim();
  }

  function visible(el) {
    if (!el || el.disabled) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || (el.type || "").toLowerCase() === "file";
  }

  function labelFor(el) {
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").trim();
    if (el.id) {
      try {
        const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (byFor) return cleanText(byFor.textContent);
      } catch (_) {}
    }
    const wrapped = el.closest("label");
    if (wrapped) return cleanText(wrapped.textContent);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "");
      const joined = cleanText(parts.join(" "));
      if (joined) return joined;
    }
    const container = el.closest(
      ".field, .application-question, .question, [class*='question'], [class*='Question'], fieldset, [data-testid], [class*='form']"
    );
    if (container) {
      const labelEl = container.querySelector("label, legend, .label, h3, h4, p, span");
      if (labelEl) {
        const t = cleanText(labelEl.textContent);
        if (t && t.length < 220) return t;
      }
    }
    return cleanText(el.placeholder || el.name || el.id || "");
  }

  let fieldSeq = 0;
  function scanFields(root) {
    root = root || document;
    fieldSeq = 0;
    const fields = [];
    const seen = new WeakSet();

    // Ashby Yes/No must be collected BEFORE checkbox multi-select grouping,
    // otherwise hidden visa checkboxes get swallowed into "how did you hear".
    for (const f of scanYesNoFields(root, seen)) fields.push(f);

    const inputs = root.querySelectorAll("input, textarea, select");
    for (const el of inputs) {
      if (seen.has(el)) continue;
      const type = (el.getAttribute("type") || el.tagName.toLowerCase()).toLowerCase();
      if (["hidden", "submit", "button", "image", "reset", "password"].includes(type)) continue;

      if (type === "file") {
        const label = labelFor(el);
        const blob = `${label} ${el.name || ""} ${el.id || ""} ${el.accept || ""}`.toLowerCase();
        if (!/resume|cv|curriculum|cover|attachment|upload|file|pdf|doc/.test(blob) && el.accept && !/pdf|doc/.test(el.accept)) {
          continue;
        }
        if (!visible(el) && el.offsetParent === null && getComputedStyle(el).display === "none") {
          // still try ashby hidden file inputs
        }
        seen.add(el);
        const id = `ats-field-${++fieldSeq}`;
        el.dataset.atsFieldId = id;
        fields.push({
          id,
          el,
          elements: [el],
          label: label || "Resume",
          type: "file",
          required: !!el.required,
          options: [],
          name: el.name || ""
        });
        continue;
      }

      if (!visible(el)) continue;

      if (type === "radio" || type === "checkbox") {
        if (isYesNoControl(el)) continue;
        const container = questionContainer(el);
        let group = [];

        // 1) Prefer same name (true radio/checkbox groups)
        if (el.name) {
          try {
            group = [...root.querySelectorAll(`input[type="${type}"][name="${CSS.escape(el.name)}"]`)];
          } catch (_) {
            group = [el];
          }
        }

        // 2) For checkboxes with unique names (Ashby), take siblings in the SAME question container only
        if (type === "checkbox" && container && group.length <= 1) {
          const inContainer = [...container.querySelectorAll(`input[type="checkbox"], [role="checkbox"]`)].filter(
            (c) => !isYesNoControl(c) && !seen.has(c)
          );
          // Keep groups small — avoid swallowing the whole form
          if (inContainer.length >= 2 && inContainer.length <= 20) {
            group = inContainer;
          } else if (inContainer.length > 20) {
            group = group.length ? group : [el];
          } else {
            group = inContainer.length ? inContainer : [el];
          }
        }

        if (!group.length) group = [el];
        group = group.filter((g) => !seen.has(g) && !isYesNoControl(g));
        if (!group.length) continue;
        group.forEach((g) => seen.add(g));

        let groupLabel = "";
        if (container) {
          const headingEl = container.querySelector(
            "legend, h3, h4, label.ashby-application-form-question-title, [class*='heading'], [class*='Heading'], [class*='title'], [class*='Title']"
          );
          groupLabel = cleanText(headingEl?.textContent || "");
          if (!groupLabel || groupLabel.length < 8) {
            const labels = [...container.querySelectorAll("label, p, span, div")].slice(0, 12);
            for (const node of labels) {
              const t = cleanText(node.textContent);
              if (t.length >= 12 && t.length <= 200 && (/[?]/.test(t) || /select all that apply/i.test(t))) {
                groupLabel = t;
                break;
              }
            }
          }
        }
        if (!groupLabel) groupLabel = labelFor(el);

        const options = group.map(optionLabelForInput).filter(Boolean);
        const uniq = [];
        const seenOpt = new Set();
        for (const o of options) {
          if (groupLabel && o.length > 50 && similarity(o, groupLabel) > 0.8) continue;
          const k = o.toLowerCase();
          if (seenOpt.has(k)) continue;
          seenOpt.add(k);
          uniq.push(o);
        }

        fields.push({
          id: `ats-field-${++fieldSeq}`,
          el: group[0],
          elements: group,
          label: groupLabel || el.name || type,
          type: type === "radio" ? "radio" : "checkbox",
          required: group.some((g) => g.required || g.getAttribute?.("aria-required") === "true"),
          options: uniq,
          name: el.name || "",
          multi: type === "checkbox"
        });
        continue;
      }

      seen.add(el);
      const id = `ats-field-${++fieldSeq}`;
      el.dataset.atsFieldId = id;
      const isSelect = el.tagName.toLowerCase() === "select";
      const multi = isSelect && !!el.multiple;
      fields.push({
        id,
        el,
        elements: [el],
        label: labelFor(el),
        type: multi ? "multiselect" : isSelect ? "select" : el.tagName.toLowerCase() === "textarea" ? "textarea" : "text",
        required: !!el.required || el.getAttribute("aria-required") === "true",
        options: isSelect ? [...el.options].map((o) => o.textContent.trim()).filter(Boolean) : [],
        name: el.name || "",
        multi
      });
      continue;
    }
    return fields;
  }

  function extractJobContext() {
    const title = document.querySelector("h1")?.textContent?.trim() || document.title;
    return {
      title: (title || "").slice(0, 200),
      company: "",
      description: (document.body?.innerText || "").slice(0, 4000),
      url: location.href
    };
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    descriptor?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function highlight(el, level) {
    const colors = { high: "#1b7f4e", medium: "#c98500", low: "#b00020", memory: "#0b6e99" };
    const color = colors[level] || colors.medium;
    const targets = Array.isArray(el) ? el : [el];
    for (const t of targets) {
      if (!t?.style) continue;
      t.style.outline = `2px solid ${color}`;
      t.style.outlineOffset = "2px";
      t.dataset.atsFillLevel = level;
    }
  }

  function clearHighlights() {
    document.querySelectorAll("[data-ats-fill-level]").forEach((el) => {
      el.style.outline = "";
      el.style.outlineOffset = "";
      delete el.dataset.atsFillLevel;
    });
  }

  function fillText(el, value) {
    if (value == null || value === "") return false;
    el.focus();
    setNativeValue(el, String(value));
    return true;
  }

  function splitMultiValue(desired) {
    return String(desired || "")
      .split(/\s*\|\|\|\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function fillSelect(el, desired) {
    if (desired == null || desired === "") return false;
    const wants = el.multiple ? splitMultiValue(desired) : [String(desired).trim()];
    if (!wants.length) return false;
    let matchedAny = false;
    if (el.multiple) {
      for (const opt of el.options) opt.selected = false;
    }
    for (const wantRaw of wants) {
      const want = wantRaw.toLowerCase();
      for (const opt of el.options) {
        const t = opt.textContent.trim().toLowerCase();
        const v = String(opt.value).trim().toLowerCase();
        if (t === want || v === want || t.includes(want) || want.includes(t)) {
          if (el.multiple) opt.selected = true;
          else {
            el.value = opt.value;
            matchedAny = true;
            break;
          }
          matchedAny = true;
          break;
        }
      }
    }
    if (!matchedAny) return false;
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function optionMatches(want, label, value) {
    const w = String(want || "").trim().toLowerCase();
    const n = String(label || "").trim().toLowerCase();
    const v = String(value || "").trim().toLowerCase();
    if (!w) return false;
    if (n === w || v === w) return true;
    if (n.startsWith(w) || w.startsWith(n)) return n.length >= 2 && w.length >= 2;
    // Avoid loose substring matches on short tokens like "a" / "no" inside longer words
    if (w.length >= 4 && (n.includes(w) || w.includes(n))) return true;
    return false;
  }

  function fillRadioOrCheckbox(elements, desired, type) {
    if (desired == null || desired === "") return false;
    const wants = type === "checkbox" ? splitMultiValue(desired) : [String(desired).trim()];
    let matchedAny = false;
    for (const wantRaw of wants) {
      let matched = false;
      // Pass 1: exact
      for (const el of elements) {
        const label = optionLabelForInput(el) || "";
        if (label.toLowerCase() === wantRaw.toLowerCase() || String(el.value).toLowerCase() === wantRaw.toLowerCase()) {
          el.focus();
          if (type === "checkbox") {
            if (el.tagName === "INPUT") {
              if (!el.checked) el.click();
            } else if (el.getAttribute("aria-checked") !== "true") el.click();
          } else el.click();
          el.dispatchEvent(new Event("change", { bubbles: true }));
          matched = true;
          matchedAny = true;
          break;
        }
      }
      if (matched) {
        if (type === "radio") return true;
        continue;
      }
      // Pass 2: fuzzy
      for (const el of elements) {
        const label = optionLabelForInput(el) || "";
        if (!optionMatches(wantRaw, label, el.value)) continue;
        el.focus();
        if (type === "checkbox") {
          if (el.tagName === "INPUT") {
            if (!el.checked) el.click();
          } else if (el.getAttribute("aria-checked") !== "true") el.click();
        } else el.click();
        el.dispatchEvent(new Event("change", { bubbles: true }));
        matchedAny = true;
        if (type === "radio") return true;
        break;
      }
    }
    return matchedAny;
  }

  function fillFile(el, file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      highlight(el, "high");
      return el.files?.length > 0;
    } catch (err) {
      console.warn("fillFile", err);
      return false;
    }
  }

  function fillYesNo(field, desired) {
    if (desired == null || desired === "") return false;
    const wantRaw = String(desired).trim();
    const want = wantRaw.toLowerCase();
    const isYes = /^(yes|y|true|1)$/i.test(wantRaw);
    const isNo = /^(no|n|false|0)$/i.test(wantRaw);
    const buttons = field.elements || [];
    let target = null;
    for (const btn of buttons) {
      const t = cleanText(btn.textContent).toLowerCase();
      if (isYes && t === "yes") {
        target = btn;
        break;
      }
      if (isNo && t === "no") {
        target = btn;
        break;
      }
      if (t === want || optionMatches(wantRaw, t, t)) {
        target = btn;
        break;
      }
    }
    if (!target) return false;
    pressButton(target);
    // Fallback: sync hidden checkbox (Ashby: Yes=checked, No=unchecked)
    const cb = field.el;
    if (cb && (cb.type || "").toLowerCase() === "checkbox") {
      const shouldCheck = isYes || (!isNo && /yes/i.test(wantRaw));
      if (cb.checked !== shouldCheck) {
        try {
          const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
          desc?.set?.call(cb, shouldCheck);
          cb.dispatchEvent(new Event("click", { bubbles: true }));
          cb.dispatchEvent(new Event("input", { bubbles: true }));
          cb.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (_) {
          if (cb.checked !== shouldCheck) cb.click();
        }
      }
    }
    return !isEmpty({ ...field, type: "yesno" }) || isYesNoActive(target);
  }

  function fillField(field, value, level) {
    let ok = false;
    if (field.type === "file") return false;
    if (field.type === "yesno") ok = fillYesNo(field, value);
    else if (field.type === "select" || field.type === "multiselect") ok = fillSelect(field.el, value);
    else if (field.type === "radio" || field.type === "checkbox") ok = fillRadioOrCheckbox(field.elements, value, field.type);
    else ok = fillText(field.el, value);
    if (ok) highlight(field.elements || field.el, level || "high");
    else if (field.required) highlight(field.elements || field.el, "low");
    return ok;
  }

  function ensurePanel() {
    let panel = document.getElementById("local-ats-panel");
    if (panel && panel.dataset.atsBuild === BUILD) return panel;
    if (panel) panel.remove();
    panel = document.createElement("div");
    panel.id = "local-ats-panel";
    panel.dataset.atsBuild = BUILD;
    panel.innerHTML = `
      <div class="ats-head"><strong>Local ATS</strong>
        <button type="button" data-ats-action="close">×</button></div>
      <div class="ats-body">
        <div class="ats-status">Ready</div>
        <div class="ats-stats"></div>
        <div class="ats-actions">
          <button type="button" data-ats-action="fill">Fill form</button>
          <button type="button" data-ats-action="teach" class="secondary">Teach unanswered</button>
        </div>
        <div class="ats-actions">
          <button type="button" data-ats-action="clear" class="secondary">Clear highlights</button>
        </div>
        <div id="ats-ask" class="ats-ask" hidden></div>
        <p class="ats-hint">After Fill, unanswered fields are asked one by one so you can teach the profile.</p>
      </div>`;
    document.documentElement.appendChild(panel);
    return panel;
  }

  function showPanel() {
    ensurePanel().classList.add("open");
  }

  function setStatus(text) {
    const el = document.querySelector("#local-ats-panel .ats-status");
    if (el) el.textContent = text;
  }

  function setStats(s) {
    const el = document.querySelector("#local-ats-panel .ats-stats");
    if (!el) return;
    el.innerHTML = `
      <span>Filled <b>${s.filled || 0}</b>/${s.total || 0}</span>
      <span>Memory <b>${s.memory || 0}</b></span>
      <span>LLM <b>${s.llm || 0}</b></span>
      <span>Left <b>${s.skipped || 0}</b></span>
      ${s.resume ? `<span class="ats-wide">Resume <b>${s.resume}</b></span>` : ""}`;
  }

  function clearAskForm() {
    const box = document.querySelector("#ats-ask");
    if (!box) return;
    box.hidden = true;
    box.innerHTML = "";
  }

  function renderAskForm(questions, onSubmit) {
    const box = document.querySelector("#ats-ask");
    if (!box) return;
    if (!questions?.length) {
      clearAskForm();
      return;
    }

    const collected = [];
    let idx = 0;

    function escapeAttr(s) {
      return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    }

    function renderOne() {
      const q = questions[idx];
      const isLast = idx >= questions.length - 1;
      const multi = isMultiSelectQuestion(q.label, q.type) || q.multi;
      box.hidden = false;

      let controlHtml = "";
      if (q.options?.length && multi) {
        controlHtml = `<div class="ats-ask-options">${q.options
          .map(
            (o, i) =>
              `<label class="ats-ask-check"><input type="checkbox" data-opt="${i}" value="${escapeAttr(o)}" /> <span>${escapeAttr(o)}</span></label>`
          )
          .join("")}</div>
          <p class="ats-ask-note">Select all that apply</p>`;
      } else if (q.options?.length) {
        controlHtml = `<select><option value="">Select…</option>${q.options
          .map((o) => `<option value="${escapeAttr(o)}">${escapeAttr(o)}</option>`)
          .join("")}</select>`;
      } else if (q.type === "textarea") {
        controlHtml = `<textarea rows="4" placeholder="Your answer"></textarea>`;
      } else {
        controlHtml = `<input type="text" placeholder="Your answer" />`;
      }

      box.innerHTML = `
        <div class="ats-ask-title">Question ${idx + 1} of ${questions.length}</div>
        <div class="ats-ask-progress"><div style="width:${(idx / questions.length) * 100}%"></div></div>
        <div class="ats-ask-row" data-id="${q.id}">
          <label>${q.required ? "* " : ""}${escapeAttr(q.label || "(untitled)")}</label>
          ${controlHtml}
        </div>
        <div class="ats-ask-nav">
          <button type="button" class="ats-ask-skip secondary">Skip</button>
          <button type="button" class="ats-ask-next">${isLast ? "Save all to profile" : "Next"}</button>
        </div>`;

      const readValue = () => {
        if (multi && q.options?.length) {
          return [...box.querySelectorAll(".ats-ask-check input:checked")]
            .map((c) => c.value)
            .filter(Boolean)
            .join("|||");
        }
        const control = box.querySelector("input[type='text'], textarea, select");
        return (control?.value || "").trim();
      };

      const commit = (value, advance) => {
        if (value) collected.push({ id: q.id, value });
        if (advance) {
          if (isLast) onSubmit(collected);
          else {
            idx += 1;
            renderOne();
          }
        }
      };

      box.querySelector(".ats-ask-next").onclick = () => {
        const value = readValue();
        if (!value && q.required) {
          setStatus("This question looks required — pick an answer or Skip.");
          return;
        }
        commit(value, true);
      };
      box.querySelector(".ats-ask-skip").onclick = () => commit("", true);
    }

    renderOne();
  }

  function isEmpty(field) {
    if (field.type === "file") return !(field.el.files && field.el.files.length);
    if (field.type === "select" || field.type === "multiselect") {
      if (field.el.multiple) return ![...field.el.options].some((o) => o.selected && o.value);
      return !field.el.value;
    }
    if (field.type === "yesno") {
      // Ashby marks the chosen Yes/No button with an _active_ class.
      // Do NOT use checkbox.checked alone — "No" leaves it unchecked.
      return !(field.elements || []).some(isYesNoActive);
    }
    if (field.type === "radio" || field.type === "checkbox") {
      return ![...(field.elements || [])].some(
        (e) => e.checked || e.getAttribute?.("aria-checked") === "true" || isYesNoActive(e)
      );
    }
    return !String(field.el.value || "").trim();
  }

  function levelFromConfidence(c, source) {
    if (source === "memory") return "memory";
    if (c >= 0.85) return "high";
    if (c >= 0.55) return "medium";
    return "low";
  }

  let running = false;
  let lastFieldMap = new Map();
  let lastAts = "generic";

  function toAskQuestion(field) {
    return {
      id: field.id,
      label: field.label,
      type: field.type === "textarea" ? "textarea" : field.type,
      options: field.options || [],
      required: field.required,
      multi: !!field.multi || isMultiSelectQuestion(field.label, field.type)
    };
  }

  function startTeaching(fields, ats, reason) {
    const list = fields
      .filter((f) => f.type !== "file")
      .map(toAskQuestion);
    list.sort((a, b) => Number(b.required) - Number(a.required));
    const toAsk = list.slice(0, 30);
    if (!toAsk.length) {
      setStatus(reason || "Nothing to teach — no fields detected.");
      return;
    }
    for (const field of fields) {
      if (field.type !== "file") highlight(field.elements || field.el, "low");
    }
    const preview = toAsk
      .slice(0, 3)
      .map((q) => q.label)
      .join(" · ");
    setStatus(`Teach mode: ${toAsk.length} question(s). First: ${preview}`);
    showPanel();
    renderAskForm(toAsk, async (answers) => {
      const entries = [];
      let n = 0;
      for (const ans of answers) {
        const field = lastFieldMap.get(ans.id);
        if (!field) continue;
        let value = ans.value;
        if (field.options?.length && field.type !== "checkbox" && field.type !== "multiselect") {
          value = pickOption(ans.value, field.options) || ans.value;
        }
        if (fillField(field, value, "memory")) n += 1;
        entries.push({ question: field.label, answer: ans.value, fieldType: field.type, ats });
      }
      if (entries.length) {
        await chrome.runtime.sendMessage({ type: "SAVE_MEMORY_BATCH", entries });
        await chrome.runtime.sendMessage({ type: "SAVE_LEARNED_ANSWERS", entries });
      }
      clearAskForm();
      setStatus(`Saved ${entries.length} answer(s) to answers.json, filled ${n} fields.`);
    });
    // Make sure the question UI is visible inside the floating panel
    requestAnimationFrame(() => {
      const panel = document.getElementById("local-ats-panel");
      const ask = document.querySelector("#ats-ask");
      if (panel) panel.scrollTop = Math.max(0, (ask?.offsetTop || 0) - 8);
      ask?.scrollIntoView?.({ block: "nearest" });
    });
  }

  async function fetchResumeFile() {
    const res = await chrome.runtime.sendMessage({ type: "GET_RESUME" });
    if (!res?.ok) return { ok: false, error: res?.error || "resume missing" };
    const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], res.fileName || "resume.pdf", { type: res.mimeType || "application/pdf" });
    return { ok: true, file, fileName: res.fileName };
  }

  async function runFill() {
    if (running) return;
    running = true;
    showPanel();
    clearAskForm();
    setStatus("Syncing your data folder…");
    try {
      const sync = await chrome.runtime.sendMessage({ type: "SYNC_FROM_DATA_SERVER" });
      if (!sync?.ok) setStatus(`Sync failed (${sync?.error || "data-server?"}). Using cache.`);

      const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      if (!state?.ok) throw new Error(state?.error || "state failed");
      const facts = profileFacts(state.profile);
      const pageSalaryMin = extractSalaryMinFromPage();
      if (pageSalaryMin) {
        facts.desired_salary = pageSalaryMin;
        setStatus(`Detected posted pay range — using min $${pageSalaryMin} for salary questions.`);
      }
      const memory = state.memory || [];
      const settings = state.settings || {};
      const ats = detectAts();
      lastAts = ats;
      const job = extractJobContext();
      if (pageSalaryMin) job.salaryMinFromPage = pageSalaryMin;

      // Ashby fields can mount late
      let fields = scanFields();
      for (let i = 0; i < 4 && fields.length < 3; i++) {
        await new Promise((r) => setTimeout(r, 250));
        fields = scanFields();
      }
      lastFieldMap = new Map(fields.map((f) => [f.id, f]));

      if (!fields.length) {
        setStatus("No fillable fields found. Scroll the form into view, then Fill or Teach.");
        setStats({ total: 0, filled: 0, memory: 0, llm: 0, skipped: 0 });
        return;
      }

      clearHighlights();
      let filled = 0;
      let memoryHits = 0;
      let llmHits = 0;
      const pending = [];
      const learned = [];
      const resolvedIds = new Set();

      setStatus("Uploading resume…");
      const fileFields = fields.filter((f) => f.type === "file");
      let resumeLabel = "no file field";
      if (fileFields.length) {
        const resume = await fetchResumeFile();
        if (resume.ok) {
          let n = 0;
          for (const f of fileFields) {
            if (fillFile(f.el, resume.file)) {
              n += 1;
              resolvedIds.add(f.id);
            }
          }
          filled += n;
          resumeLabel = n ? `uploaded ${resume.fileName}` : "upload failed";
        } else resumeLabel = "missing in data/me";
      }

      setStatus(`Pass 1: local rules (${fields.length} fields)…`);
      for (const field of fields) {
        if (field.type === "file") continue;

        let handled = false;
        const mem = findMemoryAnswer(memory, field.label);
        if (mem?.answer) {
          let value = mem.answer;
          if (field.options?.length && field.type !== "checkbox" && field.type !== "multiselect") {
            value = pickOption(mem.answer, field.options) || mem.answer;
          }
          if (fillField(field, value, "memory") && !isEmpty(field)) {
            filled += 1;
            memoryHits += 1;
            resolvedIds.add(field.id);
            handled = true;
          }
        }

        if (!handled) {
          const mapped = mapFieldLocally(field.label, facts, field.options);
          if (mapped?.value && (mapped.confidence || 0) >= 0.8) {
            if (fillField(field, mapped.value, levelFromConfidence(mapped.confidence, "rule")) && !isEmpty(field)) {
              filled += 1;
              resolvedIds.add(field.id);
              handled = true;
            }
          }
        }

        if (!handled) {
          pending.push({
            id: field.id,
            label: field.label,
            type: field.type,
            required: field.required,
            options: field.options || [],
            multi: !!field.multi
          });
        }
      }

      if (pending.length && settings.llmProvider !== "off") {
        setStatus(`Pass 2: LLM for ${pending.length} fields (max 15s)…`);
        try {
          const llmRes = await Promise.race([
            chrome.runtime.sendMessage({
              type: "LLM_FILL",
              payload: { fields: pending, facts, job, ats, settings }
            }),
            new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "LLM timeout" }), 15000))
          ]);
          if (llmRes?.ok) {
            const byId = Object.fromEntries((llmRes.answers || []).map((a) => [a.id, a]));
            for (const field of fields) {
              if (field.type === "file" || resolvedIds.has(field.id)) continue;
              const ans = byId[field.id];
              if (!ans?.value) continue;
              let value = ans.value;
              if (field.options?.length && field.type !== "checkbox" && field.type !== "multiselect") {
                value = pickOption(ans.value, field.options) || ans.value;
              }
              if (fillField(field, value, levelFromConfidence(ans.confidence ?? 0.7, "llm")) && !isEmpty(field)) {
                filled += 1;
                llmHits += 1;
                resolvedIds.add(field.id);
                learned.push({ question: field.label, answer: String(ans.value), fieldType: field.type, ats });
              }
            }
          } else {
            setStatus(`LLM skipped: ${llmRes?.error || "unknown"}. Asking you the rest…`);
          }
        } catch (llmErr) {
          setStatus(`LLM error: ${llmErr.message || llmErr}. Asking you the rest…`);
        }
      }

      if (learned.length) {
        await chrome.runtime.sendMessage({ type: "SAVE_MEMORY_BATCH", entries: learned });
        await chrome.runtime.sendMessage({ type: "SAVE_LEARNED_ANSWERS", entries: learned });
      }

      const unresolved = fields.filter((f) => f.type !== "file" && !resolvedIds.has(f.id));
      for (const field of unresolved) highlight(field.elements || field.el, "low");

      const yesNoCount = fields.filter((f) => f.type === "yesno").length;
      setStats({
        filled,
        memory: memoryHits,
        llm: llmHits,
        skipped: unresolved.length,
        total: fields.length,
        resume: resumeLabel
      });

      // Always open teach UI for anything still blank — do not wait for another click.
      if (unresolved.length) {
        setStatus(
          `Filled ${filled}/${fields.length} (yes/no detected: ${yesNoCount}). Asking ${unresolved.length} unanswered…`
        );
        startTeaching(unresolved, ats, "");
      } else {
        setStatus(`Done — filled ${filled}/${fields.length} (yes/no: ${yesNoCount}).`);
      }
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message || err}`);
    } finally {
      running = false;
    }
  }

  function runTeachOnly() {
    showPanel();
    const fields = scanFields();
    lastFieldMap = new Map(fields.map((f) => [f.id, f]));
    const unanswered = fields.filter((f) => f.type !== "file" && isEmpty(f));
    // Prefer blank fields; if none blank, still offer required / yesno / everything
    let target = unanswered;
    if (!target.length) {
      target = fields.filter((f) => f.type === "yesno" || f.required);
    }
    if (!target.length) {
      target = fields.filter((f) => f.type !== "file");
    }
    const yesNo = fields.filter((f) => f.type === "yesno");
    setStatus(
      `Scan: ${fields.length} fields, ${yesNo.length} yes/no, ${unanswered.length} blank. Opening teach…`
    );
    startTeaching(target, detectAts(), "Teach mode");
  }

  function bindPanel() {
    ensurePanel().addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ats-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-ats-action");
      if (action === "close") document.getElementById("local-ats-panel")?.classList.remove("open");
      if (action === "fill") runFill();
      if (action === "teach") runTeachOnly();
      if (action === "clear") {
        clearHighlights();
        clearAskForm();
        setStatus("Highlights cleared.");
      }
    });
  }

  if (window.__localAtsMessageHandler) {
    try {
      chrome.runtime.onMessage.removeListener(window.__localAtsMessageHandler);
    } catch (_) {}
  }
  window.__localAtsMessageHandler = (msg, _sender, sendResponse) => {
    if (msg?.type === "PING") {
      sendResponse({ ok: true, ats: detectAts(), href: location.href, build: BUILD });
      return true;
    }
    if (msg?.type === "RUN_FILL") {
      runFill()
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg?.type === "RUN_TEACH") {
      try {
        runTeachOnly();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
    if (msg?.type === "SHOW_PANEL") {
      showPanel();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(window.__localAtsMessageHandler);

  bindPanel();
  showPanel();
  setStatus(`Detected: ${detectAts()} (build ${BUILD}). Click Fill — I will ask what I cannot answer.`);
})();
