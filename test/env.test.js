import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEnvLoader, parseEnv } from "../lib/env.js";

test("parses environment entries, quotes and inline comments", () => {
  const values = parseEnv("# comment\nexport GROQ_API_KEY='test-key' # comment\nPORT=8787 # local\nEMPTY=\n");
  assert.equal(values.get("GROQ_API_KEY"), "test-key");
  assert.equal(values.get("PORT"), "8787");
  assert.equal(values.get("EMPTY"), "");
});

test("reloads changed credentials without changing server configuration or inherited environment", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "qwen-env-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, ".env");
  await writeFile(path, "GROQ_API_KEY=test-first\nOPENROUTER_API_KEY=test-router\nPORT=8787\n");
  const environment = { OPENROUTER_API_KEY: "test-inherited" };
  const loader = await createEnvLoader(path, environment);
  assert.equal(environment.GROQ_API_KEY, "test-first");
  assert.equal(environment.OPENROUTER_API_KEY, "test-inherited");
  assert.equal(loader.apiKey("openrouter"), "test-router");
  assert.equal(loader.apiKey("groq"), "test-first");
  await writeFile(path, "GROQ_API_KEY=test-second\nOPENROUTER_API_KEY=test-new-router\nPORT=9999\n");
  await loader.reloadCredentials();
  assert.equal(environment.GROQ_API_KEY, "test-second");
  assert.equal(loader.apiKey("groq"), "test-second");
  assert.equal(environment.OPENROUTER_API_KEY, "test-inherited");
  assert.equal(environment.PORT, "8787");
  await writeFile(path, "PORT=9999\n");
  await loader.reloadCredentials();
  assert.equal(environment.GROQ_API_KEY, undefined);
  assert.equal(loader.apiKey("groq"), null);
  assert.equal(loader.apiKey("openrouter"), null);
});
