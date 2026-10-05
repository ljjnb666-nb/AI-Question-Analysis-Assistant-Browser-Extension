import React, { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { QuestionBlock } from "@/shared/types";
import { DEFAULT_ANALYTICS_BASE_URL } from "@/shared/constants/analytics";
import { loadSettings, saveSettings } from "@/shared/utils/storage";
import { getAIConnectionReadiness } from "@/shared/utils/aiSolvePreferences";
import { getAIConnectionEditorView, updateActiveAIConnection } from "@/shared/utils/aiConnectionClient";
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
  SettingsConfigSections,
  SettingsHomeSummaryCard,
  SettingsSetupStatusCard,
} from "./settingsSections";
import {
  computeValidationFingerprint,
  deriveSetupStatus,
  type SetupStatus,
} from "./settingsTypes";

gsap.registerPlugin(useGSAP);

export const SettingsTab: React.FC<{
  lang: UILang;
  onLanguageChange: (lang: UILang) => void;
  authOnly?: boolean;
  /** A sibling coordinator already got this session rejected (401); the auth
   * form must surface the generic sign-in-again hint even though the local
   * credentials were cleared before this tab's own validation ran. */
  sessionRejectedHint?: boolean;
}> = ({ lang: initialLang, onLanguageChange, authOnly = false, sessionRejectedHint = false }) => {
  const scopeRef = useRef<HTMLDivElement | null>(null);
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
  const [validatedFingerprint, setValidatedFingerprint] = useState<string | null>(null);
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
    return () => {
      disposed = true;
    };
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

  const currentFingerprint = useMemo(
    () =>
      computeValidationFingerprint({
        providerId,
        apiKey,
        apiModel: model || provider.defaultModel,
        customBaseUrl: customUrl,
        customProviderProtocol: customProtocol,
      }),
    [providerId, apiKey, model, provider.defaultModel, customUrl, customProtocol],
  );

  const isValidated = useMemo(() => {
    if (!validatedFingerprint) return false;
    return Boolean(testResult?.tone === "success" && validatedFingerprint === currentFingerprint && !isDirty);
  }, [testResult, validatedFingerprint, currentFingerprint, isDirty]);

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

  useGSAP(
    () => {
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
    { scope: scopeRef, dependencies: [providerId, lang, testResult], revertOnUpdate: true },
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
    setValidatedFingerprint(null);
  };

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    setTestResult(null);
    setValidatedFingerprint(null);
  };

  const handleClearCredential = () => {
    setApiKey("");
    setHasCredential(false);
    setIsCredentialCleared(true);
    setTestResult(null);
    setValidatedFingerprint(null);
  };

  const handleModelChange = (val: string) => {
    setModel(val);
    setTestResult(null);
    setValidatedFingerprint(null);
  };

  const handleCustomUrlChange = (val: string) => {
    setCustomUrl(val);
    setTestResult(null);
    setValidatedFingerprint(null);
  };

  const handleCustomProtocolChange = (val: "openai" | "anthropic") => {
    setCustomProtocol(val);
    setTestResult(null);
    setValidatedFingerprint(null);
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
      const committedFingerprint = computeValidationFingerprint({
        providerId,
        apiKey: "",
        apiModel: model || provider.defaultModel,
        customBaseUrl: customUrl,
        customProviderProtocol: customProtocol,
      });
      setValidatedFingerprint(committedFingerprint);
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
      {/* 1. Setup Status & 4-Step Onboarding Stepper Header */}
      <SettingsSetupStatusCard
        status={setupStatus}
        isEn={isEn}
        activeStep={activeStep}
        onRetest={() => void handleTest()}
      />

      {/* 2. Active AI Connection Summary Card */}
      <SettingsHomeSummaryCard
        providerName={provider.name}
        modelName={model || provider.defaultModel}
        connectionStatus={setupStatus}
        hasCredential={hasCredential}
        keyOptional={provider.keyOptional}
        isEn={isEn}
        onChangeService={() => {
          const el = document.getElementById(`provider-card-${providerId}`) || document.getElementById("provider-search-input");
          el?.focus();
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        onEditConnection={() => {
          const el = document.getElementById("settings-api-key-input") || document.getElementById("settings-model-select");
          el?.focus();
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        onTestConnection={() => void handleTest()}
        testing={testing}
      />

      {/* 3. Provider Catalog, Credentials, Model, Base URL, Advanced, Language */}
      <SettingsConfigSections
        analyticsBaseUrl={analyticsBaseUrl}
        apiKey={apiKey}
        hasCredential={hasCredential}
        onClearCredential={handleClearCredential}
        customProtocol={customProtocol}
        customUrl={customUrl}
        deviceId={deviceId}
        enableAnalytics={enableAnalytics}
        handleProviderChange={handleProviderChange}
        isEn={isEn}
        lang={lang}
        model={model}
        provider={provider}
        providerId={providerId}
        route={route}
        setAnalyticsBaseUrl={setAnalyticsBaseUrl}
        setEnableAnalytics={setEnableAnalytics}
        setApiKey={handleApiKeyChange}
        setCustomProtocol={handleCustomProtocolChange}
        setCustomUrl={handleCustomUrlChange}
        setLang={(nextLang) => {
          setLang(nextLang);
          onLanguageChange(nextLang);
        }}
        setModel={handleModelChange}
        setRoute={setRoute}
      />

      {/* 4. Actions: Save Settings & Test Configuration */}
      <SettingsActionsSection
        isDirty={isDirty}
        isEn={isEn}
        onSave={() => void handleSave()}
        onTest={() => void handleTest()}
        saved={saved}
        testResult={testResult}
        testing={testing}
      />

      {/* 5. Account / Session Section */}
      <SettingsAccountSection auth={auth} authText={authText} isEn={isEn} rejectedSessionHint={sessionRejectedHint} />
    </div>
  );
};
