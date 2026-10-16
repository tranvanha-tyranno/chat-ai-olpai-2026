import test from "node:test";
import assert from "node:assert/strict";
import { estimateDraft, chatMessages, estimateMessages, validTokenLimit } from "../public/tokens.js";
import { tokenUsage } from "../lib/usage.js";

test("draft estimates update at character boundaries and clear when text is removed", () => {
  assert.deepEqual(["", "a", "ab", "abcd", "abcde", ""].map((text) => estimateDraft([], text).draftTokens), [0, 1, 1, 1, 2, 0]);
  assert.equal(estimateDraft([], "   ").requestTokens, 0);
  assert.equal(estimateDraft([], "🙂").characters, 1);
  assert.equal(estimateDraft([], "  a  ").requestTokens, estimateDraft([], "a").requestTokens);
});

test("preview accounts for the actual context window, metadata and remaining reply budget", () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `message ${i}`, reasoning: "not sent", tokenUsage: {} }));
  const preview = estimateDraft(history, "hello", 250);
  const messages = chatMessages(history, "hello");
  assert.equal(messages.length, 31);
  assert.equal(messages[0].content, "message 10");
  assert.deepEqual(Object.keys(messages[0]), ["role", "content"]);
  assert.equal(preview.requestTokens, estimateMessages(messages));
  assert.equal(preview.contextTokens, estimateMessages(messages.slice(0, -1)));
  assert.equal(preview.replyTokens, 3000 - 250 - preview.requestTokens);
  assert.equal(estimateDraft(history, "", 250).requestTokens, 0);
});

test("blocks only drafts that cannot leave any reply budget", () => {
  assert.equal(estimateDraft([], "a", 2994).replyTokens, 1);
  assert.equal(estimateDraft([], "a", 2994).blocked, false);
  assert.equal(estimateDraft([], "a", 2995).blocked, true);
  assert.equal(estimateDraft([], "a", 3000).replyTokens, 0);
  assert.equal(estimateDraft([], "", 3000).blocked, true);
});

test("custom session budgets affect remaining tokens and enforce supported values", () => {
  assert.equal(estimateDraft([], "a", 2995, 10000).replyTokens, 7000);
  assert.equal(estimateDraft([], "a", 2995, 10000).blocked, false);
  for (const value of [100, 3000, 10000, 1000000]) assert.equal(validTokenLimit(value), true);
  for (const value of [0, 99, -1, 1.5, 1000001, "3000", NaN]) assert.equal(validTokenLimit(value), false);
});

test("uses provider token counts and does not double count reasoning", () => {
  const usage = tokenUsage({ prompt_tokens: 42, completion_tokens: 58, total_tokens: 100, completion_tokens_details: { reasoning_tokens: 12 } }, 999, "answer");
  assert.deepEqual(usage, { promptTokens: 42, completionTokens: 58, reasoningTokens: 12, totalTokens: 100, promptEstimated: false, completionEstimated: false, totalEstimated: false });
  const zero = tokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, 999, "answer");
  assert.equal(zero.totalTokens, 0);
  assert.equal(zero.totalEstimated, false);
});

test("labels missing or invalid usage as estimated while retaining exact fields", () => {
  const partial = tokenUsage({ total_tokens: 15 }, 10, "answer");
  assert.equal(partial.totalTokens, 15);
  assert.equal(partial.totalEstimated, false);
  assert.equal(partial.promptEstimated, true);
  assert.equal(partial.completionEstimated, true);
  const summed = tokenUsage({ prompt_tokens: 10, completion_tokens: 5 }, 999, "answer");
  assert.equal(summed.totalTokens, 15);
  assert.equal(summed.totalEstimated, false);
  const invalid = tokenUsage({ total_tokens: -1, prompt_tokens: "20", completion_tokens: NaN }, 10, "answer");
  assert.equal(invalid.totalTokens, 12);
  assert.equal(invalid.totalEstimated, true);
});
