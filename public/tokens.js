export const TOKEN_LIMIT = 3000;
export const MIN_TOKEN_LIMIT = 100;
export const MAX_TOKEN_LIMIT = 1_000_000;

export function validTokenLimit(value) {
  return Number.isInteger(value) && value >= MIN_TOKEN_LIMIT && value <= MAX_TOKEN_LIMIT;
}

// Shared with the server. These are estimates; each model has its own tokenizer.
export function estimateTokens(value = "") {
  return Math.max(1, Math.ceil(String(value).length / 4));
}

export function estimateMessages(messages = []) {
  return messages.reduce((total, message) => total + estimateTokens(message.content) + 4, 0);
}

export function chatMessages(history, content) {
  return [...history.slice(-30), { role: "user", content: content.trim() }].map(({ role, content }) => ({ role, content }));
}

export function estimateDraft(history, draft, usedTokens = 0, tokenLimit = TOKEN_LIMIT) {
  const text = draft.trim();
  const contextTokens = estimateMessages(history.slice(-30));
  const draftTokens = text ? estimateTokens(text) : 0;
  const requestTokens = text ? estimateMessages(chatMessages(history, text)) : 0;
  const remaining = Math.max(0, tokenLimit - usedTokens);
  return {
    characters: Array.from(draft).length,
    draftTokens, contextTokens, requestTokens,
    replyTokens: Math.max(0, remaining - requestTokens),
    blocked: remaining === 0 || (text.length > 0 && requestTokens >= remaining),
  };
}
