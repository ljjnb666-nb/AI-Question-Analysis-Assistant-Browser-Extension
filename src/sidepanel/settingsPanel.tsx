import React, { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { AppSettings, QuestionBlock } from "@/shared/types";
import { DEFAULT_ANALYTICS_BASE_URL } from "@/shared/constants/analytics";
import { loadSettings, saveSettings } from "@/shared/utils/storage";
import { getConnectionTestNotConfiguredMessage, isProviderRuntimeConfigured } from "@/shared/ai/parseResultAuthority";
import { mapUserFacingError, userFeedback, type UserFeedback } from "@/shared/ui/userFeedback";
import { getProvider, parseQuestion } from "@/shared/utils/parseRouter";
import { logEvent } from "@/shared/utils/analytics";
import { getAuthText } from "@/shared/auth/authText";
import { useAuthController } from "@/shared/auth/useAuthController";
import type { ProviderId } from "@/shared/utils/parseRouter";
import type { UILang } from "./displayUtils";
import {
  SettingsAccountSection,
  SettingsActionsSection,
  SettingsConfigSections,
  SettingsSetupStatusCard,
} from "./settingsSections";
import { deriveSetupStatus, isSettingsDirty, type SettingsFormValues } from "./settingsTypes";

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
  const [deviceId, setDeviceId] = useState("");
  const [storedSnapshot, setStoredSnapshot] = useState<Partial<AppSettings> | null>(null);

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
    void loadSettings().then((settings) => {
      if (disposed) return;
      setStoredSnapshot(settings);
      setProviderId((settings.providerId as ProviderId) ?? "anthropic");
      setApiKey(settings.apiKey ?? "");
      setModel(settings.apiModel ?? "");
      setRoute(settings.preferredRoute ?? "auto");
      setCustomUrl(settings.customBaseUrl ?? "");
      setAnalyticsBaseUrl(settings.analyticsBaseUrl ?? DEFAULT_ANALYTICS_BASE_URL);
      setEnableAnalytics(settings.enableAnalytics ?? false);
      setCustomProtocol(settings.customProviderProtocol ?? "openai");
      setLang(initialLangRef.current || settings.language || "zh");
      setDeviceId(settings.deviceId ?? "");
      if (settings.apiKey || settings.providerId === "ollama") {
        setSavedOnce(true);
      }
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    setLang(initialLang);
  }, [initialLang]);

  const currentValues: SettingsFormValues = useMemo(
    () => ({
      providerId,
      apiKey,
      apiModel: model,
      preferredRoute: route,
      customBaseUrl: customUrl,
      analyticsBaseUrl,
      enableAnalytics,
      customProviderProtocol: customProtocol,
      language: lang,
    }),
    [providerId, apiKey, model, route, customUrl, analyticsBaseUrl, enableAnalytics, customProtocol, lang],
  );

  const isDirty = useMemo(
    () => isSettingsDirty(currentValues, storedSnapshot),
    [currentValues, storedSnapshot],
  );

  const isConfigured = useMemo(
    () => isProviderRuntimeConfigured(provider, { apiKey: apiKey.trim() }),
    [provider, apiKey],
  );

  const setupStatus = useMemo(
    () =>
      deriveSetupStatus({
        isConfigured,
        isDirty,
        testing,
        testResult,
        savedOnce,
      }),
    [isConfigured, isDirty, testing, testResult, savedOnce],
  );

  const activeStep = useMemo(() => {
    if (testResult?.tone === "success") return 4;
    if (testing) return 3;
    if (isConfigured) return 3;
    return 2;
  }, [testResult, testing, isConfigured]);

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
    setProviderId(id);
    setModel(getProvider(id).defaultModel);
    setApiKey("");
    setTestResult(null);
  };

  const handleSave = async () => {
    const nextSettings: Partial<AppSettings> = {
      providerId,
      apiKey: apiKey.trim(),
      apiModel: model || provider.defaultModel,
      preferredRoute: route,
      customBaseUrl: customUrl || undefined,
      analyticsBaseUrl: analyticsBaseUrl.trim() || DEFAULT_ANALYTICS_BASE_URL,
      enableAnalytics,
      customProviderProtocol: customProtocol,
      language: lang,
    };
    await saveSettings(nextSettings);
    setStoredSnapshot((prev) => ({ ...prev, ...nextSettings }));
    logEvent("settings_saved", { providerId, route });
    if (apiKey.trim()) logEvent("api_key_set", { providerId });
    onLanguageChange(lang);
    setSaved(true);
    setSavedOnce(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const currentProvider = getProvider(providerId);
      // Pre-flight check: required-key provider without a key fails closed safely.
      if (!isProviderRuntimeConfigured(currentProvider, { apiKey: apiKey.trim() })) {
        setTestResult(
          userFeedback("warning", getConnectionTestNotConfiguredMessage(isEn ? "en" : "zh"), {
            code: "PROVIDER_NOT_CONFIGURED",
          }),
        );
        setTesting(false);
        return;
      }
      const settings = await loadSettings();
      const testBlock: QuestionBlock = {
        id: "test",
        bbox: { x: 0, y: 0, width: 100, height: 50 },
        previewText: "1+1=? A.1 B.2 C.3 D.4",
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
    }
    setTesting(false);
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
      {/* 1. Setup Status & 4-Step Onboarding Stepper */}
      <SettingsSetupStatusCard
        status={setupStatus}
        isEn={isEn}
        activeStep={activeStep}
        onRetest={() => void handleTest()}
      />

      {/* 2. Provider, Credentials, Model, Base URL, Advanced, Language */}
      <SettingsConfigSections
        analyticsBaseUrl={analyticsBaseUrl}
        apiKey={apiKey}
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
        setApiKey={setApiKey}
        setCustomProtocol={setCustomProtocol}
        setCustomUrl={setCustomUrl}
        setLang={(nextLang) => {
          setLang(nextLang);
          onLanguageChange(nextLang);
        }}
        setModel={setModel}
        setRoute={setRoute}
      />

      {/* 3. Account / Session Section */}
      <SettingsAccountSection auth={auth} authText={authText} isEn={isEn} rejectedSessionHint={sessionRejectedHint} />

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
    </div>
  );
};
