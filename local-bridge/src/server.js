import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, CursorAgentError } from "@cursor/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(__dirname, "../.env"));

const PORT = Number(process.env.PORT || 3847);
const MODEL = process.env.MODEL || "composer-2.5";
const API_KEY = process.env.CURSOR_API_KEY || "";

function loadEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    const val = trimmed.slice(i + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(json);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function fillWithCursor(prompt) {
  if (!API_KEY) {
    throw new Error("CURSOR_API_KEY missing. Copy .env.example to .env and set your key.");
  }

  const result = await Agent.prompt(prompt, {
    apiKey: API_KEY,
    model: { id: MODEL },
    local: { cwd: resolve(__dirname, "../..") }
  });

  if (result.status === "error") {
    throw new Error(`Cursor agent run failed (${result.id || "unknown"})`);
  }

  return result.result || "";
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return send(res, 204, {});
  }

  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, {
      ok: true,
      model: MODEL,
      hasApiKey: Boolean(API_KEY)
    });
  }

  if (req.method === "POST" && req.url === "/fill") {
    try {
      const body = await readJson(req);
      const prompt = body.prompt || body.message;
      if (!prompt) return send(res, 400, { error: "prompt required" });
      const text = await fillWithCursor(String(prompt));
      return send(res, 200, { text });
    } catch (err) {
      const message = err instanceof CursorAgentError
        ? `Cursor startup error: ${err.message}`
        : err.message || String(err);
      return send(res, 500, { error: message });
    }
  }

  return send(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local ATS Cursor bridge on http://127.0.0.1:${PORT}`);
  console.log(`Model: ${MODEL}`);
  console.log(`API key: ${API_KEY ? "set" : "MISSING"}`);
});
