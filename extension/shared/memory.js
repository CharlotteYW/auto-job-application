export function normalizeQuestion(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function questionTokens(text) {
  const stop = new Set([
    "a", "an", "the", "is", "are", "do", "does", "did", "you", "your", "to",
    "of", "in", "on", "for", "with", "and", "or", "please", "what", "when",
    "where", "how", "will", "would", "can", "could", "if", "this", "that"
  ]);
  return normalizeQuestion(text)
    .split(" ")
    .filter((t) => t.length > 1 && !stop.has(t));
}

/** Dice coefficient on token sets. */
export function similarity(a, b) {
  const A = new Set(questionTokens(a));
  const B = new Set(questionTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}

/**
 * @param {Array<{question: string, answer: string, fieldType?: string, ats?: string, updatedAt?: number}>} memory
 * @param {string} question
 * @param {number} threshold
 */
export function findMemoryAnswer(memory, question, threshold = 0.55) {
  let best = null;
  let bestScore = 0;
  for (const entry of memory || []) {
    const score = similarity(entry.question, question);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  if (best && bestScore >= threshold) {
    return { answer: best.answer, score: bestScore, entry: best };
  }
  return null;
}

export function upsertMemory(memory, { question, answer, fieldType, ats }) {
  const list = Array.isArray(memory) ? memory.slice() : [];
  const norm = normalizeQuestion(question);
  const idx = list.findIndex((e) => normalizeQuestion(e.question) === norm);
  const entry = {
    question: String(question).trim(),
    answer: String(answer).trim(),
    fieldType: fieldType || "text",
    ats: ats || "generic",
    updatedAt: Date.now()
  };
  if (idx >= 0) list[idx] = entry;
  else list.unshift(entry);
  return list.slice(0, 500);
}
