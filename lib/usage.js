import { estimateTokens } from "../public/tokens.js";

function tokenCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function tokenUsage(usage, inputEstimate, outputText) {
  const input = tokenCount(usage.prompt_tokens);
  const output = tokenCount(usage.completion_tokens);
  const total = tokenCount(usage.total_tokens);
  const promptTokens = input ?? inputEstimate;
  const completionTokens = output ?? estimateTokens(outputText);
  return {
    promptTokens,
    completionTokens,
    reasoningTokens: tokenCount(usage.completion_tokens_details?.reasoning_tokens),
    totalTokens: total ?? promptTokens + completionTokens,
    promptEstimated: input === null,
    completionEstimated: output === null,
    totalEstimated: total === null && (input === null || output === null),
  };
}
