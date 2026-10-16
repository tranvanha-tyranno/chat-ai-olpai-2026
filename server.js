import http from "node:http";
import { readFile, writeFile, mkdir, rename, copyFile, open } from "node:fs/promises";
import { extname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import crypto from "node:crypto";
import { DEFAULT_MODEL_ID, findModel, MODEL_PROVIDERS } from "./public/config/models.js";
import { normalizeResponse } from "./lib/response.js";
import { TOKEN_LIMIT, MIN_TOKEN_LIMIT, MAX_TOKEN_LIMIT, validTokenLimit, estimateMessages, chatMessages } from "./public/tokens.js";
import { tokenUsage } from "./lib/usage.js";
import { modelAvailability } from "./lib/model-availability.js";
import { providerError } from "./lib/openrouter-error.js";
import { PROVIDER_APIS } from "./lib/providers.js";
import { createEnvLoader } from "./lib/env.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

const envLoader = await createEnvLoader(process.env.APP_ENV_FILE || join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 8787);
const pendingSessions = new Set();
const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");
const USERS_FILE = join(DATA_DIR, "users.json");
const DEFAULT_USERS = {
  Tyranno: { id: "Tyranno", createdAt: new Date().toISOString(), sessions: [] },
  hoaibao: { id: "hoaibao", createdAt: new Date().toISOString(), sessions: [] },
};
let users = {};

try {
  users = JSON.parse(await readFile(USERS_FILE, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  users = structuredClone(DEFAULT_USERS);
}
for (const user of Object.values(DEFAULT_USERS)) {
  if (!users[user.id]) users[user.id] = user;
}

// Preserve the previous single-conversation format as an existing session.
const legacyData = Object.values(users).some((user) => "messages" in user);
if (legacyData) await copyFile(USERS_FILE, join(DATA_DIR, "users.before-sessions.json"));
for (const user of Object.values(users)) {
  user.sessions ||= [];
  for (const session of user.sessions) session.tokenLimit ||= TOKEN_LIMIT;
  if (user.messages?.length) {
    const session = createSession(user.messages, Number(user.usedTokens) || 0);
    user.sessions.push(session);
    user.activeSessionId = session.id;
  }
  delete user.messages;
  delete user.usedTokens;
}

function findUser(value) {
  const id = String(value || "").trim();
  return Object.values(users).find((user) => user.id.toLowerCase() === id.toLowerCase());
}

let saveQueue = Promise.resolve();
function saveUsers() {
  const snapshot = JSON.stringify(users, null, 2);
  const write = saveQueue.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const temporary = join(DATA_DIR, "users.json.tmp");
    await writeFile(temporary, snapshot, "utf8");
    await rename(temporary, USERS_FILE);
  });
  saveQueue = write.catch(() => {});
  return write;
}

function createSession(messages = [], usedTokens = 0, tokenLimit = TOKEN_LIMIT) {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: messages.find((m) => m.role === "user")?.content.trim().slice(0, 60) || "Cuộc trò chuyện mới", createdAt: now, updatedAt: now, messages, usedTokens, tokenLimit };
}

function userState(user) {
  return {
    user: { id: user.id },
    providers: providerStatus(),
    sessions: [...user.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ messages, ...session }) => ({ ...session, messageCount: messages.length })),
    session: user.sessions.find((session) => session.id === user.activeSessionId) || null,
  };
}

await saveUsers();

function providerStatus() {
  return Object.fromEntries(Object.keys(MODEL_PROVIDERS).map((provider) => [provider, { configured: Boolean(envLoader.apiKey(provider)), source: ".env" }]));
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

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
  await envLoader.reloadCredentials();
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "Dữ liệu đăng nhập không hợp lệ." });
  }
  const user = findUser(payload?.userId);
  if (!user) return json(res, 401, { error: "Mã ID không tồn tại. Hãy dùng Tyranno hoặc hoaibao." });
  return json(res, 200, userState(user));
}

