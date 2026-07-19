import React from "react";
import { AuthPasswordField, AuthVerificationCodeInput } from "@/shared/auth/AuthFields";
import { DEFAULT_ANALYTICS_BASE_URL } from "@/shared/constants/analytics";
import { SectionCard, UiButton, sectionSurfaceStyle, uiInputStyle } from "@/shared/ui/extensionUi";
import { PROVIDERS } from "@/shared/utils/parseRouter";
import type { ProviderId } from "@/shared/utils/parseRouter";
import type { UILang } from "./displayUtils";

type AuthText = {
  registerPage: string;
  loginPage: string;
  emailPlaceholder: string;
  passwordPlaceholder: string;
  sendCode: string;
  sendingCode: string;
  completeRegistration: string;
  registering: string;
  login: string;
  loggingIn: string;
  loggingOut: string;
  logout: string;
  showPassword: string;
  hidePassword: string;
};

type SettingsAuthController = {
  authBusy: "send-code" | "register" | "login" | "logout" | null;
  codeCooldown: number;
  codeSent: boolean;
  email: string;
  feedback: string;
  handleLogin: () => Promise<void>;
  handleLogout: () => Promise<void>;
  handleRegister: () => Promise<void>;
  handleSendCode: () => Promise<void>;
  password: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setVerificationCode: (value: string) => void;
  showPassword: boolean;
  switchView: (view: "register" | "login") => void;
  togglePasswordVisibility: () => void;
  userEmail: string;
  userId: string;
  verificationCode: string;
  view: "register" | "login";
};

export const providerButtonStyle: React.CSSProperties = {
  padding: "10px 11px",
  borderRadius: 12,
  border: "1px solid rgba(255, 255, 255, 0.08)",
  textAlign: "left",
  cursor: "pointer",
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

export const radioRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 11px",
  borderRadius: 12,
  border: "1px solid rgba(255, 255, 255, 0.06)",
  background: "linear-gradient(180deg, rgba(16, 24, 48, 0.75), rgba(10, 15, 30, 0.7))",
  cursor: "pointer",
};

export const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#94a3b8",
  marginTop: 6,
  lineHeight: 1.5,
};

export const linkStyle: React.CSSProperties = {
  display: "inline-block",
  marginTop: 6,
  fontSize: 11,
  color: "#a5b4fc",
  textDecoration: "none",
};

export const KEY_LINKS: Partial<Record<ProviderId, [string, string]>> = {
  anthropic: ["https://console.anthropic.com", "Anthropic Console"],
  openai: ["https://platform.openai.com", "OpenAI Platform"],
  deepseek: ["https://platform.deepseek.com", "DeepSeek Platform"],
  gemini: ["https://aistudio.google.com", "Google AI Studio"],
  qwen: ["https://dashscope.aliyun.com", "DashScope"],
  moonshot: ["https://platform.moonshot.cn", "Moonshot Platform"],
  zhipu: ["https://open.bigmodel.cn", "Zhipu Platform"],
  minimax: ["https://platform.minimaxi.com", "MiniMax Platform"],
  custom: ["https://platform.openai.com/docs/api-reference/chat", "OpenAI Compatible API Docs"],
};

