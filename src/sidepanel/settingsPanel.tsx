import { getAIConnectionReadiness } from "@/shared/utils/aiSolvePreferences";
import { ensureAIConnectionAuthorityReady } from "@/shared/utils/aiConnectionClient";
import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { QuestionBlock } from "@/shared/types";
import { DEFAULT_ANALYTICS_BASE_URL } from "@/shared/constants/analytics";
import { loadSettings, saveSettings } from "@/shared/utils/storage";
import { getConnectionTestNotConfiguredMessage } from "@/shared/ai/parseResultAuthority";
import { mapUserFacingError, userFeedback, type UserFeedback } from "@/shared/ui/userFeedback";
import { getProvider, parseQuestion } from "@/shared/utils/parseRouter";
import { logEvent } from "@/shared/utils/analytics";
import { getAuthText } from "@/shared/auth/authText";
import { useAuthController } from "@/shared/auth/useAuthController";
import type { ProviderId } from "@/shared/utils/parseRouter";
import type { UILang } from "./displayUtils";
import { SettingsAccountSection, SettingsActionsSection, SettingsConfigSections } from "./settingsSections";

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
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<UserFeedback | null>(null);
  const [deviceId, setDeviceId] = useState("");
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

  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  useEffect(() => {
    let disposed = false;
    void ensureAIConnectionAuthorityReady().then(() => loadSettings()).then((settings) => {
      if (disposed) return;
      setProviderId((settings.providerId as ProviderId) ?? "anthropic");
      setApiKey(settings.apiKey ?? "");
      setModel(settings.apiModel ?? "");
      setRoute(settings.preferredRoute ?? "auto");
      setCustomUrl(settings.customBaseUrl ?? "");
      setAnalyticsBaseUrl(settings.analyticsBaseUrl ?? DEFAULT_ANALYTICS_BASE_URL);
      setEnableAnalytics(settings.enableAnalytics ?? false);
      setCustomProtocol(settings.customProviderProtocol ?? "openai");
      setLang(settings.language ?? "zh");
      setDeviceId(settings.deviceId ?? "");
      // Auth identity is owned by the shared session coordinator inside
      // useAuthController; storage values never establish "signed in" here.
    }).catch(() => { /* Failed initialization leaves the form unconfigured; no legacy fallback. */ });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    setLang(initialLang);
  }, [initialLang]);

  useGSAP(
    () => {
      gsap.from(".settings-card", {
        y: 18,
        autoAlpha: 0,
        duration: 0.44,
        stagger: 0.06,
        ease: "power2.out",
      });
      gsap.from(".settings-action", {
        y: 16,
        scale: 0.97,
        autoAlpha: 0,
        duration: 0.42,
        stagger: 0.08,
        ease: "power2.out",
        delay: 0.08,
      });

      const hoverTargets = gsap.utils.toArray<HTMLElement>(".settings-card");
      const cleanups = hoverTargets.map((element) => {
        const onEnter = () => {
          gsap.to(element, {
            y: -3,
            boxShadow:
              "0 12px 28px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
            duration: 0.2,
            ease: "power2.out",
          });
        };
        const onLeave = () => {
          gsap.to(element, {
            y: 0,
            boxShadow:
              "0 4px 16px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.04)",
            duration: 0.2,
            ease: "power2.out",
          });
        };
        element.addEventListener("mouseenter", onEnter);
        element.addEventListener("mouseleave", onLeave);
        return () => {
          element.removeEventListener("mouseenter", onEnter);
          element.removeEventListener("mouseleave", onLeave);
        };
      });

      return () => {
        cleanups.forEach((cleanup) => cleanup());
      };
    },
    { scope: scopeRef, dependencies: [providerId, lang, testResult], revertOnUpdate: true },
  );

  const handleProviderChange = (id: ProviderId) => {
    if (id !== providerId) setCustomUrl("");
    setProviderId(id);
    setModel(getProvider(id).defaultModel);
    setApiKey("");
    setTestResult(null);
  };

  const saveCurrentDraft = () => saveSettings({
        providerId,
        apiKey: apiKey.trim(),
        apiModel: model || provider.defaultModel,
        preferredRoute: route,
        customBaseUrl: customUrl || undefined,
        analyticsBaseUrl: analyticsBaseUrl.trim() || DEFAULT_ANALYTICS_BASE_URL,
        enableAnalytics,
        customProviderProtocol: customProtocol,
        language: lang,
  });

  const handleSave = async () => {
    try {
      await saveCurrentDraft();
      logEvent("settings_saved", { providerId, route });
      if (apiKey.trim()) logEvent("api_key_set", { providerId });
      onLanguageChange(lang);
      setSaved(true);
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
      setTestResult(userFeedback(
        "success",
        isEn
          ? `Connection success | route: ${routeLabel} | answer: ${result.answer} | confidence ${Math.round(result.confidence * 100)}%`
          : `连接成功 | 路由：${routeLabel} | 答案：${result.answer} | 置信度 ${Math.round(result.confidence * 100)}%`,
        { code: "CONNECTION_TEST_OK" },
      ));
    } catch (error) {
      // UI-00B PART H: classified, safe copy; the raw provider text only
      // survives as technical detail and is not displayed by default.
      setTestResult(mapUserFacingError(error, isEn ? "en" : "zh", { context: "connection-test" }));
    } finally { setTesting(false); }
  };

  if (authOnly) {
    return (
      <div ref={scopeRef} style={{ padding: "14px 10px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        <SettingsAccountSection auth={auth} authText={authText} isEn={isEn} rejectedSessionHint={sessionRejectedHint} />
      </div>
    );
  }

  return (
    <div ref={scopeRef} style={{ padding: "14px 10px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
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
        setLang={setLang}
        setModel={setModel}
        setRoute={setRoute}
      />

      <SettingsAccountSection auth={auth} authText={authText} isEn={isEn} rejectedSessionHint={sessionRejectedHint} />

      <SettingsActionsSection
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
