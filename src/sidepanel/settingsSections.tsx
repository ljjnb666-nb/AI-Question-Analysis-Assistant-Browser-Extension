import React, { useState } from "react";
import { AuthPasswordField, AuthVerificationCodeInput } from "@/shared/auth/AuthFields";
import { DEFAULT_ANALYTICS_BASE_URL } from "@/shared/constants/analytics";
import { SectionCard, UiButton, sectionSurfaceStyle, uiInputStyle } from "@/shared/ui/extensionUi";
import {
  OrbitBadge,
  OrbitStatus,
} from "@/shared/ui/orbitPrimitives";
import {
  orbitColors,
  orbitRadius,
  orbitTypography,
} from "@/shared/ui/orbitTokens";
import type { UserFeedback } from "@/shared/ui/userFeedback";
import { PROVIDERS } from "@/shared/ai/providers";
import type { ProviderConfig, ProviderId } from "@/shared/ai/providers";
import type { UILang } from "./displayUtils";
import { getSettingsCopy, type SetupStatusType } from "./settingsCopy";

type AuthText = {
  registerPage: string;
  loginPage: string;
  emailPlaceholder: string;
  passwordPlaceholder: string;
  verificationCodePlaceholder: string;
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
  validatingSession: string;
  sessionUnavailable: string;
  sessionUnavailableHint: string;
  retrySession: string;
  sessionExpired: string;
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
  isAuthenticated: boolean;
  isSessionPending: boolean;
  isServerUnavailable: boolean;
  password: string;
  retryValidation: () => Promise<void>;
  sessionRejected: boolean;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setVerificationCode: (value: string) => void;
  showPassword: boolean;
  status: "loading" | "validating" | "authenticated" | "unauthenticated" | "server_unavailable";
  switchView: (view: "register" | "login") => void;
  togglePasswordVisibility: () => void;
  userEmail: string;
  userId: string;
  verificationCode: string;
  view: "register" | "login";
};

export const providerButtonStyle: React.CSSProperties = {
  padding: "9px 10px",
  borderRadius: orbitRadius.md,
  border: `1px solid ${orbitColors.border.subtle}`,
  textAlign: "left",
  cursor: "pointer",
  fontFamily: orbitTypography.fontFamily,
  transition: "all 0.16s ease",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  boxSizing: "border-box",
  width: "100%",
};

export const radioRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 11px",
  borderRadius: orbitRadius.md,
  border: `1px solid ${orbitColors.border.subtle}`,
  background: orbitColors.bg.surfaceSubtle,
  cursor: "pointer",
};

export const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: orbitColors.text.secondary,
  marginTop: 6,
  lineHeight: 1.5,
};