export const SettingsAccountSection: React.FC<{
  auth: SettingsAuthController;
  authText: AuthText;
  isEn: boolean;
}> = ({ auth, authText, isEn }) => (
  <SectionCard
    title={isEn ? "Plugin Access Account" : "插件访问账号"}
    description={
      isEn
        ? "Registration and login now live on separate pages. Registration requires a real email verification code."
        : "注册页和登录页已经拆开，注册需要真实邮箱验证码。"
    }
  >
    {auth.userId ? (
      <div
        style={{
          display: "grid",
          gap: 12,
          padding: 12,
          borderRadius: 14,
          border: "1px solid rgba(255, 255, 255, 0.06)",
          background: "linear-gradient(180deg, rgba(16, 24, 48, 0.75), rgba(10, 15, 30, 0.7))",
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#ebffff" }}>{isEn ? "Current Account" : "当前账号"}</div>
          <div style={hintStyle}>{isEn ? `Logged in as ${auth.userEmail}` : `已登录：${auth.userEmail}`}</div>
          <div style={hintStyle}>{isEn ? `User ID: ${auth.userId}` : `用户 ID：${auth.userId}`}</div>
        </div>
        <UiButton danger onClick={() => void auth.handleLogout()} disabled={auth.authBusy === "logout"}>
          {auth.authBusy === "logout" ? authText.loggingOut : authText.logout}
        </UiButton>
      </div>
    ) : (
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <UiButton primary={auth.view === "register"} onClick={() => auth.switchView("register")}>
            {authText.registerPage}
          </UiButton>
          <UiButton primary={auth.view === "login"} onClick={() => auth.switchView("login")}>
            {authText.loginPage}
          </UiButton>
        </div>

        {auth.view === "register" ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
              <input
                type="email"
                value={auth.email}
                onChange={(event) => auth.setEmail(event.target.value)}
                placeholder={authText.emailPlaceholder}
                style={uiInputStyle}
              />
              <UiButton onClick={() => void auth.handleSendCode()} disabled={!!auth.authBusy || auth.codeCooldown > 0}>
                {auth.authBusy === "send-code"
                  ? authText.sendingCode
                  : auth.codeCooldown > 0
                    ? `${auth.codeCooldown}s`
                    : authText.sendCode}
              </UiButton>
            </div>
            <AuthPasswordField
              value={auth.password}
              onChange={auth.setPassword}
              visible={auth.showPassword}
              onToggleVisibility={auth.togglePasswordVisibility}
              placeholder={authText.passwordPlaceholder}
              showLabel={authText.showPassword}
              hideLabel={authText.hidePassword}
            />
            {auth.codeSent ? (
              <>
                <AuthVerificationCodeInput value={auth.verificationCode} onChange={auth.setVerificationCode} />
                <UiButton primary onClick={() => void auth.handleRegister()} disabled={!!auth.authBusy}>
                  {auth.authBusy === "register" ? authText.registering : authText.completeRegistration}
                </UiButton>
              </>
            ) : null}
          </>
        ) : (
          <>
            <input
              type="email"
              value={auth.email}
              onChange={(event) => auth.setEmail(event.target.value)}
              placeholder={authText.emailPlaceholder}
              style={uiInputStyle}
            />
            <AuthPasswordField
              value={auth.password}
              onChange={auth.setPassword}
              visible={auth.showPassword}
              onToggleVisibility={auth.togglePasswordVisibility}
              placeholder={authText.passwordPlaceholder}
              showLabel={authText.showPassword}
              hideLabel={authText.hidePassword}
            />
            <UiButton primary onClick={() => void auth.handleLogin()} disabled={!!auth.authBusy}>
              {auth.authBusy === "login" ? authText.loggingIn : authText.login}
            </UiButton>
          </>
        )}

        {auth.feedback ? (
          <div
            style={{
              ...hintStyle,
              color: /success|succeeded|logged out|sent|成功|已退出/.test(auth.feedback) ? "#9ffff6" : "#ff9fda",
            }}
          >
            {auth.feedback}
          </div>
        ) : null}
      </div>
    )}
  </SectionCard>
);

export const SettingsConfigSections: React.FC<{
  analyticsBaseUrl: string;
  apiKey: string;
  customProtocol: "openai" | "anthropic";
  customUrl: string;
  deviceId: string;
  handleProviderChange: (id: ProviderId) => void;
  isEn: boolean;
  lang: UILang;
  model: string;
  provider: {
    baseUrl: string;
    defaultModel: string;
    keyOptional?: boolean;
    keyPlaceholder?: string;
    models: string[];
  };
  providerId: ProviderId;
  route: "auto" | "text" | "vision";
  setAnalyticsBaseUrl: (value: string) => void;
  setApiKey: (value: string) => void;
  setCustomProtocol: (value: "openai" | "anthropic") => void;
  setCustomUrl: (value: string) => void;
  setLang: (value: UILang) => void;
  setModel: (value: string) => void;
  setRoute: (value: "auto" | "text" | "vision") => void;
}> = ({
  analyticsBaseUrl,
  apiKey,
  customProtocol,
  customUrl,
  deviceId,
  handleProviderChange,
  isEn,
  lang,
  model,
  provider,
  providerId,
  route,
  setAnalyticsBaseUrl,
  setApiKey,
  setCustomProtocol,
  setCustomUrl,
  setLang,
  setModel,
  setRoute,
}) => (
  <>
    <SectionCard title={isEn ? "Provider" : "服务商"} description={isEn ? "Choose the model provider used for parsing." : "选择解析时使用的模型服务商。"}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {PROVIDERS.map((item) => (
          <button
            key={item.id}
            onClick={() => handleProviderChange(item.id as ProviderId)}
            style={{
              ...providerButtonStyle,
              borderColor: providerId === item.id ? "rgba(99, 102, 241, 0.4)" : "rgba(255, 255, 255, 0.06)",
              background:
                providerId === item.id
                  ? "linear-gradient(180deg, rgba(99, 102, 241, 0.18), rgba(139, 92, 246, 0.12))"
                  : "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 650, color: providerId === item.id ? "#a5b4fc" : "#edf3fb", letterSpacing: -0.15 }}>
              {item.name}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
              {item.supportsVision ? (isEn ? "Vision supported" : "支持图像") : isEn ? "Text only" : "仅文本"}
              {item.keyOptional ? (isEn ? " - Key optional" : " - Key 可选") : ""}
            </div>
          </button>
        ))}
      </div>
    </SectionCard>

    <SectionCard title={provider.keyOptional ? "API Key" : "API Key *"} description={isEn ? "Leave empty only when the provider supports demo or local mode." : "仅在服务商支持演示或本地模式时可以留空。"}>
      <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={provider.keyPlaceholder} style={uiInputStyle} />
      {!provider.keyOptional && !apiKey ? <div style={hintStyle}>{isEn ? "If empty, the extension will fall back to mock demo data." : "未填写时，插件会回退到 Mock 演示数据。"}</div> : null}
      {KEY_LINKS[providerId] ? (
        <a href={KEY_LINKS[providerId][0]} target="_blank" rel="noreferrer" style={linkStyle}>
          {isEn ? `Get key from ${KEY_LINKS[providerId][1]}` : `前往 ${KEY_LINKS[providerId][1]} 获取 Key`}
        </a>
      ) : null}
    </SectionCard>

    <SectionCard title={isEn ? "Model" : "模型"} description={isEn ? "Pick a preset model or type one manually." : "选择预设模型，或手动输入名称。"}>
      {providerId === "custom" ? (
        <input type="text" value={model} onChange={(event) => setModel(event.target.value)} placeholder={isEn ? "Enter model name, for example gpt-5.4-mini" : "输入模型名，例如 gpt-5.4-mini"} style={uiInputStyle} />
      ) : (
        <select value={model || provider.defaultModel} onChange={(event) => setModel(event.target.value)} style={uiInputStyle}>
          {provider.models.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      )}
    </SectionCard>

    {providerId === "custom" ? (
      <SectionCard title={isEn ? "Custom Protocol" : "自定义协议"} description={isEn ? "Choose the API format exposed by your endpoint." : "选择你的接口所兼容的 API 格式。"}>
        <div style={{ display: "grid", gap: 8 }}>
          {([
            ["openai", isEn ? "OpenAI Compatible" : "OpenAI 兼容"],
            ["anthropic", isEn ? "Claude Compatible" : "Claude 兼容"],
          ] as const).map(([value, label]) => (
            <label key={value} style={radioRowStyle}>
              <input type="radio" name="custom-protocol" checked={customProtocol === value} onChange={() => setCustomProtocol(value)} style={{ accentColor: "#6366f1" }} />
              <span style={{ fontSize: 13, color: "#edf3fb", fontWeight: 500 }}>{label}</span>
            </label>
          ))}
        </div>
      </SectionCard>
    ) : null}

    {providerId === "ollama" || providerId === "openai" || providerId === "custom" || providerId === "anthropic" || providerId === "minimax" ? (
      <SectionCard title="Base URL" description={isEn ? "Optional proxy or self-hosted endpoint." : "可选，用于代理或自托管端点。"}>
        <input type="text" value={customUrl} onChange={(event) => setCustomUrl(event.target.value)} placeholder={provider.baseUrl} style={uiInputStyle} />
        <div style={hintStyle}>{isEn ? "Leave empty to use the provider default endpoint." : "留空则使用服务商默认地址。"}</div>
      </SectionCard>
    ) : null}

    <SectionCard title={isEn ? "Analytics Backend" : "统计后端"} description={isEn ? "Registration, login, and active-user events are sent to this service." : "邮箱注册、登录和活跃用户事件会发送到这个后端服务。"}>
      <input type="text" value={analyticsBaseUrl} onChange={(event) => setAnalyticsBaseUrl(event.target.value)} placeholder={DEFAULT_ANALYTICS_BASE_URL} style={uiInputStyle} />
      <div style={hintStyle}>{isEn ? `Device ID: ${deviceId || "loading..."}` : `设备 ID：${deviceId || "加载中..."}`}</div>
    </SectionCard>

    <SectionCard title={isEn ? "Parse Route" : "解析路由"} description={isEn ? "Auto is safer. Force text or vision only when you know the page pattern." : "自动模式更稳，只有明确知道页面特征时再强制文本或视觉。"}>
      <div style={{ display: "grid", gap: 8 }}>
        {([
          ["auto", isEn ? "Auto" : "自动"],
          ["text", isEn ? "Text First" : "文本优先"],
          ["vision", isEn ? "Vision First" : "视觉优先"],
        ] as const).map(([value, label]) => (
          <label key={value} style={radioRowStyle}>
            <input type="radio" name="route" checked={route === value} onChange={() => setRoute(value)} style={{ accentColor: "#6366f1" }} />
            <span style={{ fontSize: 13, color: "#e5edf7" }}>{label}</span>
          </label>
        ))}
      </div>
    </SectionCard>

    <SectionCard title={isEn ? "Language" : "界面语言"} description={isEn ? "The popup and side panel follow this setting globally." : "Popup 和 Side Panel 都会全局跟随这个设置。"}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {(["zh", "en"] as const).map((nextLang) => (
          <button
            key={nextLang}
            onClick={() => setLang(nextLang)}
            style={{
              ...providerButtonStyle,
              padding: "11px 12px",
              borderColor: lang === nextLang ? "rgba(99, 102, 241, 0.4)" : "rgba(255, 255, 255, 0.06)",
              background:
                lang === nextLang
                  ? "linear-gradient(180deg, rgba(99, 102, 241, 0.18), rgba(139, 92, 246, 0.12))"
                  : "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 650, color: lang === nextLang ? "#a5b4fc" : "#edf3fb", letterSpacing: -0.15 }}>
              {nextLang === "zh" ? "中文" : "English"}
            </div>
          </button>
        ))}
      </div>
    </SectionCard>
  </>
);

export const SettingsActionsSection: React.FC<{
  isEn: boolean;
  onSave: () => void;
  onTest: () => void;
  saved: boolean;
  testResult: string | null;
  testing: boolean;
}> = ({ isEn, onSave, onTest, saved, testResult, testing }) => (
  <>
    <div
      className="settings-card settings-action"
      style={{
        ...sectionSurfaceStyle,
        padding: 12,
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <UiButton primary onClick={onSave}>
        {saved ? (isEn ? "Saved" : "已保存") : isEn ? "Save Settings" : "保存设置"}
      </UiButton>
      <UiButton onClick={onTest} disabled={testing}>
        {testing ? (isEn ? "Testing..." : "测试中...") : isEn ? "Connection Test" : "连接测试"}
      </UiButton>
    </div>

    {testResult ? (
      <div
        className="settings-card settings-action"
        style={{
          ...sectionSurfaceStyle,
          padding: "11px 12px",
          borderColor: /^(连接成功|Connection success)/.test(testResult) ? "rgba(220, 250, 230, 0.12)" : "rgba(255, 220, 220, 0.12)",
          background: /^(连接成功|Connection success)/.test(testResult)
            ? "linear-gradient(180deg, rgba(36, 59, 45, 0.8), rgba(28, 47, 36, 0.72))"
            : "linear-gradient(180deg, rgba(74, 44, 49, 0.82), rgba(55, 33, 37, 0.74))",
          color: /^(连接成功|Connection success)/.test(testResult) ? "#cffff0" : "#ff8dd1",
          fontSize: 12,
          lineHeight: 1.6,
          wordBreak: "break-word",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {testResult}
      </div>
    ) : null}
  </>
);
