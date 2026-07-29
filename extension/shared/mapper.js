/**
 * Heuristic label → profile fact mapping.
 * Returns { value, confidence, source } or null.
 */

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
  { keys: ["notice period", "how soon"], fact: "notice_period_days", conf: 0.8 },
  { keys: ["salary", "compensation", "expected pay", "desired pay", "pay expectation"], fact: "desired_salary", conf: 0.85 },
  { keys: ["school", "university", "college"], fact: "school", conf: 0.85 },
  { keys: ["degree"], fact: "degree", conf: 0.85 },
  { keys: ["field of study", "major", "area of study"], fact: "field_of_study", conf: 0.85 },
  { keys: ["graduation", "grad year"], fact: "graduation_year", conf: 0.8 },
  { keys: ["cover letter", "why do you want", "why are you interested", "why this role", "why this company", "tell us about yourself"], fact: "why_this_role", conf: 0.7 },
  { keys: ["additional information", "anything else", "other information"], fact: "additional_info", conf: 0.75 }
];

export function mapFieldLocally(label, facts, options = []) {
  const text = String(label || "").toLowerCase();
  if (!text.trim()) return null;

  let best = null;
  for (const rule of RULES) {
    if (rule.keys.some((k) => text.includes(k))) {
      const value = facts[rule.fact];
      if (value === undefined || value === null || value === "") continue;
      best = { value: String(value), confidence: rule.conf, source: "rule", fact: rule.fact };
      break;
    }
  }

  if (!best) return null;

  if (options && options.length) {
    const picked = pickOption(best.value, options);
    if (!picked) return { ...best, value: null, confidence: Math.min(best.confidence, 0.4), note: "no_option_match" };
    return { ...best, value: picked, confidence: best.confidence };
  }

  return best;
}

/** Pick closest option label/value for yes/no and free-text answers. */
export function pickOption(desired, options) {
  if (!desired || !options?.length) return null;
  const d = String(desired).trim().toLowerCase();
  const cleaned = options
    .map((o) => ({ raw: o, n: String(o).trim().toLowerCase() }))
    .filter((o) => o.n && o.n !== "select..." && o.n !== "please select" && o.n !== "--");

  // exact
  for (const o of cleaned) {
    if (o.n === d) return o.raw;
  }

  // yes/no families
  const yesWords = ["yes", "y", "true", "authorized", "i am authorized"];
  const noWords = ["no", "n", "false", "not", "do not", "don't"];
  const desireYes = yesWords.some((w) => d === w || d.startsWith(w + " "));
  const desireNo = noWords.some((w) => d === w || d.startsWith(w + " "));
  if (desireYes || desireNo) {
    for (const o of cleaned) {
      const isYes = /\byes\b|^y$|authorized|do not need|no sponsorship|without sponsorship/i.test(o.n) && !/not authorized|need sponsorship|require sponsorship/i.test(o.n);
      const isNo = /\bno\b|^n$|not authorized|need sponsorship|require sponsorship|will require/i.test(o.n);
      if (desireYes && isYes) return o.raw;
      if (desireNo && isNo) return o.raw;
    }
  }

  // contains / starts with
  for (const o of cleaned) {
    if (o.n.includes(d) || d.includes(o.n)) return o.raw;
  }

  // token overlap
  let best = null;
  let bestScore = 0;
  const dTokens = new Set(d.split(/[^a-z0-9]+/).filter(Boolean));
  for (const o of cleaned) {
    const oTokens = o.n.split(/[^a-z0-9]+/).filter(Boolean);
    let inter = 0;
    for (const t of oTokens) if (dTokens.has(t)) inter += 1;
    const score = oTokens.length ? inter / oTokens.length : 0;
    if (score > bestScore) {
      bestScore = score;
      best = o.raw;
    }
  }
  return bestScore >= 0.4 ? best : null;
}

export function detectAts(hostname = location.hostname) {
  const h = hostname.toLowerCase();
  if (h.includes("greenhouse")) return "greenhouse";
  if (h.includes("lever")) return "lever";
  if (h.includes("ashby")) return "ashby";
  if (h.includes("workday")) return "workday";
  return "generic";
}