export const linkStyle: React.CSSProperties = {
  display: "inline-block",
  marginTop: 6,
  fontSize: 11,
  color: orbitColors.brand.border,
  textDecoration: "none",
  fontWeight: 500,
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

export interface ProviderCatalogMeta {
  shortDesc: { zh: string; en: string };
  modelFamily: { zh: string; en: string };
  connectionType: { zh: string; en: string };
  badge?: { zh: string; en: string };
}

export const PROVIDER_CATALOG_META: Record<ProviderId, ProviderCatalogMeta> = {
  anthropic: {
    shortDesc: { zh: "高智力、长文本上下文推理", en: "High-intelligence reasoning & long context" },
    modelFamily: { zh: "Claude 系列模型", en: "Claude model series" },
    connectionType: { zh: "Cloud API", en: "Cloud API" },
    badge: { zh: "官方推荐", en: "Recommended" },
  },
  openai: {
    shortDesc: { zh: "通用智能与多模态标杆", en: "General AI & multimodal benchmark" },
    modelFamily: { zh: "GPT 系列模型", en: "GPT model series" },
    connectionType: { zh: "Cloud API", en: "Cloud API" },
    badge: { zh: "官方推荐", en: "Recommended" },
  },
  gemini: {
    shortDesc: { zh: "Google 原生多模态理解", en: "Google native multimodal understanding" },
    modelFamily: { zh: "Gemini 系列模型", en: "Gemini model series" },
    connectionType: { zh: "Cloud API", en: "Cloud API" },
  },
  deepseek: {
    shortDesc: { zh: "高性价比长链推理", en: "Cost-effective deep reasoning" },
    modelFamily: { zh: "DeepSeek 系列模型", en: "DeepSeek model series" },
    connectionType: { zh: "Cloud API", en: "Cloud API" },
  },
  qwen: {
    shortDesc: { zh: "阿里云百炼官方兼容服务", en: "Alibaba Cloud DashScope service" },
    modelFamily: { zh: "通义千问 Qwen 系列", en: "Qwen model series" },
    connectionType: { zh: "Cloud API", en: "Cloud API" },
  },
  moonshot: {
    shortDesc: { zh: "超长文本长链分析", en: "Ultra-long context comprehension" },
    modelFamily: { zh: "Kimi 系列模型", en: "Kimi model series" },
    connectionType: { zh: "Cloud API", en: "Cloud API" },
  },
  zhipu: {
    shortDesc: { zh: "国产大模型多模态能力", en: "Domestic GLM multimodal capability" },
    modelFamily: { zh: "GLM 系列模型", en: "GLM model series" },
    connectionType: { zh: "Cloud API", en: "Cloud API" },
  },
  minimax: {
    shortDesc: { zh: "快速多语言综合分析", en: "Fast multilingual synthesis" },
    modelFamily: { zh: "MiniMax 系列模型", en: "MiniMax model series" },
    connectionType: { zh: "Cloud API", en: "Cloud API" },
  },
  ollama: {
    shortDesc: { zh: "本地运行开源大模型", en: "Local runtime for open-weights models" },
    modelFamily: { zh: "本地运行时 (Local)", en: "Local Runtime" },
    connectionType: { zh: "Local Runtime", en: "Local Runtime" },
    badge: { zh: "本地私有", en: "Local" },
  },
  custom: {
    shortDesc: { zh: "自建网关或第三方中转代理", en: "Self-hosted gateway or third-party proxy" },
    modelFamily: { zh: "OpenAI / Claude 兼容协议", en: "OpenAI / Claude wire protocols" },
    connectionType: { zh: "Custom Gateway", en: "Custom Gateway" },
    badge: { zh: "自建网关", en: "Gateway" },
  },
};

/**
 * 0. Settings Home — Active Connection Summary Card
 */
export const SettingsHomeSummaryCard: React.FC<{
  providerName: string;
  modelName: string;
  connectionStatus: SetupStatusType;
  hasCredential: boolean;
  keyOptional?: boolean;
  isEn: boolean;
  onChangeService: () => void;
  onEditConnection: () => void;
  onTestConnection: () => void;
  testing?: boolean;
}> = ({
  providerName,
  modelName,
  connectionStatus,
  hasCredential,
  keyOptional,
  isEn,
  onChangeService,
  onEditConnection,
  onTestConnection,
  testing,
}) => {
  const copy = getSettingsCopy(isEn ? "en" : "zh");

  const statusToneMap: Record<SetupStatusType, "success" | "warning" | "error" | "ai" | "info"> = {
    validated: "success",
    not_configured: "warning",
    incomplete: "warning",
    testing: "ai",
    saved_untested: "info",
    error: "error",
  };

  const statusLabel =
    connectionStatus === "validated"
      ? copy.summaryCard.connected
      : connectionStatus === "not_configured"
        ? copy.summaryCard.unconfigured
        : connectionStatus === "testing"
          ? copy.summaryCard.testing
          : connectionStatus === "error"
            ? copy.summaryCard.failed
            : copy.summaryCard.retest;

  const credentialLabel = hasCredential
    ? copy.summaryCard.credentialSaved
    : keyOptional
      ? copy.summaryCard.keyOptional
      : copy.summaryCard.credentialMissing;

  return (
    <section
      className="settings-card"
      data-testid="settings-home-summary-card"
      style={{
        ...sectionSurfaceStyle,
        padding: "14px 16px",
        borderRadius: orbitRadius.lg,
        border: `1px solid ${connectionStatus === "validated" ? orbitColors.semantic.successBorder : orbitColors.border.subtle}`,
        background: connectionStatus === "validated"
          ? `linear-gradient(180deg, rgba(16, 185, 129, 0.08), rgba(20, 24, 31, 0.95))`
          : `linear-gradient(180deg, rgba(37, 99, 235, 0.06), rgba(20, 24, 31, 0.95))`,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxSizing: "border-box",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: orbitColors.text.muted, fontWeight: 500, letterSpacing: 0.5, textTransform: "uppercase" }}>
            {copy.summaryCard.title}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: orbitColors.text.primary, marginTop: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>{providerName}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: orbitColors.brand.border, background: "rgba(59, 130, 246, 0.1)", padding: "2px 8px", borderRadius: orbitRadius.pill }}>
              {modelName}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <OrbitBadge variant={statusToneMap[connectionStatus]} dot>
            {statusLabel}
          </OrbitBadge>
          <OrbitBadge variant={hasCredential || keyOptional ? "neutral" : "warning"}>
            {credentialLabel}
          </OrbitBadge>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 4, borderTop: `1px solid ${orbitColors.border.subtle}` }}>
        <button
          type="button"
          onClick={onChangeService}
          style={{
            ...providerButtonStyle,
            width: "auto",
            padding: "6px 12px",
            background: orbitColors.brand.primary,
            borderColor: orbitColors.brand.border,
            color: orbitColors.control.onAccent,
            fontWeight: 600,
            fontSize: 12,
            cursor: "pointer",
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          {copy.summaryCard.changeService}
        </button>

        <button
          type="button"
          onClick={onEditConnection}
          style={{
            ...providerButtonStyle,
            width: "auto",
            padding: "6px 12px",
            background: orbitColors.bg.surfaceRaised,
            borderColor: orbitColors.border.subtle,
            color: orbitColors.text.secondary,
            fontWeight: 500,
            fontSize: 12,
            cursor: "pointer",
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          {copy.summaryCard.editConnection}
        </button>

        <button
          type="button"
          onClick={onTestConnection}
          disabled={testing}
          style={{
            ...providerButtonStyle,
            width: "auto",
            padding: "6px 12px",
            background: "transparent",
            borderColor: orbitColors.border.subtle,
            color: testing ? orbitColors.text.muted : orbitColors.brand.border,
            fontWeight: 500,
            fontSize: 12,
            cursor: testing ? "not-allowed" : "pointer",
            flexDirection: "row",
            alignItems: "center",
            marginLeft: "auto",
          }}
        >
          {testing ? (isEn ? "Verifying..." : "正在验证...") : copy.summaryCard.testConnection}
        </button>
      </div>
    </section>
  );
};

/**
 * 1. Setup Status & Onboarding Stepper Header
 */
export const SettingsSetupStatusCard: React.FC<{
  status: SetupStatusType;
  isEn: boolean;
  activeStep: number;
  onRetest?: () => void;
}> = ({ status, isEn, activeStep, onRetest }) => {
  const copy = getSettingsCopy(isEn ? "en" : "zh");

  const statusToneMap: Record<SetupStatusType, "info" | "warning" | "ai" | "success" | "error"> = {
    not_configured: "warning",
    incomplete: "warning",
    saved_untested: "info",
    testing: "ai",
    validated: "success",
    error: "error",
  };

  const statusTone = statusToneMap[status] ?? "info";
  const statusLabel = copy.status[status];

  // Collapsed calm state after configuration succeeds
  if (status === "validated") {
    return (
      <section
        className="settings-card"
        data-testid="settings-ready-banner"
        style={{
          ...sectionSurfaceStyle,
          padding: "14px 16px",
          border: `1px solid ${orbitColors.semantic.successBorder}`,
          background: `linear-gradient(180deg, ${orbitColors.semantic.successSurface}, rgba(20, 24, 31, 0.95))`,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <OrbitStatus tone="success" label={copy.readyBanner.title} />
          <OrbitBadge variant="success" dot>
            {copy.readyBanner.badge}
          </OrbitBadge>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: orbitColors.text.secondary, lineHeight: 1.5 }}>
          {copy.readyBanner.description}
        </p>
        {onRetest ? (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button
              type="button"
              onClick={onRetest}
              style={{
                background: "transparent",
                border: "none",
                color: orbitColors.semantic.success,
                fontSize: 11,
                cursor: "pointer",
                padding: "2px 6px",
                textDecoration: "underline",
              }}
            >
              {copy.readyBanner.retest}
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  const steps = [
    { num: 1, label: copy.stepper.step1 },
    { num: 2, label: copy.stepper.step2 },
    { num: 3, label: copy.stepper.step3 },
    { num: 4, label: copy.stepper.step4 },
  ];

  return (
    <section
      className="settings-card"
      data-testid="settings-setup-status-card"
      style={{
        ...sectionSurfaceStyle,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxSizing: "border-box",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 650, color: orbitColors.text.primary, letterSpacing: -0.15 }}>
          {copy.stepper.title}
        </div>
        <OrbitStatus tone={statusTone} label={statusLabel} />
      </div>

      {/* 4-Step Inline Stepper */}
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={4}
        aria-valuenow={activeStep}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 6,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {steps.map((st) => {
          const isDone = st.num < activeStep;
          const isCurrent = st.num === activeStep;
          return (
            <div
              key={st.num}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "6px 5px",
                minWidth: 0,
                boxSizing: "border-box",
                borderRadius: orbitRadius.sm,
                background: isCurrent
                  ? orbitColors.bg.surfaceRaised
                  : isDone
                    ? "rgba(16, 185, 129, 0.08)"
                    : orbitColors.bg.surfaceSubtle,
                border: isCurrent
                  ? `1px solid ${orbitColors.brand.border}`
                  : isDone
                    ? `1px solid ${orbitColors.semantic.successBorder}`
                    : `1px solid ${orbitColors.border.subtle}`,
                transition: "all 0.18s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 14,
                    height: 14,
                    borderRadius: orbitRadius.pill,
                    fontSize: 9,
                    fontWeight: 700,
                    background: isDone
                      ? orbitColors.semantic.success
                      : isCurrent
                        ? orbitColors.brand.primary
                        : orbitColors.border.strong,
                    color: orbitColors.control.onAccent,
                    flexShrink: 0,
                  }}
                >
                  {isDone ? "✓" : st.num}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: isCurrent ? 600 : 400,
                    color: isCurrent
                      ? orbitColors.text.primary
                      : isDone
                        ? orbitColors.semantic.success
                        : orbitColors.text.muted,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    minWidth: 0,
                  }}
                >
                  {st.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

/**
 * 2. Provider Picker (Card Grid)
 */
export const SettingsProviderPicker: React.FC<{
  providerId: ProviderId;
  onProviderChange: (id: ProviderId) => void;
  isEn: boolean;
}> = ({ providerId, onProviderChange, isEn }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const copy = getSettingsCopy(isEn ? "en" : "zh");

  const query = searchQuery.trim().toLowerCase();
  const filteredProviders = PROVIDERS.filter((item) => {
    if (!query) return true;
    const meta = PROVIDER_CATALOG_META[item.id as ProviderId];
    return (
      item.name.toLowerCase().includes(query) ||
      item.id.toLowerCase().includes(query) ||
      item.defaultModel.toLowerCase().includes(query) ||
      item.models.some((m) => m.toLowerCase().includes(query)) ||
      (meta && (
        meta.modelFamily.zh.toLowerCase().includes(query) ||
        meta.modelFamily.en.toLowerCase().includes(query) ||
        meta.shortDesc.zh.toLowerCase().includes(query) ||
        meta.shortDesc.en.toLowerCase().includes(query)
      ))
    );
  });

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIndex = (index + 1) % filteredProviders.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIndex = (index - 1 + filteredProviders.length) % filteredProviders.length;
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onProviderChange(filteredProviders[index].id as ProviderId);
      return;
    }
    if (nextIndex >= 0) {
      e.preventDefault();
      onProviderChange(filteredProviders[nextIndex].id as ProviderId);
      const targetBtn = document.getElementById(`provider-card-${filteredProviders[nextIndex].id}`);
      targetBtn?.focus();
    }
  };

  return (
    <SectionCard title={copy.provider.title} description={copy.provider.description}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          id="provider-search-input"
          data-testid="provider-search-input"
          type="text"
          placeholder={copy.summaryCard.searchPlaceholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label={isEn ? "Search providers" : "搜索服务商"}
          style={{
            ...uiInputStyle,
            padding: "8px 12px",
            fontSize: 12,
            background: orbitColors.bg.surfaceSubtle,
          }}
        />

        <div
          role="radiogroup"
          aria-label={copy.provider.title}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 8,
          }}
        >
          {filteredProviders.map((item, idx) => {
            const isSelected = providerId === item.id;
            const meta = PROVIDER_CATALOG_META[item.id as ProviderId];
            return (
              <button
                key={item.id}
                id={`provider-card-${item.id}`}
                data-testid={`provider-card-${item.id}`}
                type="button"
                aria-pressed={isSelected}
                tabIndex={0}
                onClick={() => onProviderChange(item.id as ProviderId)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                style={{
                  ...providerButtonStyle,
                  borderColor: isSelected ? orbitColors.brand.primary : orbitColors.border.subtle,
                  background: isSelected
                    ? `linear-gradient(180deg, rgba(37, 99, 235, 0.16), rgba(30, 41, 59, 0.45))`
                    : orbitColors.bg.surfaceSubtle,
                  boxShadow: isSelected ? `0 0 0 1px ${orbitColors.brand.primary}` : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: isSelected ? 650 : 500,
                      color: isSelected ? orbitColors.text.primary : orbitColors.text.secondary,
                      letterSpacing: -0.1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.name}
                  </span>
                  {isSelected ? (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: orbitRadius.pill,
                        backgroundColor: orbitColors.brand.primary,
                        flexShrink: 0,
                      }}
                    />
                  ) : null}
                </div>

                {meta ? (
                  <div style={{ fontSize: 10, color: orbitColors.brand.border, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {meta.modelFamily[isEn ? "en" : "zh"]}
                  </div>
                ) : null}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "1px 4px",
                      borderRadius: orbitRadius.sm,
                      background: item.supportsVision ? "rgba(16, 185, 129, 0.1)" : "rgba(255, 255, 255, 0.04)",
                      color: item.supportsVision ? orbitColors.semantic.success : orbitColors.text.muted,
                    }}
                  >
                    {item.supportsVision ? copy.provider.supportsVision : copy.provider.textOnly}
                  </span>
                  {item.keyOptional ? (
                    <span
                      style={{
                        fontSize: 10,
                        padding: "1px 4px",
                        borderRadius: orbitRadius.sm,
                        background: "rgba(59, 130, 246, 0.1)",
                        color: orbitColors.semantic.info,
                      }}
                    >
                      {copy.provider.keyOptional}
                    </span>
                  ) : null}
                  {meta?.badge ? (
                    <span
                      style={{
                        fontSize: 9,
                        padding: "1px 4px",
                        borderRadius: orbitRadius.sm,
                        background: "rgba(255, 255, 255, 0.06)",
                        color: orbitColors.text.secondary,
                      }}
                    >
                      {meta.badge[isEn ? "en" : "zh"]}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
};

/**
 * 3. API Key & Credentials Section
 */
export const SettingsCredentialsSection: React.FC<{
  apiKey: string;
  hasCredential?: boolean;
  onApiKeyChange: (value: string) => void;
  onClearCredential?: () => void;
  provider: ProviderConfig;
  providerId: ProviderId;
  isEn: boolean;
}> = ({ apiKey, hasCredential = false, onApiKeyChange, onClearCredential, provider, providerId, isEn }) => {
  const [showKey, setShowKey] = useState(false);
  const copy = getSettingsCopy(isEn ? "en" : "zh");

  const title = provider.keyOptional ? copy.credentials.titleKey : copy.credentials.titleKeyRequired;
  const description = provider.keyOptional ? copy.credentials.descOptional : copy.credentials.descRequired;

  const keyLink = KEY_LINKS[providerId];

  return (
    <SectionCard title={title} description={description}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {provider.keyOptional ? (
          <div
            style={{
              padding: "7px 10px",
              borderRadius: orbitRadius.sm,
              background: "rgba(59, 130, 246, 0.08)",
              border: `1px solid ${orbitColors.border.subtle}`,
              fontSize: 11,
              color: orbitColors.semantic.info,
            }}
          >
            {copy.credentials.localHint}
          </div>
        ) : null}

        {hasCredential && !apiKey ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "7px 10px",
              borderRadius: orbitRadius.sm,
              background: "rgba(16, 185, 129, 0.08)",
              border: `1px solid ${orbitColors.semantic.successBorder}`,
              fontSize: 12,
            }}
          >
            <span style={{ color: orbitColors.semantic.success, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: orbitColors.semantic.success }} />
              {isEn ? "Credential stored (secret hidden)" : "已保存密钥（已加密隐藏）"}
            </span>
            {onClearCredential ? (
              <button
                type="button"
                onClick={onClearCredential}
                style={{
                  background: "transparent",
                  border: "none",
                  color: orbitColors.semantic.error,
                  fontSize: 11,
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: 0,
                }}
              >
                {copy.summaryCard.clearKey}
              </button>
            ) : null}
          </div>
        ) : null}

        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <input
            id="settings-api-key-input"
            data-testid="settings-api-key-input"
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={provider.keyPlaceholder}
            aria-label={title}
            style={{
              ...uiInputStyle,
              paddingRight: 64,
            }}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            aria-label={showKey ? copy.credentials.hideKey : copy.credentials.showKey}
            aria-pressed={showKey}
            style={{
              position: "absolute",
              right: 6,
              background: "transparent",
              border: `1px solid ${orbitColors.border.subtle}`,
              borderRadius: orbitRadius.sm,
              padding: "4px 8px",
              fontSize: 11,
              color: showKey ? orbitColors.brand.border : orbitColors.text.muted,
              cursor: "pointer",
            }}
          >
            {showKey ? (isEn ? "Hide" : "隐藏") : isEn ? "Show" : "显示"}
          </button>
        </div>

        {!provider.keyOptional && !apiKey && !hasCredential ? (
          <div style={{ ...hintStyle, color: orbitColors.semantic.warning }}>
            {copy.credentials.emptyHint}
          </div>
        ) : null}

        {keyLink ? (
          <div>
            <a
              href={keyLink[0]}
              target="_blank"
              rel="noreferrer"
              style={linkStyle}
            >
              {copy.credentials.getKeyLink(keyLink[1])} →
            </a>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
};

/**
 * 4. Model Selection Section
 */
export const SettingsModelSection: React.FC<{
  model: string;
  onModelChange: (value: string) => void;
  provider: ProviderConfig;
  providerId: ProviderId;
  isEn: boolean;
}> = ({ model, onModelChange, provider, providerId, isEn }) => {
  const [customMode, setCustomMode] = useState(false);
  const copy = getSettingsCopy(isEn ? "en" : "zh");

  const effectiveValue = model || provider.defaultModel;

  return (
    <SectionCard title={copy.model.title} description={copy.model.description}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {providerId === "custom" || customMode ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              id="settings-model-input"
              data-testid="settings-model-input"
              type="text"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              placeholder={copy.model.customModelInput}
              aria-label={copy.model.title}
              style={uiInputStyle}
            />
            {providerId !== "custom" ? (
              <button
                type="button"
                onClick={() => {
                  setCustomMode(false);
                  onModelChange(provider.defaultModel);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: orbitColors.brand.border,
                  fontSize: 11,
                  textAlign: "left",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                ← {copy.model.usePresetPrompt}
              </button>
            ) : null}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <select
              id="settings-model-select"
              data-testid="settings-model-select"
              value={effectiveValue}
              onChange={(e) => onModelChange(e.target.value)}
              aria-label={copy.model.title}
              style={{
                ...uiInputStyle,
                cursor: "pointer",
              }}
            >
              {provider.models.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setCustomMode(true)}
              style={{
                background: "transparent",
                border: "none",
                color: orbitColors.text.muted,
                fontSize: 11,
                textAlign: "left",
                cursor: "pointer",
                padding: 0,
              }}
            >
              ✎ {copy.model.customInputPrompt}
            </button>
          </div>
        )}
      </div>
    </SectionCard>
  );
};

/**
 * 5. Base URL Section (Direct for Ollama & Custom)
 */
export const SettingsBaseUrlCard: React.FC<{
  customUrl: string;
  onCustomUrlChange: (value: string) => void;
  provider: ProviderConfig;
  providerId: ProviderId;
  isEn: boolean;
}> = ({ customUrl, onCustomUrlChange, provider, providerId, isEn }) => {
  const copy = getSettingsCopy(isEn ? "en" : "zh");

  const trimmed = customUrl.trim();
  const isInvalidUrl = trimmed.length > 0 && !/^https?:\/\//i.test(trimmed);

  return (
    <SectionCard title={copy.baseUrl.title} description={copy.baseUrl.description}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <input
          id="settings-base-url-input"
          data-testid="settings-base-url-input"
          type="text"
          value={customUrl}
          onChange={(e) => onCustomUrlChange(e.target.value)}
          placeholder={provider.baseUrl}
          aria-label={copy.baseUrl.title}
          style={{
            ...uiInputStyle,
            borderColor: isInvalidUrl ? orbitColors.semantic.error : undefined,
          }}
        />
        {isInvalidUrl ? (
          <div style={{ ...hintStyle, color: orbitColors.semantic.error }}>
            {copy.baseUrl.invalidUrl}
          </div>
        ) : (
          <div style={hintStyle}>
            {providerId === "ollama" ? copy.baseUrl.ollamaDefaultHint : copy.baseUrl.hint}
          </div>
        )}
      </div>
    </SectionCard>
  );
};

/**
 * 6. Advanced Progressive Disclosure Section
 */
export const SettingsAdvancedSection: React.FC<{
  analyticsBaseUrl: string;
  customProtocol: "openai" | "anthropic";
  customUrl: string;
  deviceId: string;
  enableAnalytics: boolean;
  isEn: boolean;
  provider: ProviderConfig;
  providerId: ProviderId;
  route: "auto" | "text" | "vision";
  setAnalyticsBaseUrl: (value: string) => void;
  setCustomProtocol: (value: "openai" | "anthropic") => void;
  setCustomUrl: (value: string) => void;
  setEnableAnalytics: (value: boolean) => void;
  setRoute: (value: "auto" | "text" | "vision") => void;
}> = ({
  analyticsBaseUrl,
  customProtocol,
  customUrl,
  deviceId,
  enableAnalytics,
  isEn,
  provider,
  providerId,
  route,
  setAnalyticsBaseUrl,
  setCustomProtocol,
  setCustomUrl,
  setEnableAnalytics,
  setRoute,
}) => {
  const copy = getSettingsCopy(isEn ? "en" : "zh");
  const [isOpen, setIsOpen] = useState(true);

  const showBaseUrlInAdvanced =
    providerId !== "ollama" &&
    providerId !== "custom" &&
    (providerId === "openai" || providerId === "anthropic" || providerId === "minimax");

  return (
    <section className="settings-card" style={{ ...sectionSurfaceStyle, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        style={{
          width: "100%",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: orbitColors.text.primary }}>
            {copy.advanced.sectionTitle}
          </div>
          <div style={{ fontSize: 11, color: orbitColors.text.secondary, marginTop: 2 }}>
            {copy.advanced.sectionDesc}
          </div>
        </div>
        <span
          style={{
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.16s ease",
            fontSize: 10,
            color: orbitColors.text.muted,
          }}
        >
          ▶
        </span>
      </button>

      {isOpen ? (
        <div style={{ padding: "0 14px 14px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Custom Wire Protocol */}
          {providerId === "custom" ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: orbitColors.text.primary, marginBottom: 6 }}>
                {copy.advanced.customProtocolTitle}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {([
                  ["openai", copy.advanced.protocolOpenAi],
                  ["anthropic", copy.advanced.protocolClaude],
                ] as const).map(([value, label]) => (
                  <label key={value} style={radioRowStyle}>
                    <input
                      type="radio"
                      name="custom-protocol"
                      checked={customProtocol === value}
                      onChange={() => setCustomProtocol(value)}
                      style={{ accentColor: orbitColors.brand.primary }}
                    />
                    <span style={{ fontSize: 12, color: orbitColors.text.primary }}>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {/* Base URL (if applicable) */}
          {showBaseUrlInAdvanced ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: orbitColors.text.primary, marginBottom: 4 }}>
                {copy.baseUrl.title}
              </div>
              <input
                type="text"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder={provider.baseUrl}
                aria-label={copy.baseUrl.title}
                style={uiInputStyle}
              />
              <div style={hintStyle}>{copy.baseUrl.hint}</div>
            </div>
          ) : null}

          {/* Parse Route */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: orbitColors.text.primary, marginBottom: 4 }}>
              {copy.advanced.routeTitle}
            </div>
            <div style={{ fontSize: 11, color: orbitColors.text.secondary, marginBottom: 6 }}>
              {copy.advanced.routeDesc}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {([
                ["auto", copy.advanced.routeAuto],
                ["text", copy.advanced.routeText],
                ["vision", copy.advanced.routeVision],
              ] as const).map(([value, label]) => (
                <label key={value} style={radioRowStyle}>
                  <input
                    type="radio"
                    name="route"
                    checked={route === value}
                    onChange={() => setRoute(value)}
                    style={{ accentColor: orbitColors.brand.primary }}
                  />
                  <span style={{ fontSize: 12, color: orbitColors.text.primary }}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Analytics Backend */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: orbitColors.text.primary, marginBottom: 4 }}>
              {copy.advanced.analyticsBackendTitle}
            </div>
            <div style={{ fontSize: 11, color: orbitColors.text.secondary, marginBottom: 6 }}>
              {copy.advanced.analyticsBackendDesc}
            </div>
            <input
              type="text"
              value={analyticsBaseUrl}
              onChange={(e) => setAnalyticsBaseUrl(e.target.value)}
              placeholder={DEFAULT_ANALYTICS_BASE_URL}
              aria-label={copy.advanced.analyticsBackendTitle}
              style={uiInputStyle}
            />
            <div style={hintStyle}>
              {copy.advanced.deviceIdPrefix}
              {deviceId || copy.advanced.loading}
            </div>
          </div>

          {/* Usage Analytics */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: orbitColors.text.primary, marginBottom: 4 }}>
              {copy.advanced.usageTitle}
            </div>
            <div style={{ fontSize: 11, color: orbitColors.text.secondary, marginBottom: 8, lineHeight: 1.5 }}>
              {copy.advanced.usageDesc}
            </div>
            <label style={{ ...radioRowStyle, alignItems: "flex-start" }}>
              <input
                type="checkbox"
                aria-label={copy.advanced.usageCheckboxAria}
                checked={enableAnalytics}
                onChange={(e) => setEnableAnalytics(e.target.checked)}
                style={{ accentColor: orbitColors.brand.primary, marginTop: 2 }}
              />
              <span style={{ fontSize: 12, color: orbitColors.text.primary }}>
                {enableAnalytics ? copy.advanced.usageEnabled : copy.advanced.usageDisabled}
              </span>
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
};

/**
 * 7. Language Switcher Card
 */
export const SettingsGeneralSection: React.FC<{
  lang: UILang;
  onLanguageChange: (lang: UILang) => void;
  isEn: boolean;
}> = ({ lang, onLanguageChange, isEn }) => {
  const copy = getSettingsCopy(isEn ? "en" : "zh");

  return (
    <SectionCard title={copy.language.title} description={copy.language.description}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {(["zh", "en"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onLanguageChange(item)}
            style={{
              ...providerButtonStyle,
              padding: "8px 12px",
              textAlign: "center",
              borderColor: lang === item ? orbitColors.brand.primary : orbitColors.border.subtle,
              background: lang === item ? "rgba(37, 99, 235, 0.14)" : orbitColors.bg.surfaceSubtle,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: lang === item ? 650 : 400,
                color: lang === item ? orbitColors.text.primary : orbitColors.text.secondary,
              }}
            >
              {item === "zh" ? copy.language.zh : copy.language.en}
            </span>
          </button>
        ))}
      </div>
    </SectionCard>
  );
};

/**
 * 8. Account / Session Section (Preserved Authority Contract)
 */
export const SettingsAccountSection: React.FC<{
  auth: SettingsAuthController;
  authText: AuthText;
  isEn: boolean;
  rejectedSessionHint?: boolean;
}> = ({ auth, authText, isEn, rejectedSessionHint = false }) => (
  <SectionCard
    title={isEn ? "Plugin Access Account" : "插件访问账号"}
    description={
      isEn
        ? "Registration and login now live on separate pages. Registration requires a real email verification code."
        : "注册页和登录页已经拆开，注册需要真实邮箱验证码。"
    }
  >
    {auth.isAuthenticated ? (
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
    ) : auth.isSessionPending ? (
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ ...hintStyle, color: "#a5b4fc" }}>{authText.validatingSession}</div>
      </div>
    ) : auth.isServerUnavailable ? (
      <div
        style={{
          display: "grid",
          gap: 10,
          padding: 12,
          borderRadius: 14,
          border: "1px solid rgba(245, 158, 11, 0.25)",
          background: "linear-gradient(180deg, rgba(66, 50, 24, 0.7), rgba(45, 35, 18, 0.65))",
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24" }}>{authText.sessionUnavailable}</div>
          <div style={hintStyle}>{authText.sessionUnavailableHint}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <UiButton primary onClick={() => void auth.retryValidation()}>
            {authText.retrySession}
          </UiButton>
          <UiButton danger onClick={() => void auth.handleLogout()} disabled={auth.authBusy === "logout"}>
            {auth.authBusy === "logout" ? authText.loggingOut : authText.logout}
          </UiButton>
        </div>
        {auth.feedback ? <div style={hintStyle}>{auth.feedback}</div> : null}
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
                <AuthVerificationCodeInput
                  value={auth.verificationCode}
                  onChange={auth.setVerificationCode}
                  ariaLabel={authText.verificationCodePlaceholder}
                  lang={isEn ? "en" : "zh"}
                />
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

        {auth.feedback || auth.sessionRejected || rejectedSessionHint ? (
          <div
            style={{
              ...hintStyle,
              color: /success|succeeded|logged out|sent|成功|已退出/.test(auth.feedback) ? "#9ffff6" : "#ff9fda",
            }}
          >
            {auth.feedback || authText.sessionExpired}
          </div>
        ) : null}
      </div>
    )}
  </SectionCard>
);

/**
 * 9. Actions Section (Save & Test Configuration)
 */
export const SettingsActionsSection: React.FC<{
  isDirty?: boolean;
  isEn: boolean;
  onSave: () => void;
  onTest: () => void;
  saved: boolean;
  testResult: UserFeedback | null;
  testing: boolean;
}> = ({ isDirty = false, isEn, onSave, onTest, saved, testResult, testing }) => {
  const copy = getSettingsCopy(isEn ? "en" : "zh");

  const toneStyles: Record<string, { border: string; background: string; color: string }> = {
    success: {
      border: orbitColors.semantic.successBorder,
      background: `linear-gradient(180deg, ${orbitColors.semantic.successSurface}, rgba(28, 47, 36, 0.8))`,
      color: "#cffff0",
    },
    info: {
      border: orbitColors.semantic.infoBorder,
      background: `linear-gradient(180deg, ${orbitColors.semantic.infoSurface}, rgba(20, 25, 44, 0.8))`,
      color: "#c7d2fe",
    },
    warning: {
      border: orbitColors.semantic.warningBorder,
      background: `linear-gradient(180deg, ${orbitColors.semantic.warningSurface}, rgba(45, 25, 10, 0.8))`,
      color: "#fde68a",
    },
    error: {
      border: orbitColors.semantic.errorBorder,
      background: `linear-gradient(180deg, ${orbitColors.semantic.errorSurface}, rgba(55, 33, 37, 0.8))`,
      color: "#ffb4c0",
    },
  };

  const tone = toneStyles[testResult?.tone ?? "info"] ?? toneStyles.info;

  return (
    <>
      <div
        className="settings-card settings-action"
        style={{
          ...sectionSurfaceStyle,
          padding: 12,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <UiButton primary={isDirty || !saved} onClick={onSave}>
          {saved ? (isEn ? "Saved" : "已保存") : isEn ? "Save Settings" : "保存设置"}
        </UiButton>

        <UiButton
          onClick={onTest}
          disabled={testing}
          aria-label={
            testing
              ? isEn
                ? "Testing..."
                : "测试中..."
              : isEn
                ? "Connection Test / Test configuration"
                : "测试配置（连接测试）"
          }
        >
          {testing ? (isEn ? "Testing..." : "测试中...") : isEn ? "Connection Test" : "连接测试"}
        </UiButton>

        {isDirty ? (
          <span style={{ fontSize: 11, color: orbitColors.semantic.warning, fontWeight: 500 }}>
            ● {copy.actions.unsavedChanges}
          </span>
        ) : null}
      </div>

      {testResult?.message ? (
        <div
          className="settings-card settings-action"
          data-test-tone={testResult.tone}
          style={{
            ...sectionSurfaceStyle,
            padding: "11px 14px",
            borderColor: tone.border,
            background: tone.background,
            color: tone.color,
            fontSize: 12,
            lineHeight: 1.6,
            wordBreak: "break-word",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {testResult.message}
        </div>
      ) : null}
    </>
  );
};

/**
 * Preserved Config Sections Wrapper (combines Picker, Credentials, Model, Base URL, Advanced, Language)
 */
export const SettingsConfigSections: React.FC<{
  analyticsBaseUrl: string;
  apiKey: string;
  hasCredential?: boolean;
  onClearCredential?: () => void;
  customProtocol: "openai" | "anthropic";
  customUrl: string;
  deviceId: string;
  enableAnalytics: boolean;
  handleProviderChange: (id: ProviderId) => void;
  isEn: boolean;
  lang: UILang;
  model: string;
  provider: ProviderConfig;
  providerId: ProviderId;
  route: "auto" | "text" | "vision";
  setAnalyticsBaseUrl: (value: string) => void;
  setEnableAnalytics: (value: boolean) => void;
  setApiKey: (value: string) => void;
  setCustomProtocol: (value: "openai" | "anthropic") => void;
  setCustomUrl: (value: string) => void;
  setLang: (value: UILang) => void;
  setModel: (value: string) => void;
  setRoute: (value: "auto" | "text" | "vision") => void;
}> = ({
  analyticsBaseUrl,
  apiKey,
  hasCredential = false,
  onClearCredential,
  customProtocol,
  customUrl,
  deviceId,
  enableAnalytics,
  handleProviderChange,
  isEn,
  lang,
  model,
  provider,
  providerId,
  route,
  setAnalyticsBaseUrl,
  setEnableAnalytics,
  setApiKey,
  setCustomProtocol,
  setCustomUrl,
  setLang,
  setModel,
  setRoute,
}) => {
  const showBaseUrlDirectly = providerId === "ollama" || providerId === "custom";

  return (
    <>
      <SettingsProviderPicker
        isEn={isEn}
        providerId={providerId}
        onProviderChange={handleProviderChange}
      />

      <SettingsCredentialsSection
        apiKey={apiKey}
        hasCredential={hasCredential}
        onApiKeyChange={setApiKey}
        onClearCredential={onClearCredential}
        provider={provider}
        providerId={providerId}
        isEn={isEn}
      />

      <SettingsModelSection
        isEn={isEn}
        model={model}
        onModelChange={setModel}
        provider={provider}
        providerId={providerId}
      />

      {showBaseUrlDirectly ? (
        <SettingsBaseUrlCard
          customUrl={customUrl}
          isEn={isEn}
          onCustomUrlChange={setCustomUrl}
          provider={provider}
          providerId={providerId}
        />
      ) : null}

      <SettingsAdvancedSection
        analyticsBaseUrl={analyticsBaseUrl}
        customProtocol={customProtocol}
        customUrl={customUrl}
        deviceId={deviceId}
        enableAnalytics={enableAnalytics}
        isEn={isEn}
        provider={provider}
        providerId={providerId}
        route={route}
        setAnalyticsBaseUrl={setAnalyticsBaseUrl}
        setCustomProtocol={setCustomProtocol}
        setCustomUrl={setCustomUrl}
        setEnableAnalytics={setEnableAnalytics}
        setRoute={setRoute}
      />

      <SettingsGeneralSection
        isEn={isEn}
        lang={lang}
        onLanguageChange={setLang}
      />
    </>
  );
};
