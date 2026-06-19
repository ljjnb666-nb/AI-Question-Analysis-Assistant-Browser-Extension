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
    defaultModel: "claude-opus-4-5",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5-20251001"],
    supportsVision: true,
    openaiCompat: false,
    authHeader: "x-api-key",
    keyPlaceholder: "sk-ant-api03-...",
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    baseUrl: "https://api.openai.com",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    supportsVision: true,
    openaiCompat: true,
    authHeader: "bearer",
    keyPlaceholder: "sk-...",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    supportsVision: false,
    openaiCompat: true,
    authHeader: "bearer",
    keyPlaceholder: "sk-...",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-2.0-flash",
    models: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"],
    supportsVision: true,
    openaiCompat: false,
    authHeader: "none",
    keyPlaceholder: "AIza...",
  },
  {
    id: "qwen",
    name: "阿里云通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
    defaultModel: "qwen-vl-max",
    models: ["qwen-vl-max", "qwen-vl-plus", "qwen-max", "qwen-plus", "qwen-turbo"],
    supportsVision: true,
    openaiCompat: true,
    authHeader: "bearer",
    keyPlaceholder: "sk-...",
  },
  {
    id: "moonshot",
    name: "月之暗面 Kimi",
    baseUrl: "https://api.moonshot.cn",
    defaultModel: "moonshot-v1-8k",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    supportsVision: false,
    openaiCompat: true,
    authHeader: "bearer",
    keyPlaceholder: "sk-...",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas",
    defaultModel: "glm-4v-flash",
    models: ["glm-4v-flash", "glm-4v-plus", "glm-4-flash", "glm-4-plus"],
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
    models: ["MiniMax-M3"],
    supportsVision: true,
    openaiCompat: true,
    authHeader: "bearer",
    keyPlaceholder: "eyJ...",
  },
  {
    id: "ollama",
    name: "Ollama（本地）",
    baseUrl: "http://localhost:11434",
    defaultModel: "llava",
    models: ["llava", "llava:13b", "qwen2.5-vl", "gemma3", "llama3.2-vision"],
    supportsVision: true,
    openaiCompat: true,
    authHeader: "none",
    keyPlaceholder: "(本地无需 Key)",
    keyOptional: true,
  },
  {
    id: "custom",
    name: "Custom（OpenAI兼容）",
    baseUrl: "http://localhost:11434",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini"],
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
