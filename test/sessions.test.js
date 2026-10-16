import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { OPENROUTER_MODELS, DEFAULT_MODEL_ID } from "../public/config/models.js";

test("sessions survive creation, switching accounts and server restarts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "qwen-session-test-"));
  const originalFetch = globalThis.fetch;
  const previousEnv = { PORT: process.env.PORT, DATA_DIR: process.env.DATA_DIR, APP_ENV_FILE: process.env.APP_ENV_FILE, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };
  let server;
  let base;
  let upstreamFails = false;
  let upstreamError = "upstream test failure";
  let upstreamErrorStatus = 503;
  let upstreamMessage = { content: "Phản hồi kiểm thử" };
  let upstreamUsage = { total_tokens: 5 };
  let responseGate = null;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      requests.push(JSON.parse(options.body));
      if (responseGate) { responseGate.enter(); await responseGate.wait; }
      return upstreamFails
        ? Response.json({ error: { message: upstreamError } }, { status: upstreamErrorStatus })
        : Response.json({ choices: [{ message: upstreamMessage }], usage: upstreamUsage });
    }
    if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: OPENROUTER_MODELS.map(({ id }) => ({ id })) });
    return originalFetch(url, options);
  };
  process.env.PORT = "0";
  process.env.DATA_DIR = directory;
  process.env.OPENROUTER_API_KEY = "test-only-key";
  process.env.APP_ENV_FILE = join(directory, ".env");
  await writeFile(process.env.APP_ENV_FILE, "OPENROUTER_API_KEY=test-only-key\n");
  t.after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });
  const start = async () => {
    ({ default: server } = await import(`../server.js?test=${crypto.randomUUID()}`));
    if (!server.listening) await once(server, "listening");
    base = `http://localhost:${server.address().port}`;
  };
  const post = async (path, body, status = 200) => {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  const legacy = {
    Tyranno: { id: "Tyranno", messages: [{ role: "user", content: "Lịch sử cũ" }, { role: "assistant", content: "Được giữ lại" }], usedTokens: 50 },
    hoaibao: { id: "hoaibao", messages: [], usedTokens: 0 },
  };
  await writeFile(join(directory, "users.json"), JSON.stringify(legacy));
  await start();
  await t.test("serves the root with query parameters and survives invalid static paths", async () => {
    const home = await fetch(`${base}/`);
    const expectedHtml = await home.text();
    assert.equal(home.status, 200);
    assert.match(expectedHtml, /<!doctype html>/i);
    for (const path of ["/?v=1", "/?", "/?cache=refresh&source=browser", "/index.html?v=1"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type"), /text\/html/);
      assert.equal(await response.text(), expectedHtml);
    }
    for (const path of ["/config", "/config/", "/missing-file.js", "/config/missing.js", "/%2e%2e%2fserver.js", "/%2e%2e%5cserver.js"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 404, path);
      assert.match((await response.json()).error, /Không tìm thấy/);
      const alive = await fetch(`${base}/?after=invalid-path`);
      assert.equal(alive.status, 200);
      await alive.text();
    }
    for (const path of ["/%ZZ", "/%00"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 400, path);
      await response.text();
    }
  });
  let firstId;
  let secondId;
  await t.test("migrates existing messages and keeps an original backup", async () => {
    const data = await post("/api/auth/login", { userId: "Tyranno" });
    assert.equal(data.sessions.length, 1);
    assert.deepEqual(data.session.messages, legacy.Tyranno.messages);
    assert.equal(data.session.usedTokens, 50);
    firstId = data.session.id;
    assert.deepEqual(JSON.parse(await readFile(join(directory, "users.before-sessions.json"), "utf8")), legacy);
  });
  await t.test("creates sessions without overwriting old history or tokens", async () => {
    const data = await post("/api/sessions", { userId: "Tyranno" });
    secondId = data.session.id;
    assert.notEqual(firstId, secondId);
    assert.equal(data.sessions.length, 2);
    assert.equal(data.session.usedTokens, 0);
    assert.equal(data.session.tokenLimit, 3000);
    const sent = await post("/api/chat", { userId: "Tyranno", sessionId: secondId, content: "Phiên thứ hai" });
    assert.equal(requests.at(-1).model, DEFAULT_MODEL_ID);
    assert.equal(sent.model, DEFAULT_MODEL_ID);
    assert.equal(sent.session.messages.length, 2);
    assert.equal(sent.session.title, "Phiên thứ hai");
    assert.equal(sent.session.usedTokens, 5);
    const first = await post("/api/sessions/select", { userId: "Tyranno", sessionId: firstId });
    assert.deepEqual(first.session.messages, legacy.Tyranno.messages);
    assert.equal(first.session.usedTokens, 50);
  });
  await t.test("isolates sessions by ID and rejects unknown sessions", async () => {
    const other = await post("/api/auth/login", { userId: "hoaibao" });
    assert.deepEqual(other.sessions, []);
    await post("/api/sessions/select", { userId: "hoaibao", sessionId: firstId }, 404);
    await post("/api/chat", { userId: "hoaibao", sessionId: secondId, content: "wrong account" }, 404);
    await post("/api/auth/login", { userId: "missing" }, 401);
  });
  await t.test("restores selected session, history and tokens after restart", async () => {
    await new Promise((resolve) => server.close(resolve));
    await start();
    const data = await post("/api/auth/login", { userId: "tyranno" });
    assert.equal(data.session.id, firstId);
    assert.equal(data.session.usedTokens, 50);
    const resumed = await post("/api/sessions/select", { userId: "Tyranno", sessionId: secondId });
    assert.equal(resumed.session.messages.length, 2);
    assert.equal(resumed.session.usedTokens, 5);
  });
  await t.test("continues saved context without truncating the dataset", async () => {
    let data;
    for (let i = 0; i < 17; i++) {
      data = await post("/api/chat", { userId: "Tyranno", sessionId: secondId, content: `Tin nhắn ${i}` });
    }
    assert.equal(data.session.messages.length, 36);
    assert.equal(data.session.messages[0].content, "Phiên thứ hai");
    assert.equal(data.session.usedTokens, 90);
    assert.equal(requests.at(-1).messages.length, 31);
    assert.equal(requests.at(-1).messages.at(-1).content, "Tin nhắn 16");
    const disk = JSON.parse(await readFile(join(directory, "users.json"), "utf8"));
    assert.equal(disk.Tyranno.sessions.find((s) => s.id === secondId).messages.length, 36);
  });
  await t.test("failed upstream request preserves existing sessions and allows retry", async () => {
    upstreamFails = true;
    await post("/api/chat", { userId: "Tyranno", sessionId: secondId, content: "Thử lỗi" }, 503);
    const data = await post("/api/auth/login", { userId: "Tyranno" });
    assert.equal(data.session.messages.length, 36);
    assert.equal(data.session.usedTokens, 90);
    upstreamFails = false;
    const retry = await post("/api/chat", { userId: "Tyranno", sessionId: secondId, content: "Thử lại" });
    assert.equal(retry.session.messages.length, 38);
  });
  await t.test("routes every configured model and preserves API parameters", async () => {
    const { session } = await post("/api/sessions", { userId: "hoaibao" });
    let usedTokens = 0;
    for (const model of OPENROUTER_MODELS) {
      const data = await post("/api/chat", { userId: "hoaibao", sessionId: session.id, content: "Test model", modelId: model.id });
      const request = requests.at(-1);
      assert.equal(request.model, model.id);
      assert.equal(data.model, model.id);
      assert.equal(request.temperature, 0.7);
      assert.equal(request.stream, false);
      const inputTokens = request.messages.reduce((total, message) => total + Math.max(1, Math.ceil(message.content.length / 4)) + 4, 0);
      assert.equal(request.max_tokens, Math.max(1, 3000 - usedTokens - inputTokens));
      usedTokens = data.session.usedTokens;
    }
    const count = requests.length;
    const before = await post("/api/auth/login", { userId: "hoaibao" });
    await post("/api/chat", { userId: "hoaibao", sessionId: session.id, content: "Invalid model", modelId: "unknown/model" }, 400);
    assert.equal(requests.length, count);
    const after = await post("/api/auth/login", { userId: "hoaibao" });
    assert.deepEqual(after.session, before.session);
  });
  await t.test("reports missing model endpoints without changing conversation history or token usage", async () => {
    const model = OPENROUTER_MODELS.find((item) => item.id.startsWith("deepseek/"));
    const before = await post("/api/auth/login", { userId: "Tyranno" });
    upstreamFails = true;
    upstreamErrorStatus = 404;
    upstreamError = `No endpoints found for ${model.id}.`;
    try {
      const error = await post("/api/chat", { userId: "Tyranno", sessionId: secondId, content: "Keep this draft", modelId: model.id }, 404);
      assert.equal(error.code, "MODEL_UNAVAILABLE");
      assert.equal(error.modelId, model.id);
      assert.ok(error.error.includes(model.label));
      const after = await post("/api/auth/login", { userId: "Tyranno" });
      assert.deepEqual(after.session, before.session);
    } finally { upstreamFails = false; upstreamErrorStatus = 503; upstreamError = "upstream test failure"; }
    const catalog = await (await fetch(`${base}/api/models`)).json();
    assert.equal(catalog.models.length, OPENROUTER_MODELS.length);
    assert.ok(catalog.models.every((item) => item.available === true));
  });
  await t.test("serves local Markdown dependencies with JavaScript MIME types", async () => {
    for (const path of ["/vendor/marked.js", "/vendor/purify.js", "/vendor/highlight.js", "/markdown.js", "/tokens.js"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /text\/javascript/);
      assert.ok((await response.text()).length > 100);
    }
  });
  await t.test("persists normalized answer, reasoning, model and response time after restart", async () => {
    upstreamMessage = { content: [{ type: "text", text: "## Trả lời\n\n```python\nprint(1)\n```" }], reasoning: "Giải thích từ model" };
    upstreamUsage = { prompt_tokens: 42, completion_tokens: 58, total_tokens: 100, completion_tokens_details: { reasoning_tokens: 12 } };
    const sent = await post("/api/chat", { userId: "Tyranno", sessionId: secondId, content: "Markdown test", modelId: OPENROUTER_MODELS[0].id });
    assert.equal(sent.message.content, upstreamMessage.content[0].text);
    assert.equal(sent.message.reasoning, upstreamMessage.reasoning);
    assert.equal(sent.message.modelId, OPENROUTER_MODELS[0].id);
    assert.ok(sent.message.responseTimeMs >= 0);
    assert.equal(sent.message.tokenUsage.promptTokens, 42);
    assert.equal(sent.message.tokenUsage.completionTokens, 58);
    assert.equal(sent.message.tokenUsage.reasoningTokens, 12);
    assert.equal(sent.message.tokenUsage.totalTokens, 100);
    assert.equal(sent.usage.request, 100);
    await new Promise((resolve) => server.close(resolve));
    await start();
    const restored = await post("/api/auth/login", { userId: "Tyranno" });
    assert.deepEqual(restored.session.messages.at(-1), sent.message);
    upstreamMessage = { content: "Phản hồi kiểm thử" };
    upstreamUsage = { total_tokens: 5 };
  });
  await t.test("deletes only owned sessions and preserves the selected remaining conversation", async () => {
    const before = await post("/api/auth/login", { userId: "Tyranno" });
    await post("/api/sessions/delete", { userId: "hoaibao", sessionId: secondId }, 404);
    await post("/api/sessions/clear", { userId: "missing" }, 401);
    const removed = await post("/api/sessions/delete", { userId: "Tyranno", sessionId: firstId });
    assert.equal(removed.session.id, before.session.id);
    assert.equal(removed.sessions.length, before.sessions.length - 1);
    assert.ok(!removed.sessions.some((session) => session.id === firstId));
    await post("/api/sessions/select", { userId: "Tyranno", sessionId: firstId }, 404);
  });
  await t.test("blocks deletion during an upstream request and resumes safely afterwards", async () => {
    const { session } = await post("/api/sessions", { userId: "Tyranno" });
    let release;
    let enter;
    const entered = new Promise((resolve) => { enter = resolve; });
    responseGate = { enter, wait: new Promise((resolve) => { release = resolve; }) };
    const pending = post("/api/chat", { userId: "Tyranno", sessionId: session.id, content: "Pending" });
    await entered;
    try {
      await post("/api/sessions/delete", { userId: "Tyranno", sessionId: session.id }, 409);
      await post("/api/sessions/clear", { userId: "Tyranno" }, 409);
      await post("/api/sessions/budget", { userId: "Tyranno", sessionId: session.id, tokenLimit: 6000 }, 409);
    } finally { release(); responseGate = null; }
    await pending;
    const removed = await post("/api/sessions/delete", { userId: "Tyranno", sessionId: session.id });
    assert.equal(removed.session.id, secondId);
    assert.ok(!removed.sessions.some((item) => item.id === session.id));
  });
  await t.test("edits and persists session budgets without resetting history or usage", async () => {
    for (const tokenLimit of [0, -1, 1.5, 1000001, "6000"]) await post("/api/sessions", { userId: "Tyranno", tokenLimit }, 400);
    let data = await post("/api/sessions", { userId: "Tyranno", tokenLimit: 10000 });
    const id = data.session.id;
    assert.equal(data.session.tokenLimit, 10000);
    data = await post("/api/sessions/budget", { userId: "Tyranno", sessionId: id, tokenLimit: 5000 });
    assert.equal(data.session.tokenLimit, 5000);
    data = await post("/api/chat", { userId: "Tyranno", sessionId: id, content: "Custom budget" });
    const inputTokens = requests.at(-1).messages.reduce((sum, message) => sum + Math.max(1, Math.ceil(message.content.length / 4)) + 4, 0);
    assert.equal(requests.at(-1).max_tokens, 5000 - inputTokens);
    assert.equal(data.usage.limit, 5000);
    const previousMessages = data.session.messages;
    const previousUsedTokens = data.session.usedTokens;
    await post("/api/sessions/budget", { userId: "hoaibao", sessionId: id, tokenLimit: 6000 }, 404);
    data = await post("/api/sessions/budget", { userId: "Tyranno", sessionId: id, tokenLimit: 8000 });
    assert.deepEqual(data.session.messages, previousMessages);
    assert.equal(data.session.usedTokens, previousUsedTokens);
    await post("/api/sessions/budget", { userId: "Tyranno", sessionId: secondId, tokenLimit: 100 }, 400);
    await new Promise((resolve) => server.close(resolve));
    await start();
    const restored = await post("/api/auth/login", { userId: "Tyranno" });
    assert.equal(restored.session.id, id);
    assert.equal(restored.session.tokenLimit, 8000);
    assert.equal(restored.session.usedTokens, previousUsedTokens);
    assert.deepEqual(restored.session.messages, previousMessages);
  });
  await t.test("clears one account's history permanently across restart, preserving the other account", async () => {
    const other = await post("/api/auth/login", { userId: "hoaibao" });
    const cleared = await post("/api/sessions/clear", { userId: "Tyranno" });
    assert.deepEqual(cleared.sessions, []);
    assert.equal(cleared.session, null);
    await new Promise((resolve) => server.close(resolve));
    await start();
    const restored = await post("/api/auth/login", { userId: "Tyranno" });
    assert.deepEqual(restored.sessions, []);
    assert.equal(restored.session, null);
    assert.deepEqual((await post("/api/auth/login", { userId: "hoaibao" })).sessions, other.sessions);
    const fresh = await post("/api/sessions", { userId: "Tyranno" });
    assert.equal(fresh.session.usedTokens, 0);
    assert.deepEqual(fresh.session.messages, []);
  });
});