async function handleSession(req, res, select = false) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "Dữ liệu không hợp lệ." });
  }
  const user = findUser(payload?.userId);
  if (!user) return json(res, 401, { error: "Mã ID không hợp lệ." });
  let session;
  if (select) {
    session = user.sessions.find((item) => item.id === payload.sessionId);
    if (!session) return json(res, 404, { error: "Không tìm thấy phiên chat của mã ID này." });
  } else {
    const tokenLimit = payload.tokenLimit ?? TOKEN_LIMIT;
    if (!validTokenLimit(tokenLimit)) return json(res, 400, { error: `Ngân sách phải là số nguyên từ ${MIN_TOKEN_LIMIT} đến ${MAX_TOKEN_LIMIT} token.` });
    session = createSession([], 0, tokenLimit);
    user.sessions.push(session);
  }
  user.activeSessionId = session.id;
  await saveUsers();
  return json(res, 200, userState(user));
}

async function handleChat(req, res) {
  await envLoader.reloadCredentials();
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "Dữ liệu gửi lên không hợp lệ." });
  }

  if (!payload || typeof payload !== "object") return json(res, 400, { error: "Dữ liệu gửi lên không hợp lệ." });
  const sessionId = payload.sessionId;
  const user = findUser(payload.userId);
  if (!user) return json(res, 401, { error: "Mã ID không hợp lệ hoặc phiên đăng nhập đã hết." });
  const session = user.sessions.find((item) => item.id === sessionId);
  if (!session) return json(res, 404, { error: "Không tìm thấy phiên chat của mã ID này." });
  if (typeof payload.content !== "string" || !payload.content.trim() || payload.content.length > 12000) {
    return json(res, 400, { error: "Tin nhắn phải có từ 1 đến 12.000 ký tự." });
  }
  const modelId = payload.modelId ?? DEFAULT_MODEL_ID;
  const provider = payload.provider ?? "openrouter";
  if (!Object.hasOwn(MODEL_PROVIDERS, provider) || !findModel(modelId, provider)) return json(res, 400, { error: "Model hoặc nhà cung cấp không hợp lệ. Hãy chọn lại trong Cài đặt." });
  const providerLabel = MODEL_PROVIDERS[provider].label;
  const apiKey = envLoader.apiKey(provider);
  if (!apiKey) return json(res, 400, {
    code: "API_KEY_REQUIRED", provider,
    error: `Hãy cấu hình ${provider === "groq" ? "GROQ_API_KEY" : "OPENROUTER_API_KEY"} trong file .env trước khi gửi tin nhắn.`,
  });
  if (pendingSessions.has(sessionId)) return json(res, 409, { error: "Phiên chat đang chờ phản hồi. Hãy thử lại sau." });
  const userMessage = { role: "user", content: payload.content.trim(), createdAt: new Date().toISOString() };
  const messages = chatMessages(session.messages, userMessage.content);
  const inputTokens = estimateMessages(messages);
  const tokenLimit = session.tokenLimit || TOKEN_LIMIT;
  const remainingBeforeRequest = tokenLimit - session.usedTokens;
  if (remainingBeforeRequest <= inputTokens) {
    return json(res, 429, {
      error: `Phiên chat không đủ ngân sách ${tokenLimit.toLocaleString("vi-VN")} token. Hãy tăng ngân sách hoặc tạo phiên mới.`,
      usage: { used: session.usedTokens, limit: tokenLimit, remaining: Math.max(0, remainingBeforeRequest) },
      sessionId,
    });
  }

  const maxTokens = Math.max(1, remainingBeforeRequest - inputTokens);
  const requestBody = {
    model: modelId,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
    stream: false,
  };

  let upstream;
  const startedAt = performance.now();
  pendingSessions.add(sessionId);
  try {
    try {
      const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
      if (provider === "openrouter") {
        headers["http-referer"] = process.env.APP_URL || `http://localhost:${PORT}`;
        headers["x-title"] = "Qwen Chat Room";
      }
      upstream = await fetch(PROVIDER_APIS[provider].chat, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      return json(res, 502, { error: `Không kết nối được ${providerLabel}. Vui lòng thử lại sau.` });
    }

    const responseText = await upstream.text();
    let responseBody;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = {};
    }
    if (!upstream.ok) {
      return json(res, upstream.status, providerError(responseBody?.error?.message, modelId, provider, upstream.status, responseBody?.error?.code));
    }

    const result = normalizeResponse(responseBody?.choices?.[0]);
    if (!result.content) return json(res, 502, { error: "Model không trả về nội dung." });
    const assistantMessage = {
      role: "assistant", ...result, modelId, provider,
      responseTimeMs: Math.round(performance.now() - startedAt),
      createdAt: new Date().toISOString(),
      tokenUsage: tokenUsage(responseBody.usage || {}, inputTokens, result.content + result.reasoning),
    };

    const billedTokens = assistantMessage.tokenUsage.totalTokens;
    session.usedTokens = Math.min(tokenLimit, session.usedTokens + billedTokens);
    session.messages.push(userMessage, assistantMessage);
    session.title = session.messages.find((message) => message.role === "user").content.slice(0, 60);
    session.updatedAt = new Date().toISOString();
    await saveUsers();

    return json(res, 200, {
      message: assistantMessage,
      model: modelId,
      provider,
      sessionId,
      ...userState(user),
      session,
      usage: {
        used: session.usedTokens,
        limit: tokenLimit,
        remaining: Math.max(0, tokenLimit - session.usedTokens),
        request: billedTokens,
        ...assistantMessage.tokenUsage,
      },
    });
  } finally {
    pendingSessions.delete(sessionId);
  }
}

