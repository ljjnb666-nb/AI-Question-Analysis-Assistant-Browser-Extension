import React, { useEffect, useRef, useState } from "react";
import {
  isInjectablePageUrl,
  sendToActiveTab,
  sendToTabWithBootstrap,
} from "@/shared/utils/messaging";
import type { ExtMessage } from "@/shared/types";
import { sendAIConnectionCommand } from "@/shared/utils/aiConnectionClient";
import { getProviderShortName } from "@/shared/ai/providers";
import { getAIConnectionReadiness } from "@/shared/utils/aiSolvePreferences";
import { logEvent } from "@/shared/utils/analytics";
import { loadSettings, saveSettings } from "@/shared/utils/storage";
import { useAuthController } from "@/shared/auth/useAuthController";
import {
  clearProtectedWorkOwner,
  clearProtectedWorkOwnerGeneration,
  markProtectedWorkOwner,
  markProtectedWorkOwnerWithGeneration,
  terminateRecordedProtectedWork,
  type ProtectedWorkKind,
} from "@/shared/auth/protectedWorkOwner";
import { userFeedback, type UserFeedback } from "@/shared/ui/userFeedback";
import { orbitColors, orbitSpacing, orbitTypography } from "@/shared/ui/orbitTokens";
import { createPopupAuthority } from "./popupAuthority";
import { POPUP_COPY, type PopupLang } from "./popupCopy";
import { derivePopupViewState } from "./popupViewState";
import {
  PopupAuthSection,
  PopupContextLine,
  PopupFeedbackBanner,
  PopupFooter,
  PopupHeader,
  PopupPrimaryCommand,
  PopupRecoverySection,
  PopupSecondaryCommands,
  PopupSessionGateSection,
} from "./popupSections";

type ActiveFeature = "manual" | "auto" | "fullpage" | "solve" | null;

const KNOWN_POPUP_RECOVERY_CODES = new Set([
  "STALE_QUESTION_REVISION",
  "STALE_ROOT_CONTEXT",
  "PARTIAL_MUTATION_UNPROVABLE",
  "AUTHORITY_LOST",
  "PAGE_INJECTION_FAILED",
  "DISPATCH_FAILED",
]);

function extractKnownErrorCode(err: unknown): string | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
  ) {
    const rawCode = (err as { code: string }).code;
    if (KNOWN_POPUP_RECOVERY_CODES.has(rawCode)) {
      return rawCode;
    }
    return null;
  }
  const rawMsg = err instanceof Error ? err.message : String(err || "");
  for (const code of KNOWN_POPUP_RECOVERY_CODES) {
    if (rawMsg.includes(code)) {
      return code;
    }
  }
  return null;
}

const shellStyle: React.CSSProperties = {
  padding: `${orbitSpacing[3]}px`,
  display: "flex",
  flexDirection: "column",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  background: orbitColors.bg.canvas,
  color: orbitColors.text.primary,
  fontFamily: orbitTypography.fontFamily,
};

