import React, { useEffect, useState } from "react";
import type { QuestionBlock } from "@/shared/types";
import { loadSettings, saveSettings } from "@/shared/utils/storage";
import { getProvider, parseQuestion, PROVIDERS } from "@/shared/utils/parseRouter";
import type { ProviderId } from "@/shared/utils/parseRouter";
import type { UILang } from "./displayUtils";

export const SettingsTab: React.FC<{ lang: UILang; onLanguageChange: (lang: UILang) => void }> = ({ lang: initialLang, onLanguageChange }) => {
  const [providerId, setProviderId] = useState<ProviderId>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [route, setRoute] = useState<"auto" | "text" | "vision">("auto");
  const [customUrl, setCustomUrl] = useState("");
  const [customProtocol, setCustomProtocol] = useState<"openai" | "anthropic">("openai");
  const [lang, setLang] = useState<"zh" | "en">(initialLang);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const provider = getProvider(providerId);
  const isEn = lang === "en";

  useEffect(() => {
    loadSettings().then((s) => {
      setProviderId((s.providerId as ProviderId) ?? "anthropic");
      setApiKey(s.apiKey ?? "");
      setModel(s.apiModel ?? "");
      setRoute(s.preferredRoute ?? "auto");
      setCustomUrl(s.customBaseUrl ?? "");
      setCustomProtocol(s.customProviderProtocol ?? "openai");
      setLang(s.language ?? "zh");
    });
  }, []);

  useEffect(() => {
    setLang(initialLang);
  }, [initialLang]);

  const handleProviderChange = (id: ProviderId) => {
    setProviderId(id);
    setModel(getProvider(id).defaultModel);
    setApiKey("");
    setTestResult(null);
  };

  const handleSave = async () => {
    await saveSettings({
      providerId,
      apiKey: apiKey.trim(),
      apiModel: model || provider.defaultModel,
      preferredRoute: route,
      customBaseUrl: customUrl || undefined,
      customProviderProtocol: customProtocol,
      language: lang,
    });
    onLanguageChange(lang);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const currentProvider = getProvider(providerId);
      const settings = await loadSettings();
      const testBlock: QuestionBlock = {
        id: "test",
        bbox: { x: 0, y: 0, width: 100, height: 50 },
        previewText: "1+1缂備焦绋戦ˇ顔捐姳椤掍礁绶炴慨姗嗗墰濮ｅ矂鏌ㄥ☉姘姂.1 B.2 C.3 D.4",
        hasImage: !!currentProvider.supportsVision,
        imageDataUrl: currentProvider.supportsVision
          ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
          : undefined,
        questionTypeGuess: "single_choice",
        confidence: 1,
        source: "manual_capture",
      };
      const result = await parseQuestion(testBlock, {
        ...settings,
        providerId,
        apiKey: apiKey.trim(),
        apiModel: model || currentProvider.defaultModel,
        preferredRoute: currentProvider.supportsVision ? "vision" : "text",
        customBaseUrl: customUrl || undefined,
        customProviderProtocol: customProtocol,
      });
      const routeLabel = result.routeUsed === "vision" ? (isEn ? "vision" : "视觉") : result.routeUsed === "text" ? (isEn ? "text" : "文本") : (isEn ? "hybrid" : "混合");
      setTestResult(
        isEn
          ? `Connection success, route: ${routeLabel} | answer: ${result.answer} (confidence ${Math.round(result.confidence * 100)}%)`
          : `连接成功，路由: ${routeLabel} | 答案: ${result.answer} (置信度 ${Math.round(result.confidence * 100)}%)`,
      );
    } catch (err) {
      const errorMsg = String(err);
      const match = errorMsg.match(/\"message\":\"([^\"]+)\"/);
      const displayError = match ? match[1] : errorMsg.slice(0, 120);
      setTestResult(isEn ? `Failed: ${displayError}` : `测试失败: ${displayError}`);
    }
    setTesting(false);
  };

  const keyLinks: Partial<Record<ProviderId, [string, string]>> = {
    anthropic: ["https://console.anthropic.com", "Anthropic Console"],
    openai: ["https://platform.openai.com", "OpenAI Platform"],
    deepseek: ["https://platform.deepseek.com", "DeepSeek Platform"],
    gemini: ["https://aistudio.google.com", "Google AI Studio"],
    qwen: ["https://dashscope.aliyun.com", "阿里云百炼"],
    moonshot: ["https://platform.moonshot.cn", "Moonshot Platform"],
    zhipu: ["https://open.bigmodel.cn", "智谱开放平台"],
    minimax: ["https://platform.minimaxi.com", "MiniMax Platform"],
    custom: ["https://platform.openai.com/docs/api-reference/chat", "OpenAI Compatible API Docs"],
  };

  return (
    <div style={{ padding: "14px 12px", display: "flex", flexDirection: "column", gap: 16 }}>
      <FieldGroup label={isEn ? "AI Provider" : "AI 服务商"}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleProviderChange(p.id as ProviderId)}
              style={{
                padding: "8px 8px",
                borderRadius: 7,
                cursor: "pointer",
                textAlign: "left",
                border: `1px solid ${providerId === p.id ? "#4f9cf9" : "#313244"}`,
                backgroundColor: providerId === p.id ? "#1c2a3a" : "#181825",
                color: providerId === p.id ? "#89b4fa" : "#a6adc8",
                fontWeight: providerId === p.id ? 600 : 400,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              <div style={{ fontSize: 12, marginBottom: 2 }}>{p.name}</div>
              <div style={{ fontSize: 10, color: "#6c7086" }}>
                {p.supportsVision ? (isEn ? "Vision" : "支持图片") : (isEn ? "Text only" : "仅文本")}
                {p.keyOptional ? (isEn ? " | Key optional" : " | 免 Key") : ""}
              </div>
            </button>
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label={provider.keyOptional ? (isEn ? "API Key (Optional)" : "API Key（可选）") : "API Key *"}>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={provider.keyPlaceholder} style={inputStyle} />
        {!provider.keyOptional && !apiKey && (
          <div style={{ fontSize: 10, color: "#f9e2af", marginTop: 4 }}>
            {isEn ? "If unset, mock demo data will be used" : "未设置时将使用 Mock 演示数据"}
          </div>
        )}
        {keyLinks[providerId] && (
          <a href={keyLinks[providerId][0]} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#89b4fa", display: "block", marginTop: 4 }}>
            {isEn ? `Get Key at ${keyLinks[providerId][1]}` : `前往 ${keyLinks[providerId][1]} 获取 Key`}
          </a>
        )}
      </FieldGroup>

      <FieldGroup label={isEn ? "Model" : "模型"}>
        {providerId === "custom" ? (
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={isEn ? "Enter model name, e.g. gpt-4o-mini" : "手动输入模型名，如 gpt-4o-mini"}
            style={inputStyle}
          />
        ) : (
          <select value={model || provider.defaultModel} onChange={(e) => setModel(e.target.value)} style={inputStyle}>
            {provider.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </FieldGroup>

      {providerId === "custom" && (
        <FieldGroup label={isEn ? "Custom Protocol" : "自定义协议"}>
          {([
            ["openai", isEn ? "OpenAI Compatible" : "OpenAI 兼容"],
            ["anthropic", isEn ? "Claude (Anthropic) Compatible" : "Claude(Anthropic) 兼容"],
          ] as const).map(([val, label]) => (
            <label key={val} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
              <input
                type="radio"
                name="custom-protocol"
                checked={customProtocol === val}
                onChange={() => setCustomProtocol(val)}
                style={{ accentColor: "#4f9cf9" }}
              />
              <span style={{ fontSize: 13 }}>{label}</span>
            </label>
          ))}
        </FieldGroup>
      )}

      {(providerId === "ollama" || providerId === "openai" || providerId === "custom" || providerId === "anthropic" || providerId === "minimax") && (
        <FieldGroup label={isEn ? "Custom Base URL (Optional)" : "自定义 Base URL（可选）"}>
          <input type="text" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder={provider.baseUrl} style={inputStyle} />
          <div style={{ fontSize: 10, color: "#6c7086", marginTop: 4 }}>
            {isEn ? "Leave empty to use default endpoint. Proxy/self-hosted URL is supported." : "留空则使用默认地址，也可以填写代理或自托管地址。"}
          </div>
        </FieldGroup>
      )}

      <FieldGroup label={isEn ? "Parse Route" : "解析路由"}>
        {([
          ["auto", isEn ? "Auto (Recommended)" : "自动判断（推荐）"],
          ["text", isEn ? "Text First" : "文本优先"],
          ["vision", isEn ? "Vision First" : "视觉优先"],
        ] as const).map(([val, label]) => (
          <label key={val} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
            <input type="radio" name="route" checked={route === val} onChange={() => setRoute(val)} style={{ accentColor: "#4f9cf9" }} />
            <span style={{ fontSize: 13 }}>{label}</span>
          </label>
        ))}
      </FieldGroup>

      <FieldGroup label={isEn ? "UI Language" : "界面语言"}>
        <div style={{ display: "flex", gap: 8 }}>
          {(["zh", "en"] as const).map((nextLang) => (
            <button
              key={nextLang}
              onClick={() => setLang(nextLang)}
              style={{
                flex: 1,
                padding: "7px",
                borderRadius: 7,
                border: `1px solid ${lang === nextLang ? "#4f9cf9" : "#313244"}`,
                backgroundColor: lang === nextLang ? "#1c2a3a" : "transparent",
                color: lang === nextLang ? "#89b4fa" : "#6c7086",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              {nextLang === "zh" ? "中文" : "English"}
            </button>
          ))}
        </div>
      </FieldGroup>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn primary onClick={handleSave}>{saved ? (isEn ? "Saved" : "已保存") : (isEn ? "Save Settings" : "保存设置")}</Btn>
        <Btn onClick={handleTest} disabled={testing}>{testing ? (isEn ? "Testing..." : "测试中...") : (isEn ? "Connection Test" : "连接测试")}</Btn>
      </div>

      {testResult && (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            fontSize: 12,
            wordBreak: "break-all",
            backgroundColor: /^(\u8fde\u63a5\u6210\u529f|Connection success)/.test(testResult) ? "#1e3a2e" : "#2c1515",
            border: `1px solid ${/^(\u8fde\u63a5\u6210\u529f|Connection success)/.test(testResult) ? "#2d5a3d" : "#5a2d2d"}`,
            color: /^(\u8fde\u63a5\u6210\u529f|Connection success)/.test(testResult) ? "#a6e3a1" : "#f38ba8",
          }}
        >
          {testResult}
        </div>
      )}
    </div>
  );
};

const FieldGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div style={{ fontSize: 10, color: "#a6adc8", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    {children}
  </div>
);

export const Btn: React.FC<{ children: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean }> = ({ children, onClick, primary, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      padding: "7px 14px",
      borderRadius: 7,
      border: "none",
      cursor: disabled ? "not-allowed" : "pointer",
      backgroundColor: disabled ? "#313244" : primary ? "#4f9cf9" : "#313244",
      color: disabled ? "#6c7086" : primary ? "#fff" : "#cdd6f4",
      fontSize: 12,
      fontWeight: primary ? 600 : 400,
      fontFamily: "system-ui, sans-serif",
    }}
  >
    {children}
  </button>
);

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  borderRadius: 6,
  border: "1px solid #45475a",
  backgroundColor: "#181825",
  color: "#cdd6f4",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "system-ui, sans-serif",
};
