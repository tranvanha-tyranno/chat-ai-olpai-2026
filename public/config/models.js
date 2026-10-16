// Parameter sizes refer to total weights, including all experts in MoE models.
export const OPENROUTER_MODELS = [
  { id: "qwen/qwen3-30b-a3b", label: "Qwen3 30B A3B", params: "30.5B total · 3.3B active", parametersB: 30.5 },
  { id: "qwen/qwen3-30b-a3b-instruct-2507", label: "Qwen3 30B Instruct 2507", params: "30.5B total · 3.3B active", parametersB: 30.5 },
  { id: "qwen/qwen3-coder-30b-a3b-instruct", label: "Qwen3 Coder 30B", params: "30.5B total · 3.3B active", parametersB: 30.5 },
  { id: "qwen/qwen3-vl-30b-a3b-instruct", label: "Qwen3 VL 30B Instruct", params: "30B total · 3B active", parametersB: 30 },
  { id: "qwen/qwen3-vl-30b-a3b-thinking", label: "Qwen3 VL 30B Thinking", params: "30B total · 3B active", parametersB: 30 },
  { id: "google/gemma-4-31b-it", label: "Gemma 4 31B", params: "30.7B", parametersB: 30.7 },
  { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B Free", params: "30.7B", parametersB: 30.7, free: true },
  { id: "qwen/qwen3-32b", label: "Qwen3 32B", params: "32.8B", parametersB: 32.8, default: true },
  { id: "qwen/qwen-2.5-coder-32b-instruct", label: "Qwen2.5 Coder 32B", params: "32B", parametersB: 32 },
  { id: "qwen/qwen3.5-35b-a3b", label: "Qwen3.5 35B A3B", params: "35B total · 3B active", parametersB: 35 },
  { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B", params: "70B", parametersB: 70 },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", params: "70B", parametersB: 70 },
  { id: "nousresearch/hermes-3-llama-3.1-70b", label: "Hermes 3 70B", params: "70B", parametersB: 70 },
  { id: "qwen/qwen-2.5-72b-instruct", label: "Qwen2.5 72B", params: "72B", parametersB: 72 },
  { id: "qwen/qwen2.5-vl-72b-instruct", label: "Qwen2.5 VL 72B", params: "72B", parametersB: 72 },
  { id: "qwen/qwen3-next-80b-a3b-instruct", label: "Qwen3 Next 80B Instruct", params: "80B total · 3B active", parametersB: 80 },
  { id: "qwen/qwen3-next-80b-a3b-thinking", label: "Qwen3 Next 80B Thinking", params: "80B total · 3B active", parametersB: 80 },
  { id: "meta-llama/llama-4-scout", label: "Llama 4 Scout", params: "109B total · 17B active", parametersB: 109 },
  { id: "openai/gpt-oss-120b", label: "GPT OSS 120B", params: "117B total · 5.1B active", parametersB: 117 },
  { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super 120B", params: "120B total · 12B active", parametersB: 120 },
  { id: "qwen/qwen3.5-122b-a10b", label: "Qwen3.5 122B A10B", params: "122B total · 10B active", parametersB: 122 },
  { id: "mistralai/mistral-large", label: "Mistral Large 2", params: "123B", parametersB: 123 },
  { id: "mistralai/mixtral-8x22b-instruct", label: "Mixtral 8x22B", params: "141B total · 39B active", parametersB: 141 },
  { id: "qwen/qwen3-235b-a22b-2507", label: "Qwen3 235B Instruct 2507", params: "235B total · 22B active", parametersB: 235 },
  { id: "qwen/qwen3-235b-a22b-thinking-2507", label: "Qwen3 235B Thinking 2507", params: "235B total · 22B active", parametersB: 235 },
  { id: "qwen/qwen3-vl-235b-a22b-instruct", label: "Qwen3 VL 235B Instruct", params: "235B total · 22B active", parametersB: 235 },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", params: "284B total · 13B active", parametersB: 284 },
  { id: "deepseek/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash 0731", params: "284B total · 13B active", parametersB: 284 },
  { id: "qwen/qwen3.5-397b-a17b", label: "Qwen3.5 397B A17B", params: "397B total · 17B active", parametersB: 397 },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", params: "400B total · 17B active", parametersB: 400 },
  { id: "nousresearch/hermes-3-llama-3.1-405b", label: "Hermes 3 405B", params: "405B", parametersB: 405 },
  { id: "qwen/qwen3-coder", label: "Qwen3 Coder 480B", params: "480B total · 35B active", parametersB: 480 },
].sort((a, b) => a.parametersB - b.parametersB);

export const GROQ_MODELS = [
  { id: "openai/gpt-oss-120b", label: "GPT OSS 120B", params: "117B total · 5.1B active", parametersB: 117 },
];

export const DEFAULT_MODEL_ID = OPENROUTER_MODELS.find((model) => model.default).id;
export const MODEL_PROVIDERS = { openrouter: { label: "OpenRouter" }, groq: { label: "Groq" } };
export const ALL_MODELS = [
  ...OPENROUTER_MODELS.map((model) => ({ ...model, provider: "openrouter" })),
  ...GROQ_MODELS.map((model) => ({ ...model, provider: "groq" })),
];
export function modelKey(provider, modelId) { return `${provider}:${modelId}`; }
export function findModel(modelId, provider = "openrouter") { return ALL_MODELS.find((model) => model.id === modelId && model.provider === provider); }
export function findModelByKey(value) { return ALL_MODELS.find((model) => modelKey(model.provider, model.id) === value); }
