import { createHash } from "node:crypto";
import { ALL_MODELS } from "../public/config/models.js";
import { PROVIDER_APIS } from "./providers.js";

const cache = new Map();
const inFlight = new Map();

export async function modelAvailability(provider = "openrouter", apiKey = null) {
  const configured = ALL_MODELS.filter((model) => model.provider === provider);
  const unknown = { checkedAt: null, models: configured.map(({ id }) => ({ id, provider, available: null })) };
  if (provider === "groq" && !apiKey) return { ...unknown, requiresKey: true };
  const cacheKey = `${provider}:${apiKey ? createHash("sha256").update(apiKey).digest("hex") : "public"}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < 60_000) return cached;
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
  const pending = (async () => {
    try {
      const options = { signal: AbortSignal.timeout(8000) };
      if (provider === "groq") options.headers = { authorization: `Bearer ${apiKey}` };
      const response = await fetch(PROVIDER_APIS[provider].models, options);
      if (provider === "groq" && [401, 403].includes(response.status)) return { ...unknown, keyRejected: true };
      if (!response.ok) throw new Error("Catalog unavailable");
      const body = await response.json();
      if (!Array.isArray(body.data) || !body.data.length || body.data.some((model) => typeof model?.id !== "string")) throw new Error("Invalid catalog");
      const ids = new Set(body.data.map((model) => model.id));
      const result = { checkedAt: Date.now(), models: configured.map(({ id }) => ({ id, provider, available: ids.has(id) })) };
      if (cache.size >= 64) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, result);
      return result;
    } catch {
      return unknown;
    } finally { inFlight.delete(cacheKey); }
  })();
  inFlight.set(cacheKey, pending);
  return pending;
}
