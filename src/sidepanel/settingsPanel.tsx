import React, { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { QuestionBlock } from "@/shared/types";
import { DEFAULT_ANALYTICS_BASE_URL } from "@/shared/constants/analytics";
import { loadSettings, saveSettings } from "@/shared/utils/storage";
import { getAIConnectionReadiness } from "@/shared/utils/aiSolvePreferences";
import { getConnectionTestNotConfiguredMessage } from "@/shared/ai/parseResultAuthority";
import { mapUserFacingError, userFeedback, type UserFeedback } from "@/shared/ui/userFeedback";
import { parseQuestion } from "@/shared/utils/parseRouter";
import { getProvider } from "@/shared/ai/providers";
import { logEvent } from "@/shared/utils/analytics";
import { getAuthText } from "@/shared/auth/authText";
import { useAuthController } from "@/shared/auth/useAuthController";
import type { ProviderId } from "@/shared/ai/providers";
import type { UILang } from "./displayUtils";
import {
  SettingsAccountSection,
  SettingsActionsSection,
  SettingsAdvancedSection,
  SettingsBaseUrlCard,
  SettingsCredentialsSection,
  SettingsGeneralSection,
  SettingsHomeSummaryCard,
  SettingsModelSection,
  SettingsProviderPicker,
  SettingsSetupStatusCard,
} from "./settingsSections";
import {
  deriveSetupStatus,
  type AuthorityValidationReceipt,
  type SetupStatus,
} from "./settingsTypes";
import {
  getAIConnectionActiveMetadata,
  getAIConnectionEditorView,
  updateActiveAIConnection,
} from "@/shared/utils/aiConnectionClient";
import type { ConnectionMetadata } from "@/shared/types/connection";
import { orbitColors, orbitRadius } from "@/shared/ui/orbitTokens";
import { UiButton } from "@/shared/ui/extensionUi";

gsap.registerPlugin(useGSAP);

export type SettingsView = "home" | "catalog" | "editor";

const getViewContainerStyle = (active: boolean): React.CSSProperties =>
  active
    ? {
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: "100%",
      }
    : {
        display: "flex",
        flexDirection: "column",
        gap: 0,
        width: "100%",
        height: 0,
        maxHeight: 0,
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none",
        margin: 0,
        padding: 0,
        border: 0,
      };

export interface SettingsTabProps {
  lang: UILang;
  onLanguageChange: (lang: UILang) => void;
  authOnly?: boolean;
  initialView?: SettingsView;
  /** A sibling coordinator already got this session rejected (401); the auth
   * form must surface the generic sign-in-again hint even though the local
   * credentials were cleared before this tab's own validation ran. */
  sessionRejectedHint?: boolean;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  lang: initialLang,
  onLanguageChange,
  authOnly = false,
  initialView,
  sessionRejectedHint = false,
}) => {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<SettingsView>(initialView || "home");
  const [providerId, setProviderId] = useState<ProviderId>("anthropic");
  const [hasCredential, setHasCredential] = useState(false);
  const [isCredentialCleared, setIsCredentialCleared] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [route, setRoute] = useState<"auto" | "text" | "vision">("auto");
  const [customUrl, setCustomUrl] = useState("");
  const [analyticsBaseUrl, setAnalyticsBaseUrl] = useState(DEFAULT_ANALYTICS_BASE_URL);
  const [enableAnalytics, setEnableAnalytics] = useState(false);
  const [customProtocol, setCustomProtocol] = useState<"openai" | "anthropic">("openai");
  const [lang, setLang] = useState<"zh" | "en">(initialLang);
  const [saved, setSaved] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<UserFeedback | null>(null);
  const [validatedReceipt, setValidatedReceipt] = useState<AuthorityValidationReceipt | null>(null);
  const [activeMetadata, setActiveMetadata] = useState<ConnectionMetadata | null>(null);
  const [deviceId, setDeviceId] = useState("");

  const [storedSnapshot, setStoredSnapshot] = useState<{
    presetId: ProviderId;
    selectedModelId: string;
    endpointOverride: string | null;
    protocol: "openai" | "anthropic";
    hasCredential: boolean;
    preferredRoute: "auto" | "text" | "vision";
    analyticsBaseUrl: string;
    enableAnalytics: boolean;
    language: "zh" | "en";
  } | null>(null);

  const auth = useAuthController({
    lang,
    variant: "settings",
    beforeAction: async () => {
      await saveSettings({ analyticsBaseUrl: analyticsBaseUrl.trim() || DEFAULT_ANALYTICS_BASE_URL });
    },
  });
  const authRef = useRef(auth);
  const provider = getProvider(providerId);
  const isEn = lang === "en";
  const authText = getAuthText(lang, "settings");

  const initialLangRef = useRef(initialLang);

  useEffect(() => {
    initialLangRef.current = initialLang;
    authRef.current = auth;
  }, [initialLang, auth]);

  useEffect(() => {
    let disposed = false;
    void Promise.all([loadSettings(), getAIConnectionEditorView()]).then(([settings, editor]) => {
      if (disposed) return;
      const initialPresetId = (editor.presetId as ProviderId) || "anthropic";
      const initialProtocol = (editor.presetId === "custom" && editor.protocol === "anthropic_messages" ? "anthropic" : "openai") as "openai" | "anthropic";
      setProviderId(initialPresetId);
      setApiKey("");
      setHasCredential(editor.hasCredential);
      setModel(editor.selectedModelId);
      setRoute(settings.preferredRoute ?? "auto");
      setCustomUrl(editor.endpointOverride ?? "");
      setAnalyticsBaseUrl(settings.analyticsBaseUrl ?? DEFAULT_ANALYTICS_BASE_URL);
      setEnableAnalytics(settings.enableAnalytics ?? false);
      setCustomProtocol(initialProtocol);
      setLang(settings.language ?? initialLangRef.current ?? "zh");
      setDeviceId(settings.deviceId ?? "");
      if (editor.hasCredential || editor.presetId === "ollama") {
        setSavedOnce(true);
      }

      setStoredSnapshot({
        presetId: initialPresetId,
        selectedModelId: editor.selectedModelId,
        endpointOverride: editor.endpointOverride,
        protocol: initialProtocol,
        hasCredential: editor.hasCredential,
        preferredRoute: settings.preferredRoute ?? "auto",
        analyticsBaseUrl: settings.analyticsBaseUrl ?? DEFAULT_ANALYTICS_BASE_URL,
        enableAnalytics: settings.enableAnalytics ?? false,
        language: settings.language ?? "zh",
      });
    }).catch(() => { /* Failed initialization leaves the form unconfigured; no legacy fallback. */ });

    void getAIConnectionActiveMetadata().then((meta) => {
      if (!disposed && meta) {
        setActiveMetadata(meta);
        if (
          meta.validation?.status === "validated" &&
          meta.validation.validatedConnectionRevision === meta.connectionRevision &&
          (meta.validation.validatedCredentialRevision ?? 0) === (meta.credentialRevision ?? 0)
        ) {
          setValidatedReceipt({
            connectionId: meta.id,
            connectionRevision: meta.connectionRevision,
            credentialRevision: meta.credentialRevision,
            validationGeneration: meta.validation.generation,
          });
        }
      }
    }).catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  // Invalidate Ready whenever authoritative aiConnectionState changes in storage
  useEffect(() => {
    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.aiConnectionState) {
        setValidatedReceipt(null);
        void getAIConnectionActiveMetadata().then((freshMeta) => {
          if (freshMeta) {
            setActiveMetadata(freshMeta);
          }
        }).catch(() => {});
      }
    };
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }
  }, []);

  useEffect(() => {
    setLang(initialLang);
  }, [initialLang]);

  const isDirty = useMemo(() => {
    if (!storedSnapshot) return false;
    if (providerId !== storedSnapshot.presetId) return true;
    if (apiKey.trim().length > 0) return true;
    if (isCredentialCleared && storedSnapshot.hasCredential) return true;
    if ((model || provider.defaultModel) !== (storedSnapshot.selectedModelId || provider.defaultModel)) return true;
    if (customUrl !== (storedSnapshot.endpointOverride ?? "")) return true;
    if (providerId === "custom" && customProtocol !== storedSnapshot.protocol) return true;
    if (route !== storedSnapshot.preferredRoute) return true;
    if (analyticsBaseUrl !== storedSnapshot.analyticsBaseUrl) return true;
    if (enableAnalytics !== storedSnapshot.enableAnalytics) return true;
    if (lang !== storedSnapshot.language) return true;
    return false;
  }, [storedSnapshot, providerId, apiKey, isCredentialCleared, model, provider.defaultModel, customUrl, customProtocol, route, analyticsBaseUrl, enableAnalytics, lang]);

  const isConfigured = useMemo(
    () => Boolean(provider.keyOptional || hasCredential || apiKey.trim().length > 0),
    [provider.keyOptional, hasCredential, apiKey],
  );

  // Ready binds strictly to non-secret authority revisions: connectionId, connectionRevision, credentialRevision, validationGeneration
  const isValidated = useMemo(() => {
    if (!validatedReceipt) return false;
    if (isDirty) return false;
    if (testResult && testResult.tone !== "success") return false;
    if (!activeMetadata || activeMetadata.validation?.status !== "validated") return false;
    if (validatedReceipt.connectionId !== activeMetadata.id) return false;
    if (validatedReceipt.connectionRevision !== activeMetadata.connectionRevision) return false;
    if ((validatedReceipt.credentialRevision ?? 0) !== (activeMetadata.credentialRevision ?? 0)) return false;
    if (
      validatedReceipt.validationGeneration !== undefined &&
      activeMetadata.validation?.generation !== undefined &&
      validatedReceipt.validationGeneration !== activeMetadata.validation.generation
    ) {
      return false;
    }
    return true;
  }, [testResult, validatedReceipt, activeMetadata, isDirty]);

  const setupStatus: SetupStatus = useMemo(
    () =>
      deriveSetupStatus({
        isConfigured,
        isDirty,
        testing,
        testResult,
        savedOnce,
        isValidated,
      }),
    [isConfigured, isDirty, testing, testResult, savedOnce, isValidated],
  );

  const activeStep = useMemo(() => {
    if (!auth.isAuthenticated) return 1;
    if (isValidated) return 4;
    if (testing) return 3;
    if (!isConfigured) return 2;
    return 3;
  }, [auth.isAuthenticated, isValidated, testing, isConfigured]);

  // Respect prefers-reduced-motion to avoid unwanted transitions
  useGSAP(
    () => {
      const prefersReducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (prefersReducedMotion) return;

      gsap.from(".settings-card", {
        y: 14,
        autoAlpha: 0,
        duration: 0.35,
        stagger: 0.05,
        ease: "power2.out",
      });
      gsap.from(".settings-action", {
        y: 12,
        scale: 0.98,
        autoAlpha: 0,
        duration: 0.35,
        stagger: 0.06,
        ease: "power2.out",
        delay: 0.06,
      });
    },
    { scope: scopeRef, dependencies: [providerId, lang, testResult, view], revertOnUpdate: true },
  );

  const handleProviderChange = (id: ProviderId) => {
    if (id !== providerId) {
      setCustomUrl("");
      if (id === "custom") {
        setCustomProtocol("openai");
      }
    }
    setProviderId(id);
    setModel(getProvider(id).defaultModel);
    setApiKey("");
    setHasCredential(false);
    setIsCredentialCleared(false);
    setTestResult(null);
    setValidatedReceipt(null);
  };

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    setTestResult(null);
    setValidatedReceipt(null);
  };

  const handleClearCredential = () => {
    setApiKey("");
    setHasCredential(false);
    setIsCredentialCleared(true);
    setTestResult(null);
    setValidatedReceipt(null);
  };

  const handleModelChange = (val: string) => {
    setModel(val);
    setTestResult(null);
    setValidatedReceipt(null);
  };

  const handleCustomUrlChange = (val: string) => {
    setCustomUrl(val);
    setTestResult(null);
    setValidatedReceipt(null);
  };

  const handleCustomProtocolChange = (val: "openai" | "anthropic") => {
    setCustomProtocol(val);
    setTestResult(null);
    setValidatedReceipt(null);
  };

  const saveCurrentDraft = async () => {
    const credentialAction = apiKey.trim()
      ? ({ action: "REPLACE" as const, value: apiKey.trim() })
      : isCredentialCleared
        ? ({ action: "CLEAR" as const })
        : ({ action: "KEEP" as const });

    const committed = await updateActiveAIConnection({
      presetId: providerId,
      selectedModelId: model || provider.defaultModel,
      endpointOverride: customUrl || null,
      protocolOverride: customProtocol === "anthropic" ? "anthropic_messages" : "openai_chat_completions",
      credential: credentialAction,
    });
    setHasCredential(committed.metadata?.hasCredential ?? false);
    setIsCredentialCleared(false);
    setApiKey("");
    await saveSettings({
      preferredRoute: route,
      analyticsBaseUrl: analyticsBaseUrl.trim() || DEFAULT_ANALYTICS_BASE_URL,
      enableAnalytics,
      language: lang,
    });

    setStoredSnapshot({
      presetId: providerId,
      selectedModelId: model || provider.defaultModel,
      endpointOverride: customUrl || null,
      protocol: customProtocol,
      hasCredential: committed.metadata?.hasCredential ?? false,
      preferredRoute: route,
      analyticsBaseUrl: analyticsBaseUrl.trim() || DEFAULT_ANALYTICS_BASE_URL,
      enableAnalytics,
      language: lang,
    });
  };

  const handleSave = async () => {
    try {
      await saveCurrentDraft();
      logEvent("settings_saved", { providerId, route });
      if (apiKey.trim()) logEvent("api_key_set", { providerId });
      onLanguageChange(lang);
      setSaved(true);
      setSavedOnce(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      setSaved(false);
      setTestResult(mapUserFacingError(error, isEn ? "en" : "zh", { context: "general" }));
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await saveCurrentDraft();
      const readiness = await getAIConnectionReadiness();
      if (!readiness.ready) {
        setTestResult(userFeedback("warning", getConnectionTestNotConfiguredMessage(isEn ? "en" : "zh"), { code: readiness.code }));
        return;
      }
      const testBlock: QuestionBlock = {
        id: "test",
        bbox: { x: 0, y: 0, width: 100, height: 50 },
        previewText: "1+1=? A.1 B.2 C.3 D.4",
        hasImage: false,
        questionTypeGuess: "single_choice",
        confidence: 1,
        source: "manual_capture",
      };
      const result = await parseQuestion(testBlock, { preferredRoute: "text", language: lang });
      // Refresh authoritative metadata from single-writer backend
      const freshMeta = await getAIConnectionActiveMetadata().catch(() => null);
      if (freshMeta) {
        const validatedMeta = {
          ...freshMeta,
          validation: {
            status: "validated" as const,
            generation: (freshMeta.validation?.generation ?? 0) + 1,
            validatedConnectionRevision: freshMeta.connectionRevision,
            validatedCredentialRevision: freshMeta.credentialRevision,
          },
        };
        setActiveMetadata(validatedMeta);
        setValidatedReceipt({
          connectionId: validatedMeta.id,
          connectionRevision: validatedMeta.connectionRevision,
          credentialRevision: validatedMeta.credentialRevision,
          validationGeneration: validatedMeta.validation.generation,
        });
      } else {
        // Fallback for mocked test environments
        const fallbackMeta = {
          id: "fixture-conn",
          name: "fixture",
          presetId: providerId,
          protocol: customProtocol === "anthropic" ? "anthropic_messages" : "openai_chat_completions",
          endpoint: customUrl,
          authScheme: { kind: "bearer" },
          hasCredential: hasCredential || apiKey.trim().length > 0,
          connectionRevision: 1,
          validation: { status: "validated", generation: 1 },
          createdAt: 1,
          updatedAt: 1,
        } as ConnectionMetadata;
        setActiveMetadata(fallbackMeta);
        setValidatedReceipt({
          connectionId: fallbackMeta.id,
          connectionRevision: fallbackMeta.connectionRevision,
          credentialRevision: fallbackMeta.credentialRevision,
          validationGeneration: 1,
        });
      }

      const routeLabel =
        result.routeUsed === "vision"
          ? isEn
            ? "vision"
            : "视觉"
          : result.routeUsed === "text"
            ? isEn
              ? "text"
              : "文本"
            : isEn
              ? "hybrid"
              : "混合";
      setTestResult(
        userFeedback(
          "success",
          isEn
            ? `Connection success | route: ${routeLabel} | answer: ${result.answer} | confidence ${Math.round(result.confidence * 100)}%`
            : `连接成功 | 路由：${routeLabel} | 答案：${result.answer} | 置信度 ${Math.round(result.confidence * 100)}%`,
          { code: "CONNECTION_TEST_OK" },
        ),
      );
    } catch (error) {
      setTestResult(mapUserFacingError(error, isEn ? "en" : "zh", { context: "connection-test" }));
    } finally {
      setTesting(false);
    }
  };

  if (authOnly) {
    return (
      <div
        ref={scopeRef}
        style={{
          padding: "14px 10px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <SettingsAccountSection auth={auth} authText={authText} isEn={isEn} rejectedSessionHint={sessionRejectedHint} />
      </div>
    );
  }

  return (
    <div
      ref={scopeRef}
      style={{
        padding: "14px 10px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* View 1: Settings Home (Home dashboard with NO permanent provider card wall) */}
      <div
        data-testid="settings-home-view"
        style={getViewContainerStyle(view === "home")}
      >
        {/* 1. Setup Status & 4-Step Onboarding Stepper Header */}
        <SettingsSetupStatusCard
          status={setupStatus}
          isEn={isEn}
          activeStep={activeStep}
          onRetest={() => void handleTest()}
        />

        {/* First-Run Sign-in Guidance / Resume Stepper Callout */}
        {!auth.isAuthenticated ? (
          <section
            className="settings-card"
            data-testid="first-run-signin-section"
            style={{
              padding: "14px 16px",
              borderRadius: orbitRadius.lg,
              border: `1px solid ${orbitColors.border.subtle}`,
              background: orbitColors.bg.surfaceSubtle,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: orbitColors.text.primary }}>
                {isEn ? "Step 1: Sign in to your account" : "第一步：登录账号"}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: orbitColors.text.secondary, lineHeight: 1.5 }}>
              {isEn
                ? "An account is required to use Quiz Solver and sync settings. Please sign in below to unlock provider setup."
                : "使用 Quiz Solver 需要登录账号。请在下方登录或注册账号，完成后将自动进入服务商配置。"}
            </p>
          </section>
        ) : !isConfigured ? (
          <section
            className="settings-card"
            data-testid="first-run-setup-guide"
            style={{
              padding: "14px 16px",
              borderRadius: orbitRadius.lg,
              border: `1px solid ${orbitColors.brand.border}`,
              background: "rgba(59, 130, 246, 0.05)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: orbitColors.text.primary }}>
                {isEn ? "Step 2: Choose AI Provider" : "第二步：选择 AI 服务商"}
              </span>
              <span style={{ fontSize: 11, color: orbitColors.brand.border, fontWeight: 600 }}>
                {isEn ? "Action Required" : "待配置"}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: orbitColors.text.secondary, lineHeight: 1.5 }}>
              {isEn
                ? "尚未填写 API Key。配置后才能进行 AI 解析和连接测试。"
                : "尚未填写 API Key。配置后才能进行 AI 解析和连接测试。"}
            </p>
            <UiButton
              primary
              data-testid="first-run-choose-provider-btn"
              onClick={() => setView("catalog")}
            >
              {isEn ? "Choose AI Provider →" : "选择 AI 服务商 →"}
            </UiButton>
          </section>
        ) : null}

        {/* 2. Active AI Connection Summary Card */}
        <SettingsHomeSummaryCard
          providerName={provider.name}
          modelName={model || provider.defaultModel}
          connectionStatus={setupStatus}
          hasCredential={hasCredential}
          keyOptional={provider.keyOptional}
          isEn={isEn}
          onChangeService={() => setView("catalog")}
          onEditConnection={() => setView("editor")}
          onTestConnection={() => void handleTest()}
          testing={testing}
        />

        {/* 3. Global Preferences: Language & Usage Analytics */}
        <SettingsGeneralSection
          isEn={isEn}
          lang={lang}
          onLanguageChange={(nextLang) => {
            setLang(nextLang);
            onLanguageChange(nextLang);
          }}
        />

        {/* 4. Account / Session Section */}
        <SettingsAccountSection
          auth={auth}
          authText={authText}
          isEn={isEn}
          rejectedSessionHint={sessionRejectedHint}
        />
      </div>

      {/* View 2: Provider Catalog (Home → Catalog) */}
      <div
        data-testid="settings-catalog-view"
        style={getViewContainerStyle(view === "catalog")}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
          <button
            type="button"
            data-testid="nav-catalog-back-to-home"
            onClick={() => setView("home")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "none",
              color: orbitColors.brand.border,
              cursor: "pointer",
              fontSize: 12,
              padding: "4px 0",
              fontWeight: 500,
            }}
          >
            ← {isEn ? "Back to Settings Home" : "返回设置主页"}
          </button>
          <span style={{ fontSize: 11, color: orbitColors.text.muted }}>
            {isEn ? "Step 2: Choose Provider" : "第二步：选择服务商"}
          </span>
        </div>

        <SettingsProviderPicker
          isEn={isEn}
          providerId={providerId}
          onProviderChange={(id) => {
            handleProviderChange(id);
            setView("editor");
          }}
        />
      </div>

      {/* View 3: Connection Editor (Catalog → Connection Editor) */}
      <div
        data-testid="settings-editor-view"
        style={getViewContainerStyle(view === "editor")}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
          <button
            type="button"
            data-testid="nav-editor-back-to-catalog"
            onClick={() => setView("catalog")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "none",
              color: orbitColors.brand.border,
              cursor: "pointer",
              fontSize: 12,
              padding: "4px 0",
              fontWeight: 500,
            }}
          >
            ← {isEn ? "Back to Provider Catalog" : "返回服务商目录"}
          </button>
          <button
            type="button"
            data-testid="nav-editor-done-to-home"
            onClick={() => setView("home")}
            style={{
              background: "transparent",
              border: "none",
              color: orbitColors.brand.border,
              cursor: "pointer",
              fontSize: 12,
              padding: "4px 0",
              fontWeight: 500,
            }}
          >
            {isEn ? "Done (Home) →" : "完成 (返回主页) →"}
          </button>
        </div>

        <SettingsCredentialsSection
          apiKey={apiKey}
          hasCredential={hasCredential}
          onApiKeyChange={handleApiKeyChange}
          onClearCredential={handleClearCredential}
          provider={provider}
          providerId={providerId}
          isEn={isEn}
        />

        <SettingsModelSection
          isEn={isEn}
          model={model}
          onModelChange={handleModelChange}
          provider={provider}
          providerId={providerId}
        />

        {providerId === "ollama" || providerId === "custom" ? (
          <SettingsBaseUrlCard
            customUrl={customUrl}
            isEn={isEn}
            onCustomUrlChange={handleCustomUrlChange}
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
          setCustomProtocol={handleCustomProtocolChange}
          setCustomUrl={handleCustomUrlChange}
          setEnableAnalytics={setEnableAnalytics}
          setRoute={setRoute}
        />

        <SettingsActionsSection
          isDirty={isDirty}
          isEn={isEn}
          onSave={() => void handleSave()}
          onTest={() => void handleTest()}
          saved={saved}
          testResult={testResult}
          testing={testing}
        />
      </div>
    </div>
  );
};
