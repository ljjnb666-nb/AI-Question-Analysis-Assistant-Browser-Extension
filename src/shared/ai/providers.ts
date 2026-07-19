export type ProviderId =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "gemini"
  | "qwen"
  | "moonshot"
  | "zhipu"
  | "minimax"
  | "ollama"
  | "custom";

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  supportsVision: boolean;
  openaiCompat: boolean;
  authHeader: "bearer" | "x-api-key" | "none";
  keyPlaceholder: string;
  keyOptional?: boolean;
}

export const PROVIDERS: ProviderConfig[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-opus-4.8",
    models: ["claude-opus-4.8", "claude-sonnet-4.6", "claude-haiku-4.5"],
    supportsVision: true,
    openaiCompat: false,
    authHeader: "x-api-key",
    keyPlaceholder: "sk-ant-api03-...",
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    baseUrl: "https://api.openai.com",
    defaultModel: "gpt-5.5",
    models: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
    supportsVision: true,
    openaiCompat: true,
    authHeader: "bearer",
    keyPlaceholder: "sk-...",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    supportsVision: false,
    openaiCompat: true,
    authHeader: "bearer",
    keyPlaceholder: "sk-...",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
    supportsVision: true,
    openaiCompat: false,
    authHeader: "none",
    keyPlaceholder: "AIza...",
  },
  {
    id: "qwen",
    name: "阿里云通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
    defaultModel: "qwen3-vl-plus",
    models: ["qwen3-vl-plus", "qwen3-vl-flash", "qwen3.7-max", "qwen-plus", "qwen-flash"],
    supportsVision: true,
    openaiCompat: true,
    authHeader: "bearer",
    keyPlaceholder: "sk-...",
  },
  {
    id: "moonshot",
    name: "Moonshot Kimi",
    baseUrl: "https://api.moonshot.cn",
    defaultModel: "kimi-k2.6",
    models: ["kimi-k2.6", "kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.5"],
    supportsVision: true,
    openaiCompat: true,
    authHeader: "bearer",
    keyPlaceholder: "sk-...",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas",
    defaultModel: "glm-5v-turbo",
    models: ["glm-5v-turbo", "glm-5.2", "glm-5.1", "glm-5-turbo"],
    supportsVision: true,
    openaiCompat: true,
    authHeader: "bearer",
    keyPlaceholder: "your_api_key",
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com",
    defaultModel: "MiniMax-M3",
    models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
    supportsVision: true,
    openaiCompat: true,
    authHeader: "bearer",
    keyPlaceholder: "eyJ...",
  },
  {
    id: "ollama",
    name: "Ollama（本地）",
    baseUrl: "http://localhost:11434",
    defaultModel: "qwen3-vl",
    models: ["qwen3-vl", "qwen3.5", "gemma4", "llama3.2-vision", "llava"],
    supportsVision: true,
    openaiCompat: true,
    authHeader: "none",
    keyPlaceholder: "（本地无需 Key）",
    keyOptional: true,
  },
  {
    id: "custom",
    name: "Custom（OpenAI 兼容）",
    baseUrl: "http://localhost:11434",
    defaultModel: "gpt-5.4-mini",
    models: ["gpt-5.4-mini"],
    supportsVision: true,
    openaiCompat: true,
    authHeader: "bearer",
    keyPlaceholder: "your_api_key",
  },
];

export const PROVIDER_SHORT_NAMES: Record<ProviderId, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  qwen: "千问",
  moonshot: "Kimi",
  zhipu: "GLM",
  minimax: "MiniMax",
  ollama: "Ollama",
  custom: "Custom",
};

export function getProvider(id: string): ProviderConfig {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0];
}

export function getProviderShortName(id: string): string {
  const provider = getProvider(id);
  return PROVIDER_SHORT_NAMES[provider.id];
}
