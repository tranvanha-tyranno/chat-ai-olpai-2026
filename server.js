import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

// Keep setup dependency-free while still supporting the familiar .env workflow.
try {
  const envFile = await readFile(join(ROOT, ".env"), "utf8");
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
} catch {
  // .env is optional; deployment environments can provide process variables directly.
}

const PORT = Number(process.env.PORT || 8787);
const MODEL = "qwen/qwen3-32b";
const TOKEN_LIMIT = 3000;
const sessions = new Map();
const DATA_DIR = join(ROOT, "data");
const USERS_FILE = join(DATA_DIR, "users.json");
const DEFAULT_USERS = {
  Tyranno: { id: "Tyranno", createdAt: new Date().toISOString(), messages: [], usedTokens: 0 },
  hoaibao: { id: "hoaibao", createdAt: new Date().toISOString(), messages: [], usedTokens: 0 },
};
let users = {};

try {
  users = JSON.parse(await readFile(USERS_FILE, "utf8"));
} catch {
  users = DEFAULT_USERS;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}
for (const user of Object.values(DEFAULT_USERS)) {
  if (!users[user.id]) users[user.id] = user;
}

function findUser(value) {
  const id = String(value || "").trim();
  return Object.values(users).find((user) => user.id.toLowerCase() === id.toLowerCase());
}

async function saveUsers() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function estimateTokens(value = "") {
  // A conservative estimate used before OpenRouter returns exact usage.
  return Math.max(1, Math.ceil(String(value).length / 4));
}

function estimateMessages(messages = []) {
  return messages.reduce((total, message) => total + estimateTokens(message.content) + 4, 0);
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error("Payload too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function handleLogin(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "Dữ liệu đăng nhập không hợp lệ." });
  }
  const user = findUser(payload?.userId);
  if (!user) return json(res, 401, { error: "Mã ID không tồn tại. Hãy dùng Tyranno hoặc hoaibao." });
  return json(res, 200, {
    user: { id: user.id },
    messages: user.messages || [],
    usage: { used: Number(user.usedTokens) || 0, limit: TOKEN_LIMIT },
  });
}

async function handleReset(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "Dữ liệu không hợp lệ." });
  }
  const user = findUser(payload?.userId);
  if (!user) return json(res, 401, { error: "Mã ID không hợp lệ." });
  if (payload.sessionId) sessions.delete(payload.sessionId);
  user.messages = [];
  user.usedTokens = 0;
  await saveUsers();
  return json(res, 200, { ok: true, usage: { used: 0, limit: TOKEN_LIMIT } });
}

async function handleChat(req, res) {
  if (!process.env.OPENROUTER_API_KEY) {
    return json(res, 500, { error: "Chưa cấu hình OPENROUTER_API_KEY trong file .env." });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "Dữ liệu gửi lên không hợp lệ." });
  }

  const sessionId = typeof payload.sessionId === "string" && payload.sessionId.length < 100
    ? payload.sessionId
    : crypto.randomUUID();
  const user = findUser(payload.userId);
  if (!user) return json(res, 401, { error: "Mã ID không hợp lệ hoặc phiên đăng nhập đã hết." });
  const messages = Array.isArray(payload.messages)
    ? payload.messages.filter((message) =>
        message && ["user", "assistant", "system"].includes(message.role) &&
        typeof message.content === "string" && message.content.trim(),
      ).slice(-30)
    : [];

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json(res, 400, { error: "Tin nhắn cuối cùng phải là tin nhắn của người dùng." });
  }

  const currentSession = sessions.get(sessionId);
  if (currentSession && currentSession.userId !== user.id) return json(res, 403, { error: "Phiên chat không thuộc mã ID này." });
  const session = currentSession || { userId: user.id, usedTokens: Number(user.usedTokens) || 0, createdAt: Date.now() };
  const inputTokens = estimateMessages(messages);
  const remainingBeforeRequest = TOKEN_LIMIT - session.usedTokens;
  if (remainingBeforeRequest <= inputTokens) {
    return json(res, 429, {
      error: "Phiên chat đã hết ngân sách 3.000 token. Hãy bắt đầu phiên mới để tiếp tục.",
      usage: { used: session.usedTokens, limit: TOKEN_LIMIT, remaining: 0 },
      sessionId,
    });
  }

  const maxTokens = Math.max(1, remainingBeforeRequest - inputTokens);
  const requestBody = {
    model: MODEL,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
    stream: false,
  };

  let upstream;
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "http-referer": process.env.APP_URL || `http://localhost:${PORT}`,
        "x-title": "Qwen Chat Room",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    return json(res, 502, { error: `Không kết nối được OpenRouter: ${error.message}` });
  }

  const responseText = await upstream.text();
  let responseBody;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    responseBody = {};
  }
  if (!upstream.ok) {
    return json(res, upstream.status, {
      error: responseBody?.error?.message || "OpenRouter trả về lỗi khi tạo phản hồi.",
    });
  }

  const assistant = responseBody?.choices?.[0]?.message?.content?.trim();
  if (!assistant) return json(res, 502, { error: "Model không trả về nội dung." });

  const usage = responseBody.usage || {};
  const billedTokens = Number(usage.total_tokens) || inputTokens + estimateTokens(assistant);
  session.usedTokens = Math.min(TOKEN_LIMIT, session.usedTokens + billedTokens);
  sessions.set(sessionId, session);
  user.messages = [...messages, { role: "assistant", content: assistant }].slice(-60);
  user.usedTokens = session.usedTokens;
  await saveUsers();

  return json(res, 200, {
    message: { role: "assistant", content: assistant },
    model: MODEL,
    sessionId,
    usage: {
      used: session.usedTokens,
      limit: TOKEN_LIMIT,
      remaining: Math.max(0, TOKEN_LIMIT - session.usedTokens),
      request: billedTokens,
    },
  });
}

async function serveStatic(req, res) {
  const requested = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const safePath = normalize(requested).replace(/^([.][.][/\\])+/, "");
  const filePath = join(ROOT, "public", safePath);
  if (!filePath.startsWith(join(ROOT, "public")) || !existsSync(filePath)) {
    return json(res, 404, { error: "Không tìm thấy trang." });
  }
  res.writeHead(200, {
    "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "cache-control": "no-cache",
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    return res.end();
  }
  if (req.method === "POST" && req.url === "/api/auth/login") return handleLogin(req, res);
  if (req.method === "POST" && req.url === "/api/auth/reset") return handleReset(req, res);
  if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
  if (req.method === "GET") return serveStatic(req, res);
  return json(res, 405, { error: "Method không được hỗ trợ." });
});

server.listen(PORT, () => {
  console.log(`Qwen Chat Room đang chạy tại http://localhost:${PORT}`);
});
