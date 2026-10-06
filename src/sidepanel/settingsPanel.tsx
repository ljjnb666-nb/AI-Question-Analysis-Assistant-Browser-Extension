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
        display: "none",
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
  const [testingTarget, setTestingTarget] = useState<"none" | "committed" | "editor">("none");
  const [testResult, setTestResult] = useState<UserFeedback | null>(null);
  const [committedTestResult, setCommittedTestResult] = useState<UserFeedback | null>(null);
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
      if (!disposed) {
        setActiveMetadata(meta ?? null);
      }
    }).catch(() => {
      if (!disposed) {
        setActiveMetadata(null);
      }
    });
    return () => {
      disposed = true;
    };
  }, []);

  // Invalidate Ready, clear active metadata immediately, and reconcile editor draft whenever authoritative aiConnectionState changes in storage
  useEffect(() => {
    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.aiConnectionState) {
        setValidatedReceipt(null);
        setCommittedTestResult(null);
        setActiveMetadata(null);
        void Promise.all([
          loadSettings().catch(() => null),
          getAIConnectionEditorView().catch(() => null),
          getAIConnectionActiveMetadata().catch(() => null),
        ]).then(([settings, editor, freshMeta]) => {
          if (freshMeta) {
            setActiveMetadata(freshMeta);
          } else {
            setActiveMetadata(null);
          }
          if (editor) {
            const nextPresetId = (editor.presetId as ProviderId) || "anthropic";
            const nextProtocol = (editor.presetId === "custom" && editor.protocol === "anthropic_messages" ? "anthropic" : "openai") as "openai" | "anthropic";
            setProviderId(nextPresetId);
            setModel(editor.selectedModelId);
            setHasCredential(editor.hasCredential);
            setCustomUrl(editor.endpointOverride ?? "");
            setCustomProtocol(nextProtocol);
            setApiKey("");
            setIsCredentialCleared(false);
            setTestResult(null);

            setStoredSnapshot({
              presetId: nextPresetId,
              selectedModelId: editor.selectedModelId,
              endpointOverride: editor.endpointOverride,
              protocol: nextProtocol,
              hasCredential: editor.hasCredential,
              preferredRoute: settings?.preferredRoute ?? "auto",
              analyticsBaseUrl: settings?.analyticsBaseUrl ?? DEFAULT_ANALYTICS_BASE_URL,
              enableAnalytics: settings?.enableAnalytics ?? false,
              language: settings?.language ?? "zh",
            });
          }
        }).catch(() => {
          setActiveMetadata(null);
        });
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

  const connectionDraftDirty = useMemo(() => {
    if (!storedSnapshot) return false;
    if (providerId !== storedSnapshot.presetId) return true;
    if (apiKey.trim().length > 0) return true;
    if (isCredentialCleared && storedSnapshot.hasCredential) return true;
    if (model !== (storedSnapshot.selectedModelId ?? "")) return true;
    if (customUrl !== (storedSnapshot.endpointOverride ?? "")) return true;
    if (providerId === "custom" && customProtocol !== storedSnapshot.protocol) return true;
    return false;
  }, [storedSnapshot, providerId, apiKey, isCredentialCleared, model, customUrl, customProtocol]);

  const generalSettingsDirty = useMemo(() => {
    if (!storedSnapshot) return false;
    if (route !== storedSnapshot.preferredRoute) return true;
    if (analyticsBaseUrl !== storedSnapshot.analyticsBaseUrl) return true;
    if (enableAnalytics !== storedSnapshot.enableAnalytics) return true;
    if (lang !== storedSnapshot.language) return true;
    return false;
  }, [storedSnapshot, route, analyticsBaseUrl, enableAnalytics, lang]);

  const isDirty = connectionDraftDirty || generalSettingsDirty;

  const isConfigured = useMemo(
    () => Boolean(provider.keyOptional || hasCredential || apiKey.trim().length > 0),
    [provider.keyOptional, hasCredential, apiKey],
  );

  // Committed active connection strictly represents stored / authoritative backend state, ignoring unsaved editor drafts
  // Committed active connection strictly represents stored / authoritative backend state, ignoring unsaved editor drafts
  const committedPresetId = (activeMetadata?.presetId ?? storedSnapshot?.presetId ?? "anthropic") as ProviderId;
  const committedProvider = getProvider(committedPresetId);
  const committedModel = activeMetadata?.selectedModelId || storedSnapshot?.selectedModelId || committedProvider.defaultModel;
  const committedHasCredential = activeMetadata ? activeMetadata.hasCredential : Boolean(storedSnapshot?.hasCredential);
  const committedKeyOptional = committedProvider.keyOptional;
  const isCommittedConfigured = Boolean(committedKeyOptional || committedHasCredential);

  // Validation status for committed active connection:
  // Reload Ready only if persisted validation status is "validated" and matches connectionRevision + credentialRevision
  const isPersistedValidationMatch = Boolean(
    activeMetadata &&
    activeMetadata.validation?.status === "validated" &&
    activeMetadata.validation.validatedConnectionRevision === activeMetadata.connectionRevision &&
    (activeMetadata.validation.validatedCredentialRevision ?? 0) === (activeMetadata.credentialRevision ?? 0)
  );

  // In-session test receipt matches active metadata revisions
  const isReceiptMatch = Boolean(
    validatedReceipt &&
    activeMetadata &&
    (committedTestResult?.tone === "success" || testResult?.tone === "success") &&
    validatedReceipt.connectionId === activeMetadata.id &&
    validatedReceipt.connectionRevision === activeMetadata.connectionRevision &&
    (validatedReceipt.credentialRevision ?? 0) === (activeMetadata.credentialRevision ?? 0) &&
    (validatedReceipt.validationGeneration === undefined ||
      activeMetadata.validation?.generation === undefined ||
      validatedReceipt.validationGeneration === activeMetadata.validation.generation)
  );

  const isCommittedValidated = Boolean(activeMetadata && (isReceiptMatch || isPersistedValidationMatch));

  // In editor, validation is invalidated if connection draft is dirty (provider/model/key/url/protocol changed)
  const isValidated = useMemo(() => {
    if (connectionDraftDirty) return false;
    return isCommittedValidated;
  }, [connectionDraftDirty, isCommittedValidated]);

  const setupStatus: SetupStatus = useMemo(
    () =>
      deriveSetupStatus({
        isConfigured,
        isDirty: connectionDraftDirty,
        testing: testingTarget === "editor",
        testResult,
        savedOnce,
        isValidated,
      }),
    [isConfigured, connectionDraftDirty, testingTarget, testResult, savedOnce, isValidated],
  );

  const homeSetupStatus: SetupStatus = useMemo(
    () =>
      deriveSetupStatus({
        isConfigured: isCommittedConfigured,
        isDirty: false, // Committed connection is never dirty from unsaved editor drafts
        testing: testingTarget === "committed",
        testResult: committedTestResult,
        savedOnce: savedOnce || isCommittedConfigured,
        isValidated: isCommittedValidated,
      }),
    [isCommittedConfigured, testingTarget, committedTestResult, savedOnce, isCommittedValidated],
  );

  const currentSetupStatus = view === "home" ? homeSetupStatus : setupStatus;

  const activeStep = useMemo(() => {
    if (!auth.isAuthenticated) return 1;
    if (view === "home") {
      if (isCommittedValidated) return 4;
      if (testingTarget === "committed") return 3;
      if (!isCommittedConfigured) return 2;
      return 3;
    }
    if (isValidated) return 4;
    if (testingTarget === "editor") return 3;
    if (!isConfigured) return 2;
    return 3;
  }, [auth.isAuthenticated, view, isCommittedValidated, testingTarget, isCommittedConfigured, isValidated, isConfigured]);

  const discardDraft = () => {
    if (!storedSnapshot) return;
    setProviderId(storedSnapshot.presetId);
    setModel(storedSnapshot.selectedModelId);
    setCustomUrl(storedSnapshot.endpointOverride ?? "");
    setCustomProtocol(storedSnapshot.protocol);
    setApiKey("");
    setHasCredential(storedSnapshot.hasCredential);
    setIsCredentialCleared(false);
    setTestResult(null);
  };

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
    { scope: scopeRef, dependencies: [providerId, lang, committedTestResult, testResult, view], revertOnUpdate: true },
  );

  const handleProviderChange = (id: ProviderId) => {
    if (id === providerId) {
      setApiKey("");
      return;
    }
    setProviderId(id);
    setModel(getProvider(id).defaultModel);
    setApiKey("");
    setHasCredential(false);
    setIsCredentialCleared(false);
    setTestResult(null);
    setCustomUrl("");
    if (id === "custom") {
      setCustomProtocol("openai");
    }
  };

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    setTestResult(null);
  };

  const handleClearCredential = () => {
    setApiKey("");
    setHasCredential(false);
    setIsCredentialCleared(true);
    setTestResult(null);
  };

  const handleModelChange = (val: string) => {
    setModel(val);
    setTestResult(null);
  };

  const handleCustomUrlChange = (val: string) => {
    setCustomUrl(val);
    setTestResult(null);
  };

  const handleCustomProtocolChange = (val: "openai" | "anthropic") => {
    setCustomProtocol(val);
    setTestResult(null);
  };

  const handleHomeLanguageChange = async (nextLang: UILang) => {
    setLang(nextLang);
    onLanguageChange(nextLang);
    try {
      await saveSettings({ language: nextLang });
      setStoredSnapshot((prev) => (prev ? { ...prev, language: nextLang } : prev));
    } catch {
      // Failed persistence leaves in-memory state
    }
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
    setValidatedReceipt(null);
    setCommittedTestResult(null);
    if (committed.metadata) {
      setActiveMetadata(committed.metadata);
    }
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

  // Retest committed active connection directly from Home without committing any uncommitted editor drafts
  const handleTestCommitted = async () => {
    setTestingTarget("committed");
    setCommittedTestResult(null);
    try {
      // INVARIANT: DO NOT call saveCurrentDraft! Unsaved editor drafts are never committed by Home retest.
      const beforeMeta = await getAIConnectionActiveMetadata().catch(() => null);
      if (!beforeMeta) {
        setValidatedReceipt(null);
        setActiveMetadata(null);
        const feedback = userFeedback(
          "error",
          isEn ? "AI connection metadata unavailable." : "无法获取 AI 连接元数据。",
        );
        setCommittedTestResult(feedback);
        setTestResult(feedback);
        return;
      }

      const readiness = await getAIConnectionReadiness();
      if (!readiness.ready) {
        const warningFeedback = userFeedback("warning", getConnectionTestNotConfiguredMessage(isEn ? "en" : "zh"), { code: readiness.code });
        setCommittedTestResult(warningFeedback);
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
      const afterMeta = await getAIConnectionActiveMetadata().catch(() => null);
      if (!afterMeta) {
        setValidatedReceipt(null);
        setActiveMetadata(null);
        const feedback = userFeedback(
          "warning",
          isEn ? "Configuration changed during test. Please re-test." : "测试期间配置已发生变化，请重新测试。",
          { code: "CONFIGURATION_CHANGED" }
        );
        setCommittedTestResult(feedback);
        setTestResult(feedback);
        return;
      }

      const isGenerationMatch =
        beforeMeta.validation?.generation === undefined ||
        afterMeta.validation?.generation === undefined ||
        beforeMeta.validation.generation === afterMeta.validation.generation;

      const isAuthorityMatch =
        beforeMeta.id === afterMeta.id &&
        beforeMeta.connectionRevision === afterMeta.connectionRevision &&
        (beforeMeta.credentialRevision ?? 0) === (afterMeta.credentialRevision ?? 0) &&
        isGenerationMatch;

      if (!isAuthorityMatch) {
        setValidatedReceipt(null);
        setActiveMetadata(afterMeta);
        const feedback = userFeedback(
          "warning",
          isEn ? "Configuration changed during test. Please re-test." : "测试期间配置已发生变化，请重新测试。",
          { code: "CONFIGURATION_CHANGED" }
        );
        setCommittedTestResult(feedback);
        setTestResult(feedback);
        return;
      }

      setActiveMetadata(afterMeta);
      setValidatedReceipt({
        connectionId: afterMeta.id,
        connectionRevision: afterMeta.connectionRevision,
        credentialRevision: afterMeta.credentialRevision,
        validationGeneration: afterMeta.validation?.generation,
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
      const feedback = userFeedback(
        "success",
        isEn
          ? `Connection success | route: ${routeLabel} | answer: ${result.answer} | confidence ${Math.round(result.confidence * 100)}%`
          : `连接成功 | 路由：${routeLabel} | 答案：${result.answer} | 置信度 ${Math.round(result.confidence * 100)}%`,
        { code: "CONNECTION_TEST_OK" },
      );
      setCommittedTestResult(feedback);
      setTestResult(feedback);
    } catch (error) {
      const feedback = mapUserFacingError(error, isEn ? "en" : "zh", { context: "connection-test" });
      setCommittedTestResult(feedback);
      setTestResult(feedback);
    } finally {
      setTestingTarget("none");
    }
  };

  // Test editor draft by saving it to committed state first, then verifying the new connection
  const handleTestEditor = async () => {
    setTestingTarget("editor");
    setTestResult(null);
    try {
      await saveCurrentDraft();

      const beforeMeta = await getAIConnectionActiveMetadata().catch(() => null);
      if (!beforeMeta) {
        setValidatedReceipt(null);
        setActiveMetadata(null);
        const feedback = userFeedback(
          "error",
          isEn ? "AI connection metadata unavailable." : "无法获取 AI 连接元数据。",
        );
        setTestResult(feedback);
        setCommittedTestResult(feedback);
        return;
      }

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
      const afterMeta = await getAIConnectionActiveMetadata().catch(() => null);
      if (!afterMeta) {
        setValidatedReceipt(null);
        setActiveMetadata(null);
        const feedback = userFeedback(
          "warning",
          isEn ? "Configuration changed during test. Please re-test." : "测试期间配置已发生变化，请重新测试。",
          { code: "CONFIGURATION_CHANGED" }
        );
        setTestResult(feedback);
        setCommittedTestResult(feedback);
        return;
      }

      const isGenerationMatch =
        beforeMeta.validation?.generation === undefined ||
        afterMeta.validation?.generation === undefined ||
        beforeMeta.validation.generation === afterMeta.validation.generation;

      const isAuthorityMatch =
        beforeMeta.id === afterMeta.id &&
        beforeMeta.connectionRevision === afterMeta.connectionRevision &&
        (beforeMeta.credentialRevision ?? 0) === (afterMeta.credentialRevision ?? 0) &&
        isGenerationMatch;

      if (!isAuthorityMatch) {
        setValidatedReceipt(null);
        setActiveMetadata(afterMeta);
        const feedback = userFeedback(
          "warning",
          isEn ? "Configuration changed during test. Please re-test." : "测试期间配置已发生变化，请重新测试。",
          { code: "CONFIGURATION_CHANGED" }
        );
        setTestResult(feedback);
        setCommittedTestResult(feedback);
        return;
      }

      setActiveMetadata(afterMeta);
      setValidatedReceipt({
        connectionId: afterMeta.id,
        connectionRevision: afterMeta.connectionRevision,
        credentialRevision: afterMeta.credentialRevision,
        validationGeneration: afterMeta.validation?.generation,
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
      const feedback = userFeedback(
        "success",
        isEn
          ? `Connection success | route: ${routeLabel} | answer: ${result.answer} | confidence ${Math.round(result.confidence * 100)}%`
          : `连接成功 | 路由：${routeLabel} | 答案：${result.answer} | 置信度 ${Math.round(result.confidence * 100)}%`,
        { code: "CONNECTION_TEST_OK" },
      );
      setTestResult(feedback);
      setCommittedTestResult(feedback);
    } catch (error) {
      const feedback = mapUserFacingError(error, isEn ? "en" : "zh", { context: "connection-test" });
      setTestResult(feedback);
    } finally {
      setTestingTarget("none");
    }
  };

  if (authOnly) {
    return (
      <div
        ref={scopeRef}
        data-testid="settings-home-view"
        style={{
          padding: "14px 10px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <SettingsSetupStatusCard
          status="not_configured"
          isEn={isEn}
          activeStep={1}
          onRetest={() => {}}
        />
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
              {isEn ? "Step 1: Sign in to your account" : "第一步：账号登录"}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: orbitColors.text.secondary, lineHeight: 1.5 }}>
            {isEn
              ? "An account is required to use Quiz Solver and sync settings. Please sign in below to unlock provider setup."
              : "使用 Quiz Solver 需要验证身份。请在下方登录或注册，完成后将自动进入服务商配置。"}
          </p>
        </section>
        <SettingsAccountSection auth={auth} authText={authText} isEn={isEn} rejectedSessionHint={sessionRejectedHint} />
      </div>
    );
  }

  return (
    <div
      ref={scopeRef}
      data-testid="settings-panel"
      data-ready={Boolean(storedSnapshot)}
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
        hidden={view !== "home"}
        {...(view !== "home" ? { inert: "" } : {})}
        style={getViewContainerStyle(view === "home")}
      >
        {/* 1. Setup Status & 4-Step Onboarding Stepper Header */}
        <SettingsSetupStatusCard
          status={currentSetupStatus}
          isEn={isEn}
          activeStep={activeStep}
          onRetest={() => void (view === "home" ? handleTestCommitted() : handleTestEditor())}
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
                {isEn ? "Step 1: Sign in to your account" : "第一步：账号登录"}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: orbitColors.text.secondary, lineHeight: 1.5 }}>
              {isEn
                ? "An account is required to use Quiz Solver and sync settings. Please sign in below to unlock provider setup."
                : "使用 Quiz Solver 需要验证身份。请在下方登录或注册，完成后将自动进入服务商配置。"}
            </p>
          </section>
        ) : !isCommittedConfigured ? (
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
                ? "Enter an API key to enable AI solving and connection testing."
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

        {/* 2. Active AI Connection Summary Card (renders committed connection, NOT unsaved editor draft) */}
        <SettingsHomeSummaryCard
          providerName={committedProvider.name}
          modelName={committedModel}
          connectionStatus={homeSetupStatus}
          hasCredential={committedHasCredential}
          keyOptional={committedKeyOptional}
          isEn={isEn}
          onChangeService={() => setView("catalog")}
          onEditConnection={() => setView("editor")}
          onTestConnection={() => void handleTestCommitted()}
          testing={testingTarget === "committed"}
        />

        {/* 3. Global Preferences: Language & Usage Analytics */}
        <SettingsGeneralSection
          isEn={isEn}
          lang={lang}
          onLanguageChange={handleHomeLanguageChange}
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
        hidden={view !== "catalog"}
        {...(view !== "catalog" ? { inert: "" } : {})}
        style={getViewContainerStyle(view === "catalog")}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
          <button
            type="button"
            data-testid="nav-catalog-back-to-home"
            onClick={() => {
              discardDraft();
              setView("home");
            }}
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
        hidden={view !== "editor"}
        {...(view !== "editor" ? { inert: "" } : {})}
        style={getViewContainerStyle(view === "editor")}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
          <button
            type="button"
            data-testid="nav-editor-back-to-catalog"
            onClick={() => {
              discardDraft();
              setView("catalog");
            }}
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
            onClick={() => {
              discardDraft();
              setView("home");
            }}
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
          onTest={() => void handleTestEditor()}
          saved={saved}
          testResult={testResult}
          testing={testingTarget === "editor"}
        />
      </div>
    </div>
  );
};
