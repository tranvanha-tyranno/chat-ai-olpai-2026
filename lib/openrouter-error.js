import { findModel, MODEL_PROVIDERS } from "../public/config/models.js";

export function openRouterError(message, modelId) {
  return providerError(message, modelId, "openrouter");
}

export function providerError(message, modelId, provider, status, errorCode = "") {
  const label = MODEL_PROVIDERS[provider].label;
  if (status === 401) return { code: "API_KEY_INVALID", provider, error: `API key ${label} không hợp lệ. Hãy cập nhật ${provider === "groq" ? "GROQ_API_KEY" : "OPENROUTER_API_KEY"} trong .env; tin nhắn được giữ lại.` };
  if (provider === "groq" && status === 429) return { code: "PROVIDER_RATE_LIMIT", provider, error: "Đã chạm hạn mức Groq. Hãy chờ rồi thử lại hoặc chọn model/nhà cung cấp khác. Tin nhắn được giữ lại." };
  const detail = typeof message === "string" ? message : `${label} trả về lỗi khi tạo phản hồi.`;
  if (/no endpoints found for\b|no available providers for\b|not a valid model|model.{0,160}(?:decommissioned|does not exist|not found)|model_decommissioned|model_not_found/i.test(`${detail} ${errorCode}`)) {
    return {
      code: "MODEL_UNAVAILABLE",
      modelId,
      provider,
      error: `${findModel(modelId, provider)?.label || modelId} hiện không có endpoint phục vụ trên ${label}. Hãy chọn model khác trong Cài đặt. Tin nhắn của bạn được giữ lại để gửi lại.`,
    };
  }
  return { error: detail };
}