export const PopupApp: React.FC = () => {
  const [feedback, setFeedback] = useState<UserFeedback | null>(null);
  const [aiReady, setAIReady] = useState(false);
  const [providerName, setProviderName] = useState("Claude");
  const [lang, setLang] = useState<PopupLang>("zh");
  const [_loaded, setLoaded] = useState(false);
  const [activeFeature, setActiveFeature] = useState<ActiveFeature>(null);
  const [isPageInjectable, setIsPageInjectable] = useState<boolean | null>(null);
  const [reviewReason, setReviewReason] = useState<string | null>(null);

  const copy = POPUP_COPY[lang];
  const auth = useAuthController({ lang, variant: "popup" });
  const { isAuthenticated, isSessionPending, isServerUnavailable } = auth;

  // Handler-level authority reads the coordinator's CURRENT state directly,
  // not an effect-lagged ref or a render snapshot (AUTH-UI-INV-09).
  const authority = createPopupAuthority(auth.session);
  const isAuthenticatedNow = authority.isAuthenticatedNow;

  // A user language action taken while the initial settings/metadata load is
  // still in flight MUST win over that older load's result. Each toggle bumps
  // this generation; the mount continuation only applies its stale snapshot
  // when no toggle happened since the load started (P1-01 language race).
  const languageGenerationRef = useRef(0);

  // AUTH-UI-INV-11 + INV-15 (popup side): when this surface observes the
  // session leave `authenticated`, any long-running protected work recorded
  // in the cross-surface owner store — Popup- or Side-Panel-started — is
  // terminated at its recorded owner tab.
  const sessionRef = useRef(auth.session);
  useEffect(() => {
    sessionRef.current = auth.session;
  }, [auth.session]);

  useEffect(() => {
    let wasAuthenticated: boolean | null = null;
    const applySessionState = () => {
      const nowAuthenticated = sessionRef.current.getState().status === "authenticated";
      if (wasAuthenticated === true && !nowAuthenticated) {
        void terminateRecordedProtectedWork((tabId, message) =>
          sendToTabWithBootstrap(tabId, message as ExtMessage),
        );
      }
      wasAuthenticated = nowAuthenticated;
    };
    applySessionState();
    const unsubscribe = sessionRef.current.subscribe(applySessionState);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const generationAtStart = languageGenerationRef.current;
    void getAIConnectionReadiness().then(async (readiness) => {
      // An unmounted popup must not start the second-stage settings/metadata
      // messages at all, not merely discard their result.
      if (disposed) return;
      const [settings, response] = await Promise.all([
        loadSettings(), sendAIConnectionCommand({ type: "AI_CONNECTION_GET_ACTIVE_METADATA" }),
      ]);
      if (disposed) return;
      setAIReady(readiness.ready);
      const nextProviderId = response.metadata?.presetId;
      const nextLang = settings.language ?? "zh";
      setProviderName(nextProviderId ? getProviderShortName(nextProviderId) : "");
      if (generationAtStart === languageGenerationRef.current) {
        setLang(nextLang);
        if (typeof document !== "undefined") {
          document.documentElement.lang = nextLang === "zh" ? "zh-CN" : "en";
        }
      }
      setLoaded(true);
    }).catch(() => { if (!disposed) { setAIReady(false); setLoaded(true); } });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    logEvent("popup_opened");
  }, []);

  // Check active tab injectable capability
  useEffect(() => {
    try {
      if (typeof chrome !== "undefined" && chrome.tabs?.query) {
        void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
          if (tab?.url) {
            setIsPageInjectable(isInjectablePageUrl(tab.url));
          } else {
            setIsPageInjectable(false);
          }
        });
      } else {
        setIsPageInjectable(false);
      }
    } catch {
      setIsPageInjectable(false);
    }
  }, []);

  // UI-00A: shared provider-contract check
  const hasApiKey = aiReady;

  const viewState = derivePopupViewState({
    authStatus: auth.status,
    isAuthenticated,
    isSessionPending,
    isServerUnavailable,
    isPageInjectable,
    hasApiKey,
    activeFeature,
    reviewReason,
  });

  const openSidePanelDirect = async (): Promise<boolean> => {
    try {
      if (typeof chrome === "undefined" || !chrome.tabs?.query || !chrome.sidePanel?.open) {
        return false;
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.windowId) {
        return false;
      }
      await chrome.sidePanel.open({ windowId: tab.windowId });
      return true;
    } catch (error) {
      console.error("[Popup] sidePanel.open failed:", error);
      return false;
    }
  };

  const runAction = async (
    feature: Exclude<ActiveFeature, null>,
    startText: string,
    errorText: string,
    messageType:
      | "START_MANUAL_CAPTURE"
      | "START_AUTO_DETECT"
      | "START_FULL_PAGE_DETECT"
      | "START_AUTO_SOLVE_ALL",
    openPanel = false,
  ) => {
    // Handler-level fail closed: the button being visible is not authority.
    // Only a server-validated session may dispatch protected runtime actions.
    if (!isAuthenticatedNow()) {
      setFeedback(
        userFeedback("warning", copy.authRequiredWarning, {
          code: "AUTH_REQUIRED",
        }),
      );
      setActiveFeature(null);
      return;
    }

    // UI-00A minimal P0 gate: Auto Solve drives real page mutations, so it
    // must not start without a configured provider. Detection / manual
    // capture stay available — they produce no provider answers.
    if (messageType === "START_AUTO_SOLVE_ALL" && !hasApiKey) {
      setFeedback(
        userFeedback("warning", copy.providerMissingWarning, {
          code: "PROVIDER_REQUIRED",
        }),
      );
      setActiveFeature(null);
      return;
    }

    // AUTH-UI-INV-15: long-running protected work records its cross-surface
    // owner BEFORE dispatch, with the exact target tab, so an auth loss on
    // any surface can find and terminate the real owner. Hoisted so the
    // failure path can clear a half-built record.
    const longRunningKind: ProtectedWorkKind | null =
      messageType === "START_AUTO_SOLVE_ALL"
        ? "autoSolve"
        : messageType === "START_FULL_PAGE_DETECT"
          ? "fullPage"
          : null;
    let ownerTabId: number | undefined;
    let ownerGenerationId: string | undefined;
    const clearThisOwner = async () => {
      if (ownerTabId === undefined || !longRunningKind) return;
      if (longRunningKind === "autoSolve") {
        if (ownerGenerationId) await clearProtectedWorkOwnerGeneration(longRunningKind, ownerTabId, ownerGenerationId);
      } else {
        await clearProtectedWorkOwner(longRunningKind, ownerTabId);
      }
    };

    try {
      setActiveFeature(feature);
      setFeedback(userFeedback("info", startText));
      if (openPanel) await openSidePanelDirect();

      // Last-responsible-moment recheck: opening the panel awaited, so the
      // session may have lapsed since the entry gate (AUTH-UI-INV-12).
      if (!isAuthenticatedNow()) {
        setFeedback(
          userFeedback("warning", copy.sessionExpiredNotice, {
            code: "AUTHORITY_LOST",
          }),
        );
        setActiveFeature(null);
        return;
      }

      if (longRunningKind) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !isInjectablePageUrl(tab.url)) {
          setFeedback(userFeedback("error", errorText, { code: "PAGE_INJECTION_FAILED" }));
          setActiveFeature(null);
          return;
        }
        ownerTabId = tab.id;
        if (longRunningKind === "autoSolve") {
          ownerGenerationId = (await markProtectedWorkOwnerWithGeneration(longRunningKind, ownerTabId)) ?? undefined;
          if (!ownerGenerationId) throw new Error("PROTECTED_OWNER_UNAVAILABLE");
        } else {
          await markProtectedWorkOwner(longRunningKind, ownerTabId);
        }

        if (!isAuthenticatedNow()) {
          await clearThisOwner();
          setFeedback(
            userFeedback("warning", copy.sessionExpiredNotice, {
              code: "AUTHORITY_LOST",
            }),
          );
          setActiveFeature(null);
          return;
        }

        // Dispatch to the exact recorded owner tab (guard re-checks at every
        // await boundary inside the messaging chain).
        await sendToTabWithBootstrap(
          ownerTabId,
          messageType === "START_AUTO_SOLVE_ALL" && ownerGenerationId
            ? { type: "START_AUTO_SOLVE_ALL", generationId: ownerGenerationId }
            : { type: messageType },
          isAuthenticatedNow,
        );
      } else {
        await sendToActiveTab({ type: messageType }, isAuthenticatedNow);
      }

      if (typeof window !== "undefined" && window.close) {
        window.close();
      }
    } catch (err) {
      // A failed dispatch must not leave an owner record behind.
      if (ownerTabId != null && longRunningKind) {
        void clearThisOwner();
      }
      const rawMsg = err instanceof Error ? err.message : String(err || "");
      const knownCode = extractKnownErrorCode(err) || "DISPATCH_FAILED";
      if (
        knownCode === "STALE_QUESTION_REVISION" ||
        knownCode === "STALE_ROOT_CONTEXT" ||
        knownCode === "PARTIAL_MUTATION_UNPROVABLE"
      ) {
        setReviewReason(knownCode);
        setFeedback(
          userFeedback("warning", copy.safetyCheckWarning, {
            code: knownCode,
            technicalDetail: rawMsg,
          }),
        );
      } else if (knownCode === "AUTHORITY_LOST") {
        setReviewReason("AUTHORITY_LOST");
        setFeedback(
          userFeedback("warning", copy.sessionExpiredNotice, {
            code: "AUTHORITY_LOST",
            technicalDetail: rawMsg,
          }),
        );
      } else {
        setReviewReason(knownCode);
        setFeedback(
          userFeedback("error", errorText, {
            code: knownCode,
            technicalDetail: rawMsg,
          }),
        );
      }
      setActiveFeature(null);
    }
  };

  const handleOpenSidePanel = async () => {
    if (!isAuthenticatedNow()) {
      setFeedback(
        userFeedback("warning", copy.authRequiredWarning, {
          code: "AUTH_REQUIRED",
        }),
      );
      return;
    }
    const opened = await openSidePanelDirect();
    if (opened) {
      if (typeof window !== "undefined" && window.close) {
        window.close();
      }
    } else {
      setFeedback(
        userFeedback("error", copy.workspaceOpenError, {
          code: "WORKSPACE_OPEN_FAILED",
        }),
      );
    }
  };

  const handleRefreshPage = () => {
    try {
      if (typeof chrome !== "undefined" && chrome.tabs?.reload) {
        void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
          if (tab?.id) void chrome.tabs.reload(tab.id);
        });
      }
    } catch {
      // Ignore in test
    }
  };

  const handleReDetect = () => {
    setReviewReason(null);
    void runAction("auto", copy.startDetect, copy.detectError, "START_AUTO_DETECT", true);
  };

  const handleRetryValidation = async () => {
    await auth.retryValidation();
    const currentStatus = auth.session.getState().status;
    if (currentStatus === "authenticated") {
      setReviewReason(null);
      setFeedback(null);
    }
  };

  const toggleLang = () => {
    // Invalidate any in-flight initial load's language snapshot: this user
    // action is newer and must win over it (P1-01 language race).
    languageGenerationRef.current += 1;
    const nextLang: PopupLang = lang === "zh" ? "en" : "zh";
    setLang(nextLang);
    if (typeof document !== "undefined") {
      document.documentElement.lang = nextLang === "zh" ? "zh-CN" : "en";
    }
    void saveSettings({ language: nextLang });
  };

  const sessionGateVisible = isSessionPending || isServerUnavailable;

  return (
    <div style={shellStyle}>
      <PopupHeader
        appName={copy.appName}
        viewState={viewState}
        lang={lang}
        copy={copy}
        onOpenSettings={() => void handleOpenSidePanel()}
        onToggleLang={toggleLang}
        onLogout={() => void auth.handleLogout()}
        isAuthenticated={isAuthenticated}
      />

      {isAuthenticated ? (
        <>
          <PopupContextLine
            isPageInjectable={isPageInjectable}
            hasApiKey={hasApiKey}
            providerName={providerName}
            copy={copy}
          />

          <PopupPrimaryCommand
            copy={copy}
            lang={lang}
            isRunning={activeFeature !== null}
            activeFeature={activeFeature}
            onSolve={() =>
              void runAction(
                "solve",
                copy.startSolve,
                copy.solveError,
                "START_AUTO_SOLVE_ALL",
                true,
              )
            }
            isAuthenticated={isAuthenticated}
            isPageInjectable={isPageInjectable}
            hasApiKey={hasApiKey}
          />

          <PopupSecondaryCommands
            copy={copy}
            lang={lang}
            isRunning={activeFeature !== null}
            activeFeature={activeFeature}
            onDetect={() =>
              void runAction(
                "auto",
                copy.startDetect,
                copy.detectError,
                "START_AUTO_DETECT",
                true,
              )
            }
            onManualCapture={() =>
              void runAction(
                "manual",
                copy.startManual,
                copy.manualError,
                "START_MANUAL_CAPTURE",
                false,
              )
            }
            onFullPageScan={() =>
              void runAction(
                "fullpage",
                copy.startFullPage,
                copy.fullPageError,
                "START_FULL_PAGE_DETECT",
                true,
              )
            }
            isAuthenticated={isAuthenticated}
            isPageInjectable={isPageInjectable}
            hasApiKey={hasApiKey}
          />

          {viewState === "provider_setup_required" ||
          viewState === "review_required" ||
          viewState === "recoverable_error" ||
          viewState === "page_unavailable" ? (
            <PopupRecoverySection
              viewState={viewState}
              recoveryReason={reviewReason}
              lang={lang}
              onOpenSettings={() => void handleOpenSidePanel()}
              onOpenWorkspace={() => void handleOpenSidePanel()}
              onRefreshPage={handleRefreshPage}
              onReDetect={handleReDetect}
              onRetryValidation={handleRetryValidation}
              onLogout={() => void auth.handleLogout()}
            />
          ) : null}

          <PopupFooter
            copy={copy}
            onOpenWorkspace={() => void handleOpenSidePanel()}
            isAuthenticated={isAuthenticated}
          />
        </>
      ) : sessionGateVisible ? (
        <PopupSessionGateSection
          copy={copy}
          isSessionPending={isSessionPending}
          isServerUnavailable={isServerUnavailable}
          onRetry={handleRetryValidation}
          onLogout={() => void auth.handleLogout()}
        />
      ) : (
        <PopupAuthSection auth={auth} copy={copy} />
      )}

      <PopupFeedbackBanner feedback={feedback} />
    </div>
  );
};
