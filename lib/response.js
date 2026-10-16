function textContent(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

export function normalizeResponse(choice = {}) {
  const message = choice.message || {};
  let content = textContent(message.content).trim();
  const details = Array.isArray(message.reasoning_details) ? message.reasoning_details : [];
  let reasoning = details.map((detail) => {
    if (detail?.type === "reasoning.text" && typeof detail.text === "string") return detail.text;
    if (detail?.type === "reasoning.summary" && typeof detail.summary === "string") return detail.summary;
    return "";
  }).filter(Boolean).join("\n\n") || textContent(message.reasoning).trim();
  // Some models put a leading think block in content instead of a separate field.
  const think = content.match(/^<think>([\s\S]*?)<\/think>\s*/i);
  if (think) {
    reasoning ||= think[1].trim();
    content = content.slice(think[0].length).trim();
  }
  const truncated = choice.finish_reason === "length";
  if (!content && (reasoning || truncated)) {
    content = truncated
      ? "Model đã hết giới hạn token trước khi tạo câu trả lời. Hãy thử câu hỏi ngắn hơn hoặc tạo phiên mới."
      : "Model đã trả phần tư duy nhưng chưa có câu trả lời. Hãy thử gửi lại yêu cầu.";
  }
  return { content, reasoning, truncated };
}
