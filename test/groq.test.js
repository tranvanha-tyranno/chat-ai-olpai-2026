import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { ALL_MODELS, GROQ_MODELS, OPENROUTER_MODELS, DEFAULT_MODEL_ID, findModelByKey, modelKey } from "../public/config/models.js";

test("provider keys are read only from .env and never saved through the API", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "qwen-env-provider-test-"));
  const previousEnv = Object.fromEntries(["PORT", "DATA_DIR", "APP_ENV_FILE", "OPENROUTER_API_KEY", "GROQ_API_KEY"].map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const groqKey = "gsk_test_only_file_key";
  const routerKey = "test_only_file_router_key";
  const sharedId = GROQ_MODELS[0].id;
  const envPath = join(directory, ".env");
  const requests = [];
  let failure = null;
  let server;
  let base;
  process.env.PORT = "0";
  process.env.DATA_DIR = directory;
  process.env.APP_ENV_FILE = envPath;
  process.env.GROQ_API_KEY = "test_inherited_key_must_not_be_used";
  process.env.OPENROUTER_API_KEY = "test_inherited_router_must_not_be_used";
  await writeFile(envPath, "");
  const oldSavedKeys = JSON.stringify({ Tyranno: { groq: "gsk_test_legacy_saved_key_ignored" } });
  await writeFile(join(directory, "provider-keys.json"), oldSavedKeys);
  globalThis.fetch = async (url, options) => {
    if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: OPENROUTER_MODELS.map(({ id }) => ({ id })) });
    if (url === "https://api.groq.com/openai/v1/models") {
      requests.push({ url, authorization: options.headers.authorization });
      return Response.json({ data: GROQ_MODELS.map(({ id }) => ({ id })) });
    }
    if (["https://api.groq.com/openai/v1/chat/completions", "https://openrouter.ai/api/v1/chat/completions"].includes(url)) {
      requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      if (failure) return Response.json({ error: { message: failure.message, code: failure.code } }, { status: failure.status });
      return Response.json({ choices: [{ message: { content: "**OK**", reasoning: "Provider explanation" } }], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } });
    }
    if (String(url).startsWith(base || "http://localhost:")) return originalFetch(url, options);
    throw new Error("Unexpected external request");
  };
  t.after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  });
  const start = async () => {
    ({ default: server } = await import(`../server.js?envOnly=${crypto.randomUUID()}`));
    if (!server.listening) await once(server, "listening");
    base = `http://localhost:${server.address().port}`;
  };
  const post = async (path, body, status = 200) => {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  await start();
  const { session } = await post("/api/sessions", { userId: "Tyranno" });
  const send = (provider, modelId, status = 200) => post("/api/chat", { userId: "Tyranno", sessionId: session.id, content: "Test model", provider, modelId }, status);

  await t.test("ignores inherited API keys and legacy saved credentials when .env is empty", async () => {
    const missing = await send("groq", sharedId, 400);
    assert.equal(missing.code, "API_KEY_REQUIRED");
    assert.match(missing.error, /\.env/);
    await send("openrouter", sharedId, 400);
    assert.equal(requests.length, 0);
    const login = await post("/api/auth/login", { userId: "Tyranno" });
    assert.equal(login.providers.groq.configured, false);
    assert.equal(login.providers.openrouter.configured, false);
  });

  await t.test("loads newly edited file keys without restarting and returns only configuration status", async () => {
    await writeFile(envPath, `GROQ_API_KEY=${groqKey}\nOPENROUTER_API_KEY=${routerKey}\n`);
    const login = await post("/api/auth/login", { userId: "Tyranno" });
    assert.deepEqual(login.providers.groq, { configured: true, source: ".env" });
    assert.ok(!JSON.stringify(login).includes(groqKey));
    const catalog = await (await fetch(`${base}/api/models?userId=Tyranno`)).json();
    assert.equal(catalog.models.length, ALL_MODELS.length);
    assert.equal(catalog.models.filter((model) => model.id === sharedId).length, 2);
    assert.equal(requests.at(-1).authorization, `Bearer ${groqKey}`);
    assert.ok(!JSON.stringify(catalog).includes(groqKey));
    assert.equal(findModelByKey(modelKey("groq", sharedId)).provider, "groq");
    assert.equal(findModelByKey(modelKey("openrouter", sharedId)).provider, "openrouter");
  });

  await t.test("routes shared model IDs to the matching provider using file keys", async () => {
    const router = await send("openrouter", sharedId);
    assert.equal(requests.at(-1).url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(requests.at(-1).headers.authorization, `Bearer ${routerKey}`);
    assert.equal(router.provider, "openrouter");
    const groq = await send("groq", sharedId);
    const request = requests.at(-1);
    assert.equal(request.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(request.headers.authorization, `Bearer ${groqKey}`);
    assert.equal(request.headers["http-referer"], undefined);
    assert.equal(request.body.model, sharedId);
    assert.equal(request.body.provider, undefined);
    assert.equal(request.body.temperature, .7);
    assert.equal(request.body.stream, false);
    assert.equal(groq.message.provider, "groq");
    assert.equal(groq.message.tokenUsage.totalTokens, 10);
    const inputTokens = request.body.messages.reduce((total, message) => total + Math.max(1, Math.ceil(message.content.length / 4)) + 4, 0);
    assert.equal(request.body.max_tokens, 3000 - 10 - inputTokens);
  });

  await t.test("removes the key-saving endpoint and key inputs from the interface", async () => {
    await post("/api/settings/groq", { userId: "Tyranno", apiKey: "must_not_be_saved" }, 405);
    assert.equal(await readFile(join(directory, "provider-keys.json"), "utf8"), oldSavedKeys);
    const html = await (await fetch(base)).text();
    assert.ok(!html.includes('type="password"'));
    assert.ok(!html.includes('id="groq-key-form"'));
    assert.ok(!html.includes("Lưu key"));
    assert.ok(!html.includes("Dùng key từ .env"));
  });

  await t.test("accepts configured Groq models and rejects invalid provider/model combinations", async () => {
    for (const model of GROQ_MODELS) assert.equal((await send("groq", model.id)).message.provider, "groq");
    const count = requests.length;
    await send("groq", DEFAULT_MODEL_ID, 400);
    await send("unknown", sharedId, 400);
    assert.equal(requests.length, count);
  });

  await t.test("retains history on provider errors and points invalid keys to .env", async () => {
    const before = await post("/api/auth/login", { userId: "Tyranno" });
    try {
      for (const [status, message, code, expected] of [
        [400, "The model has been decommissioned", "model_decommissioned", "MODEL_UNAVAILABLE"],
        [401, `Invalid key ${groqKey}`, "invalid_api_key", "API_KEY_INVALID"],
        [429, "Rate limit reached", "rate_limit_exceeded", "PROVIDER_RATE_LIMIT"],
      ]) {
        failure = { status, message, code };
        const error = await send("groq", sharedId, status);
        assert.equal(error.code, expected);
        assert.equal(error.provider, "groq");
        assert.ok(!JSON.stringify(error).includes(groqKey));
        if (status === 401) assert.match(error.error, /\.env/);
        assert.deepEqual((await post("/api/auth/login", { userId: "Tyranno" })).session, before.session);
      }
    } finally { failure = null; }
  });

  await t.test("refreshes rotated keys and uses file credentials after restart", async () => {
    const rotated = "gsk_test_rotated_file_key";
    await writeFile(envPath, `GROQ_API_KEY=${rotated}\nOPENROUTER_API_KEY=${routerKey}\n`);
    await send("groq", sharedId);
    assert.equal(requests.at(-1).headers.authorization, `Bearer ${rotated}`);
    await new Promise((resolve) => server.close(resolve));
    await start();
    await send("groq", sharedId);
    assert.equal(requests.at(-1).headers.authorization, `Bearer ${rotated}`);
    const history = await readFile(join(directory, "users.json"), "utf8");
    assert.ok(!history.includes(groqKey) && !history.includes(rotated));
    for (const path of ["/data/provider-keys.json", "/.env"]) assert.equal((await fetch(`${base}${path}`)).status, 404);
    await writeFile(envPath, `OPENROUTER_API_KEY=${routerKey}\n`);
    assert.equal((await send("groq", sharedId, 400)).code, "API_KEY_REQUIRED");
  });
});
