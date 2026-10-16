import test from "node:test";
import assert from "node:assert/strict";
import { normalizeResponse } from "../lib/response.js";

test("normalizes text blocks without turning objects or images into answer text", () => {
  const result = normalizeResponse({ message: { content: [
    { type: "text", text: "## Kết quả" },
    { type: "image_url", image_url: { url: "test" } },
    { type: "text", text: "```python\nprint('hello')\n```" },
  ] } });
  assert.equal(result.content, "## Kết quả\n```python\nprint('hello')\n```");
  assert.equal(result.reasoning, "");
  assert.equal(normalizeResponse({ message: { content: {} } }).content, "");
});

test("separates provider reasoning and never displays encrypted details", () => {
  const result = normalizeResponse({ message: { content: "**Đáp án**", reasoning_details: [
    { type: "reasoning.encrypted", data: "do-not-display" },
    { type: "reasoning.summary", summary: "Tóm tắt cách giải" },
    { type: "reasoning.text", text: "Phần giải thích" },
  ] } });
  assert.equal(result.content, "**Đáp án**");
  assert.equal(result.reasoning, "Tóm tắt cách giải\n\nPhần giải thích");
  assert.equal(normalizeResponse({ message: { content: "OK", reasoning: "Explanation" } }).reasoning, "Explanation");
});

test("extracts leading think tags while preserving tags inside code examples", () => {
  const result = normalizeResponse({ message: { content: "<think>Phân tích</think>\n## Trả lời" } });
  assert.equal(result.reasoning, "Phân tích");
  assert.equal(result.content, "## Trả lời");
  const example = "```html\n<think>example</think>\n```";
  assert.equal(normalizeResponse({ message: { content: example } }).content, example);
});

test("explains token exhaustion even when the provider returns no answer text", () => {
  for (const message of [{ content: "", reasoning: "Phần giải thích" }, { content: null }]) {
    const result = normalizeResponse({ message, finish_reason: "length" });
    assert.equal(result.truncated, true);
    assert.match(result.content, /hết giới hạn token/);
  }
  assert.equal(normalizeResponse({ message: { content: "Partial answer" }, finish_reason: "length" }).content, "Partial answer");
  assert.equal(normalizeResponse().content, "");
});