async function handleModels(req, res) {
  await envLoader.reloadCredentials();
  const userId = new URL(req.url, "http://localhost").searchParams.get("userId");
  if (!userId) return json(res, 200, { ...await modelAvailability(), providers: providerStatus() });
  const user = findUser(userId);
  if (!user) return json(res, 401, { error: "Mã ID không hợp lệ." });
  const [openrouter, groq] = await Promise.all([modelAvailability(), modelAvailability("groq", envLoader.apiKey("groq"))]);
  return json(res, 200, {
    models: [...openrouter.models, ...groq.models],
    providers: { ...providerStatus(), groq: { ...providerStatus().groq, keyRejected: Boolean(groq.keyRejected), checkedAt: groq.checkedAt } },
  });
}

async function handleSessionBudget(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch { return json(res, 400, { error: "Dữ liệu không hợp lệ." }); }
  const user = findUser(payload?.userId);
  if (!user) return json(res, 401, { error: "Mã ID không hợp lệ." });
  const session = user.sessions.find((item) => item.id === payload.sessionId);
  if (!session) return json(res, 404, { error: "Không tìm thấy phiên chat của mã ID này." });
  if (pendingSessions.has(session.id)) return json(res, 409, { error: "Hãy chờ phản hồi hoàn tất trước khi đổi ngân sách." });
  if (!validTokenLimit(payload.tokenLimit) || payload.tokenLimit < session.usedTokens) {
    return json(res, 400, { error: `Ngân sách phải từ ${Math.max(MIN_TOKEN_LIMIT, session.usedTokens).toLocaleString("vi-VN")} đến ${MAX_TOKEN_LIMIT.toLocaleString("vi-VN")} token và không thấp hơn số đã dùng.` });
  }
  const previous = session.tokenLimit;
  session.tokenLimit = payload.tokenLimit;
  try { await saveUsers(); } catch (error) { session.tokenLimit = previous; throw error; }
  return json(res, 200, userState(user));
}

