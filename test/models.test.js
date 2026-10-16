import test from "node:test";
import assert from "node:assert/strict";
import { ALL_MODELS, OPENROUTER_MODELS, GROQ_MODELS, DEFAULT_MODEL_ID, modelKey } from "../public/config/models.js";
import { openRouterError } from "../lib/openrouter-error.js";

test("catalog checks configured IDs, caches successes and uses no API credentials", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests++;
    assert.equal(url, "https://openrouter.ai/api/v1/models");
    assert.equal(options.headers, undefined);
    return Response.json({ data: [{ id: DEFAULT_MODEL_ID }] });
  });
  const { modelAvailability } = await import(`../lib/model-availability.js?test=${crypto.randomUUID()}`);
  const first = await modelAvailability();
  assert.equal(first.models.length, OPENROUTER_MODELS.length);
  assert.equal(first.models.find((model) => model.id === DEFAULT_MODEL_ID).available, true);
  assert.ok(first.models.filter((model) => model.id !== DEFAULT_MODEL_ID).every((model) => model.available === false));
  assert.deepEqual(await modelAvailability(), first);
  assert.equal(requests, 1);
});

test("catalog failures and malformed responses leave availability unknown and can retry", async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    attempts++;
    if (attempts === 1) throw new Error("offline");
    if (attempts === 2) return Response.json({ data: [] });
    return Response.json({ data: [{ id: DEFAULT_MODEL_ID }] });
  });
  const { modelAvailability } = await import(`../lib/model-availability.js?test=${crypto.randomUUID()}`);
  for (let i = 0; i < 2; i++) {
    const unknown = await modelAvailability();
    assert.equal(unknown.checkedAt, null);
    assert.ok(unknown.models.every((model) => model.available === null));
  }
  assert.ok((await modelAvailability()).checkedAt);
  assert.equal(attempts, 3);
});

test("missing endpoint errors are actionable without misclassifying provider policy errors", () => {
  const model = OPENROUTER_MODELS.find((item) => item.id.startsWith("deepseek/"));
  const result = openRouterError(`No endpoints found for ${model.id}.`, model.id);
  assert.equal(result.code, "MODEL_UNAVAILABLE");
  assert.equal(result.modelId, model.id);
  assert.ok(result.error.includes(model.label));
  assert.match(result.error, /Cài đặt/);
  assert.match(result.error, /giữ lại/);
  const policyError = "No endpoints found that match your data policy";
  assert.deepEqual(openRouterError(policyError, model.id), { error: policyError });
  assert.equal(openRouterError("Rate limit exceeded", model.id).code, undefined);
});

test("Groq catalogs use the matching credential and remain independent from OpenRouter", async (t) => {
  const sharedId = GROQ_MODELS[0].id;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, authorization: options.headers?.authorization });
    if (options.headers?.authorization === "Bearer test-key-invalid") return Response.json({ error: "invalid key" }, { status: 401 });
    const id = !options.headers || options.headers.authorization === "Bearer test-key-two" ? DEFAULT_MODEL_ID : sharedId;
    return Response.json({ data: [{ id }] });
  });
  const { modelAvailability } = await import(`../lib/model-availability.js?test=${crypto.randomUUID()}`);
  assert.equal((await modelAvailability("groq")).requiresKey, true);
  assert.equal(calls.length, 0);
  const router = await modelAvailability();
  const first = await modelAvailability("groq", "test-key-one");
  const second = await modelAvailability("groq", "test-key-two");
  assert.equal(router.models.find((model) => model.id === DEFAULT_MODEL_ID).available, true);
  assert.equal(first.models.find((model) => model.id === sharedId).available, true);
  assert.equal(second.models.find((model) => model.id === sharedId).available, false);
  await modelAvailability("groq", "test-key-one");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].authorization, undefined);
  assert.equal(calls[1].url, "https://api.groq.com/openai/v1/models");
  const rejected = await modelAvailability("groq", "test-key-invalid");
  assert.equal(rejected.keyRejected, true);
  assert.ok(rejected.models.every((model) => model.available === null));
  assert.ok(!JSON.stringify([first, second, rejected]).includes("test-key"));
});

test("all configured models are within 30–500B total parameters with unique provider identities", () => {
  assert.ok(ALL_MODELS.every((model) => model.parametersB >= 30 && model.parametersB <= 500));
  assert.ok(ALL_MODELS.some((model) => model.parametersB >= 400));
  assert.ok(GROQ_MODELS.every((model) => !model.legacy));
  assert.equal(new Set(ALL_MODELS.map((model) => modelKey(model.provider, model.id))).size, ALL_MODELS.length);
  assert.equal(OPENROUTER_MODELS.filter((model) => model.default).length, 1);
});