async function handleDeleteSessions(req, res, all = false) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch { return json(res, 400, { error: "Dữ liệu không hợp lệ." }); }
  const user = findUser(payload?.userId);
  if (!user) return json(res, 401, { error: "Mã ID không hợp lệ." });
  const targets = all ? user.sessions : user.sessions.filter((session) => session.id === payload.sessionId);
  if (!all && !targets.length) return json(res, 404, { error: "Không tìm thấy phiên chat của mã ID này." });
  if (targets.some((session) => pendingSessions.has(session.id))) {
    return json(res, 409, { error: "Hãy chờ phản hồi hoàn tất trước khi xóa cuộc trò chuyện." });
  }
  const previousSessions = user.sessions;
  const previousActiveSessionId = user.activeSessionId;
  user.sessions = user.sessions.filter((session) => !targets.includes(session));
  if (!user.sessions.some((session) => session.id === user.activeSessionId)) {
    user.activeSessionId = [...user.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id || null;
  }
  try { await saveUsers(); }
  catch (error) {
    user.sessions = previousSessions;
    user.activeSessionId = previousActiveSessionId;
    throw error;
  }
  return json(res, 200, userState(user));
}

async function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.includes("\0")) throw new Error("Invalid path");
  } catch { return json(res, 400, { error: "Đường dẫn không hợp lệ." }); }
  const requested = pathname === "/" ? "/index.html" : pathname;
  const vendors = new Map([
    ["/vendor/marked.js", join(ROOT, "node_modules/marked/lib/marked.esm.js")],
    ["/vendor/purify.js", join(ROOT, "node_modules/dompurify/dist/purify.es.mjs")],
    ["/vendor/highlight.js", join(ROOT, "node_modules/@highlightjs/cdn-assets/es/highlight.min.js")],
  ]);
  const publicRoot = join(ROOT, "public");
  const filePath = vendors.get(requested) || resolve(publicRoot, `.${requested}`);
  const relativePath = relative(publicRoot, filePath);
  if (!vendors.has(requested) && (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))) {
    return json(res, 404, { error: "Không tìm thấy trang." });
  }
  let file;
  try {
    file = await open(filePath, "r");
    if (!(await file.stat()).isFile()) return json(res, 404, { error: "Không tìm thấy trang." });
    res.writeHead(200, {
      "content-type": vendors.has(requested) ? mimeTypes[".js"] : mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    // Await the stream so read errors are handled instead of crashing the process.
    await pipeline(file.createReadStream(), res);
  } catch (error) {
    if (!res.headersSent && ["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code)) {
      return json(res, 404, { error: "Không tìm thấy trang." });
    }
    if (!res.headersSent && ["EACCES", "EPERM"].includes(error.code)) {
      return json(res, 403, { error: "Không thể truy cập file." });
    }
    if (error.code !== "ERR_STREAM_PREMATURE_CLOSE") throw error;
  } finally { await file?.close(); }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      return res.end();
    }
    if (req.method === "POST" && req.url === "/api/auth/login") return await handleLogin(req, res);
    if (req.method === "POST" && req.url === "/api/sessions") return await handleSession(req, res);
    if (req.method === "POST" && req.url === "/api/sessions/select") return await handleSession(req, res, true);
    if (req.method === "POST" && req.url === "/api/sessions/budget") return await handleSessionBudget(req, res);
    if (req.method === "POST" && req.url === "/api/sessions/delete") return await handleDeleteSessions(req, res);
    if (req.method === "POST" && req.url === "/api/sessions/clear") return await handleDeleteSessions(req, res, true);
    if (req.method === "POST" && req.url === "/api/chat") return await handleChat(req, res);
    if (req.method === "GET" && new URL(req.url, "http://localhost").pathname === "/api/models") return await handleModels(req, res);
    if (req.method === "GET") return await serveStatic(req, res);
    return json(res, 405, { error: "Method không được hỗ trợ." });
  } catch (error) {
    console.error("Request failed:", error.message);
    if (!res.headersSent) json(res, 500, { error: "Không thể xử lý hoặc lưu dữ liệu. Vui lòng thử lại." });
    else res.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Qwen Chat Room đang chạy tại http://localhost:${server.address().port}`);
});

export default server;
