import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { loadSettings, saveSettings } from "@/shared/utils/storage";
import { logoutAccount } from "@/shared/utils/auth";
import { sendAIConnectionCommand } from "@/shared/utils/aiConnectionClient";
import { getProviderShortName } from "@/shared/ai/providers";
import { useAuthSession } from "@/shared/auth/useAuthSession";
import {
  clearProtectedWorkOwner,
  markProtectedWorkOwner,
  markProtectedWorkOwnerWithGeneration,
  clearProtectedWorkOwnerGeneration,
  terminateRecordedProtectedWork,
} from "@/shared/auth/protectedWorkOwner";
import type { UILang } from "./displayUtils";
import { isRiskyCandidate } from "./batchParseHeuristics";
import type { UserFeedback } from "@/shared/ui/userFeedback";
import { HistoryTab } from "./HistoryTab";
import { SettingsTab } from "./settingsPanel";
import { registerSidePanelRuntimeListeners } from "./sidepanelMessageBridge";
import { computeCandidateMetrics, type CandidateViewFilter } from "./sidepanelCandidateMetrics";
import { planAuthLossStop } from "./sidepanelAuthLoss";
import { CandidatesTab } from "./CandidatesTab";
import { sendTabMessageWithBootstrap } from "./tabActions";
import {
  APP_SHELL_STYLE,
  PANEL_BODY_STYLE,
  SidePanelActivityStrip,
  SidePanelHeader,
  SidePanelLockedState,
  WorkspaceTabPanel,
} from "./sidePanelShell";
import type { AutoSolveProgressState, ScanProgressState, SidePanelAppState } from "./sidepanelAppState";
import { initialSidePanelAppState, sidePanelAppReducer } from "./sidepanelAppState";
import { useSidePanelActions } from "./useSidePanelActions";
import { useCandidateWorkspaceHydration } from "./useCandidateWorkspaceHydration";
import type { CandidateOrigin, CandidateWorkspaceSnapshot } from "@/shared/types";
import type { WorkspaceHydrationStatus } from "./workspaceHydration";
import { OrbitButton, OrbitSurface } from "@/shared/ui/orbitPrimitives";
import { WorkspaceUserFeedback } from "./WorkspaceUserFeedback";
import { SIDEPANEL_COPY } from "./sidePanelCopy";
import { ORBIT_SCROLLBAR_CSS } from "./orbitScrollbar";
import {
  deriveSidePanelWorkspaceStatus,
  deriveWorkspaceActivity,
} from "./sidePanelWorkspaceState";

export { findNextFractionExpression, normalizeRenderableMathText, renderMathText } from "./displayUtils";

export const SidePanelApp: React.FC = () => {
  const [state, dispatch] = useReducer(sidePanelAppReducer, initialSidePanelAppState);
  const [providerName, setProviderName] = useState<string | undefined>(undefined);

  const setUiLang = useCallback((updater: React.SetStateAction<UILang>) => dispatch({ type: "uiLang", updater }), []);
  const setIsAuthenticated = useCallback(
    (updater: React.SetStateAction<boolean>) => dispatch({ type: "isAuthenticated", updater }),
    [],
  );
  const setUserEmail = useCallback(
    (updater: React.SetStateAction<string>) => dispatch({ type: "userEmail", updater }),
    [],
  );
  const setAuthStatus = useCallback(
    (updater: React.SetStateAction<SidePanelAppState["authStatus"]>) =>
      dispatch({ type: "authStatus", updater }),
    [],
  );
  const setSessionRejected = useCallback(
    (updater: React.SetStateAction<boolean>) => dispatch({ type: "sessionRejected", updater }),
    [],
  );
  const setTab = useCallback((updater: React.SetStateAction<SidePanelAppState["tab"]>) => dispatch({ type: "tab", updater }), []);
  const setCandidates = useCallback(
    (updater: React.SetStateAction<SidePanelAppState["candidates"]>) => dispatch({ type: "candidates", updater }),
    [],
  );
  const setIsDetecting = useCallback(
    (updater: React.SetStateAction<boolean>) => dispatch({ type: "isDetecting", updater }),
    [],
  );
  const setIsFullPageScan = useCallback(
    (updater: React.SetStateAction<boolean>) => dispatch({ type: "isFullPageScan", updater }),
    [],
  );
  const setScanProgress = useCallback(
    (updater: React.SetStateAction<ScanProgressState>) => dispatch({ type: "scanProgress", updater }),
    [],
  );
  const setIsBatchParsing = useCallback(
    (updater: React.SetStateAction<boolean>) => dispatch({ type: "isBatchParsing", updater }),
    [],
  );
  const setIsBatchFilling = useCallback(
    (updater: React.SetStateAction<boolean>) => dispatch({ type: "isBatchFilling", updater }),
    [],
  );
  const setIsRetryingRisky = useCallback(
    (updater: React.SetStateAction<boolean>) => dispatch({ type: "isRetryingRisky", updater }),
    [],
  );
  const setExpandedIds = useCallback(
    (updater: React.SetStateAction<SidePanelAppState["expandedIds"]>) => dispatch({ type: "expandedIds", updater }),
    [],
  );
  const setCandidateViewFilter = useCallback(
    (updater: React.SetStateAction<CandidateViewFilter>) => dispatch({ type: "candidateViewFilter", updater }),
    [],
  );
  const setFillFeedback = useCallback(
    (updater: React.SetStateAction<UserFeedback | null>) => dispatch({ type: "fillFeedback", updater }),
    [],
  );
  const setIsAutoSolving = useCallback(
    (updater: React.SetStateAction<boolean>) => dispatch({ type: "isAutoSolving", updater }),
    [],
  );
  const setAutoSolveProgress = useCallback(
    (updater: React.SetStateAction<AutoSolveProgressState>) => dispatch({ type: "autoSolveProgress", updater }),
    [],
  );

  // Server-authoritative session lifecycle for this surface. The coordinator
  // validates the locally cached candidate against /auth/session at startup
  // and re-reconciles on auth-related storage changes; storage values alone
  // never unlock the workspace.
  const session = useAuthSession();
  const workspaceAccessRef = useRef<{ status: WorkspaceHydrationStatus; origin?: CandidateOrigin }>({ status: "idle" });
  const applyWorkspace = useCallback((status: WorkspaceHydrationStatus, snapshot?: CandidateWorkspaceSnapshot, origin?: CandidateOrigin) => {
    workspaceAccessRef.current = { status, origin };
    dispatch({ type: "hydrateWorkspace", status, snapshot, origin });
  }, []);
  const retryWorkspace = useCandidateWorkspaceHydration(session, applyWorkspace);

  // Latest committed state for non-render consumers.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // AUTH-UI-INV-13 + INV-15: synchronous registry of long-running protected
  // runtime work, mirrored into the cross-surface owner store
  // (chrome.storage.session) so a Popup-started or Side-Panel-started
  // workflow has exactly one visible owner record everywhere. The sync ref
  // covers the zero-lag window between dispatch and the async mirror; the
  // cross-surface store is what makes the owner visible beyond this
  // component (never user config, transient by design).
  const protectedWorkRef = useRef<{
    autoSolve: { active: boolean; tabId?: number; generationId?: string };
    fullPage: { active: boolean; tabId?: number; generationId?: string };
  }>({ autoSolve: { active: false }, fullPage: { active: false } });

  const markProtectedWork = useCallback(
    async (kind: "autoSolve" | "fullPage", active: boolean, tabId: number) => {
      // Zero-lag sync flip FIRST: the auth-loss watchdog must see the local
      // START intent even while the cross-surface write below is in flight.
      protectedWorkRef.current[kind] = { active, tabId: active ? tabId : undefined };
      // Awaited cross-surface commit: callers re-check authority after this
      // resolves, so a pending mark can never resurrect a stale owner
      // (AUTH-UI-INV-15/16).
      if (active) {
        await markProtectedWorkOwner(kind, tabId);
      } else {
        await clearProtectedWorkOwner(kind, tabId);
      }
    },
    [],
  );

  // Keep ref mutations at the component that owns the work intent; the action
  // hook only asks for intent to be cleared before asynchronous STOP.
  const clearProtectedWorkIntent = useCallback((kind: "autoSolve" | "fullPage") => {
    protectedWorkRef.current[kind] = { active: false };
  }, []);

  const markProtectedWorkGeneration = useCallback(async (kind: "autoSolve" | "fullPage", tabId: number) => {
    const intent = { active: true, tabId };
    protectedWorkRef.current[kind] = intent;
    const generationId = await markProtectedWorkOwnerWithGeneration(kind, tabId);
    // A newer same-tab START or the auth-loss watchdog can revoke the intent
    // during storage I/O. In either case, the old START must not be dispatched.
    if (protectedWorkRef.current[kind] !== intent) {
      if (generationId) await clearProtectedWorkOwnerGeneration(kind, tabId, generationId);
      return null;
    }
    if (!generationId) {
      protectedWorkRef.current[kind] = { active: false };
      return null;
    }
    protectedWorkRef.current[kind] = { active: true, tabId, generationId };
    return generationId;
  }, []);

  const isProtectedWorkGenerationCurrent = useCallback(
    (kind: "autoSolve" | "fullPage", tabId: number, generationId: string) => {
      const current = protectedWorkRef.current[kind];
      return current.active && current.tabId === tabId && current.generationId === generationId;
    }, [],
  );

  const clearProtectedWorkGeneration = useCallback(async (
    kind: "autoSolve" | "fullPage", tabId: number, generationId: string,
  ) => {
    if (protectedWorkRef.current[kind].tabId === tabId
      && protectedWorkRef.current[kind].generationId === generationId) {
      protectedWorkRef.current[kind] = { active: false };
    }
    await clearProtectedWorkOwnerGeneration(kind, tabId, generationId);
  }, []);

  useEffect(() => {
    let disposed = false;
    // Transition marker lives in the effect closure: coordinator notifications
    // can arrive outside React's render/effect cycle, so the authenticated→
    // non-authenticated flip must not depend on a ref that only refreshes
    // after a render.
    let wasAuthenticated: boolean | null = null;
    const applySessionState = () => {
      if (disposed) return;
      const snapshot = session.getState();
      const nowAuthenticated = snapshot.status === "authenticated";
      setAuthStatus(snapshot.status);
      setUserEmail(snapshot.userEmail);
      setSessionRejected(snapshot.sessionRejected);
      setIsAuthenticated(nowAuthenticated);
      if (snapshot.status === "unauthenticated") {
        setTab("settings");
      }
      // AUTH-UI-INV-11 + INV-13: leaving `authenticated` must terminate
      // protected work already dispatched to the content script and reset
      // the transient protected-work flags, best-effort. Termination
      // authority reads the synchronous protected-work registry, not the
      // effect-lagged state snapshot.
      if (wasAuthenticated === true && !nowAuthenticated) {
        const syncPlan = planAuthLossStop({
          isAutoSolving: protectedWorkRef.current.autoSolve.active,
          autoSolveTabId: protectedWorkRef.current.autoSolve.tabId,
          isFullPageScan: protectedWorkRef.current.fullPage.active,
          fullPageTabId: protectedWorkRef.current.fullPage.tabId,
        });
        protectedWorkRef.current.autoSolve = { active: false };
        protectedWorkRef.current.fullPage = { active: false };
        // Reuse the same immutable-key snapshot fence as Popup. The
        // Side Panel's zero-lag local tabs join STOP fanout, but do NOT make
        // later generations eligible for cleanup once STOP has awaited.
        // This eliminates the duplicate read/send/clear-by-tab ABA path.
        void terminateRecordedProtectedWork(
          (tabId, message) => sendTabMessageWithBootstrap(tabId, message),
          {
            autoSolve: syncPlan.stopAutoSolve ? syncPlan.autoSolveTabId : undefined,
            fullPage: syncPlan.cancelFullPage ? syncPlan.fullPageTabId : undefined,
          },
        ).catch(() => undefined);
        setIsAutoSolving(false);
        setAutoSolveProgress(null);
        setIsFullPageScan(false);
        setScanProgress(null);
        setIsDetecting(false);
        setIsBatchParsing(false);
        setIsBatchFilling(false);
        setIsRetryingRisky(false);
      }
      wasAuthenticated = nowAuthenticated;
    };
    applySessionState();
    const unsubscribe = session.subscribe(applySessionState);
    session.start();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [session, setAuthStatus, setAutoSolveProgress, setIsAuthenticated, setIsAutoSolving, setIsBatchFilling, setIsBatchParsing, setIsDetecting, setIsFullPageScan, setIsRetryingRisky, setScanProgress, setSessionRejected, setTab, setUserEmail]);

  useEffect(() => {
    const refreshProvider = () => void sendAIConnectionCommand({ type: "AI_CONNECTION_GET_ACTIVE_METADATA" }).then(response => {
      setProviderName(response.metadata ? getProviderShortName(response.metadata.presetId) : undefined);
    }).catch(() => setProviderName(undefined));
    loadSettings().then(settings => setUiLang(settings.language));
    refreshProvider();

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== "local") return;
      if (changes.aiConnectionState) refreshProvider();
      if (!changes.appSettings?.newValue) return;

      const nextSettings = changes.appSettings.newValue as {
        language?: UILang;
      };

      if (nextSettings.language === "zh" || nextSettings.language === "en") {
        setUiLang(nextSettings.language);
      }
      // Auth-related storage changes are intentionally NOT converted into an
      // authenticated state here: the session coordinator owns that authority.
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    const unregisterRuntime = registerSidePanelRuntimeListeners({
      renderWorkspace: false,
      getFeedbackOrigin: () => session.getState().status === "authenticated"
        && workspaceAccessRef.current.status === "ready" ? workspaceAccessRef.current.origin : undefined,
      loadLanguage: async () => ((await loadSettings()).language ?? "zh") as UILang,
      setUiLang,
      setCandidates,
      setIsDetecting,
      setIsFullPageScan,
      setScanProgress,
      setExpandedIds,
      setIsAutoSolving,
      setAutoSolveProgress,
      setFillFeedback,
    });

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
      unregisterRuntime();
    };
  }, [
    session,
    setAutoSolveProgress,
    setCandidates,
    setExpandedIds,
    setFillFeedback,
    setIsAutoSolving,
    setIsDetecting,
    setIsFullPageScan,
    setScanProgress,
    setUiLang,
  ]);

  const {
    handleBatchFill,
    handleBatchParse,
    handleCancelFullPage,
    handleClearSelection,
    handleDetect,
    handleFillCandidate,
    handleFlash,
    handleFullPageDetect,
    handleRetryRisky,
    handleRetryVision,
    handleSelectAll,
    handleSelectRisky,
    handleStartAutoSolve,
    handleStopAutoSolve,
    toggleDetails,
    toggleSelect,
  } = useSidePanelActions({
    candidates: state.candidates,
    isBatchParsing: state.isBatchParsing,
    isAuthenticatedNow: () => session.getState().status === "authenticated",
    isWorkspaceReadyNow: () => workspaceAccessRef.current.status === "ready",
    getWorkspaceOrigin: () => workspaceAccessRef.current.origin,
    markProtectedWork,
    markProtectedWorkGeneration,
    clearProtectedWorkGeneration,
    isProtectedWorkGenerationCurrent,
    clearProtectedWorkIntent,
    protectedWork: protectedWorkRef,
    setCandidates,
    setExpandedIds,
    setFillFeedback,
    setIsAutoSolving,
    setIsBatchFilling,
    setIsBatchParsing,
    setIsDetecting,
    setIsFullPageScan,
    setIsRetryingRisky,
    setAutoSolveProgress,
    setScanProgress,
    uiLang: state.uiLang,
  });

  const { selectedCount, selectedSolvedCount, riskyCount, doneCount, filteredCandidates } = useMemo(
    () => computeCandidateMetrics(state.candidates, state.candidateViewFilter, isRiskyCandidate),
    [state.candidateViewFilter, state.candidates],
  );

  const workspaceStatus = useMemo(
    () =>
      deriveSidePanelWorkspaceStatus({
        authStatus: state.authStatus,
        isAuthenticated: state.isAuthenticated,
        hydrationStatus: state.hydrationStatus,
        isDetecting: state.isDetecting,
        isFullPageScan: state.isFullPageScan,
        isAutoSolving: state.isAutoSolving,
        isBatchParsing: state.isBatchParsing,
        isBatchFilling: state.isBatchFilling,
        autoSolveProgress: state.autoSolveProgress,
        fillFeedback: state.fillFeedback,
      }),
    [
      state.authStatus,
      state.autoSolveProgress,
      state.fillFeedback,
      state.isAutoSolving,
      state.isBatchFilling,
      state.isBatchParsing,
      state.isAuthenticated,
      state.hydrationStatus,
      state.isDetecting,
      state.isFullPageScan,
    ],
  );

  useEffect(() => {
    document.documentElement.lang = state.uiLang === "en" ? "en" : "zh-CN";
  }, [state.uiLang]);

  const activity = useMemo(
    () =>
      deriveWorkspaceActivity({
        status: workspaceStatus,
        lang: state.uiLang,
        isDetecting: state.isDetecting,
        isFullPageScan: state.isFullPageScan,
        scanProgress: state.scanProgress,
        isAutoSolving: state.isAutoSolving,
        isBatchParsing: state.isBatchParsing,
        isBatchFilling: state.isBatchFilling,
        autoSolveProgress: state.autoSolveProgress,
        fillFeedback: state.fillFeedback,
        currentTab: state.tab,
        onCancelFullPage: handleCancelFullPage,
        onStopAutoSolve: handleStopAutoSolve,
        onReviewCandidates: () => setTab("candidates"),
        onDismissFeedback: () => setFillFeedback(null),
      }),
    [
      workspaceStatus,
      state.uiLang,
      state.isDetecting,
      state.isFullPageScan,
      state.scanProgress,
      state.isAutoSolving,
      state.isBatchParsing,
      state.isBatchFilling,
      state.autoSolveProgress,
      state.fillFeedback,
      state.tab,
      handleCancelFullPage,
      handleStopAutoSolve,
      setTab,
      setFillFeedback,
    ],
  );

  const handleToggleLanguage = useCallback(() => {
    const nextLang: UILang = state.uiLang === "zh" ? "en" : "zh";
    setUiLang(nextLang);
    void saveSettings({ language: nextLang });
  }, [state.uiLang, setUiLang]);

  const handleLogout = useCallback(async () => {
    session.applyLoggedOut();
    void logoutAccount();
  }, [session]);

  return (
    <div style={APP_SHELL_STYLE}>
      <style>{ORBIT_SCROLLBAR_CSS}</style>
      <SidePanelHeader
        authStatus={state.authStatus}
        isAuthenticated={state.isAuthenticated}
        lang={state.uiLang}
        onTabChange={setTab}
        tab={state.tab}
        userEmail={state.userEmail}
        workspaceStatus={workspaceStatus}
        providerName={providerName}
        onToggleLanguage={handleToggleLanguage}
        onLogout={handleLogout}
        onRetryValidation={() => session.retryValidation()}
      />

      <div className="orbit-panel-scroll" style={PANEL_BODY_STYLE}>
        {state.tab === "settings" ? (
          <WorkspaceTabPanel id="sidepanel-tabpanel-settings" tabId="settings">
            <SettingsTab
              lang={state.uiLang}
              onLanguageChange={setUiLang}
              authOnly={!state.isAuthenticated}
              sessionRejectedHint={state.sessionRejected}
            />
          </WorkspaceTabPanel>
        ) : !state.isAuthenticated ? (
          // Authority-first structure: while not server-validated, nothing
          // but the locked state may mount — History and Candidates are
          // unreachable in every non-authenticated status (validating,
          // server_unavailable, unauthenticated).
          <SidePanelLockedState
            authStatus={state.authStatus}
            lang={state.uiLang}
            onOpenSettings={() => setTab("settings")}
            onRetryValidation={() => session.retryValidation()}
          />
        ) : state.tab === "candidates" ? (
          <WorkspaceTabPanel id="sidepanel-tabpanel-candidates" tabId="candidates">
            {state.hydrationStatus !== "ready" ? (
              <OrbitSurface role="status">
                <p>{state.hydrationStatus === "runtime_unavailable" ? SIDEPANEL_COPY[state.uiLang].runtime.unavailable : SIDEPANEL_COPY[state.uiLang].runtime.syncing}</p>
                {state.hydrationStatus === "runtime_unavailable" ? <OrbitButton onClick={retryWorkspace}>{SIDEPANEL_COPY[state.uiLang].runtime.retry}</OrbitButton> : null}
              </OrbitSurface>
            ) : (
            <>
            <WorkspaceUserFeedback feedback={state.fillFeedback} activity={activity} />
            <CandidatesTab
              detectionPhase={state.detectionPhase}
              workspaceOrigin={state.workspaceOrigin}
              autoSolveProgress={state.autoSolveProgress}
              candidateViewFilter={state.candidateViewFilter}
              candidates={state.candidates}
              doneCount={doneCount}
              expandedIds={state.expandedIds}
              fillFeedback={state.fillFeedback}
              filteredCandidates={filteredCandidates}
              isAutoSolving={state.isAutoSolving}
              isBatchFilling={state.isBatchFilling}
              isBatchParsing={state.isBatchParsing}
              isDetecting={state.isDetecting}
              isFullPageScan={state.isFullPageScan}
              isRetryingRisky={state.isRetryingRisky}
              lang={state.uiLang}
              riskyCount={riskyCount}
              scanProgress={state.scanProgress}
              selectedCount={selectedCount}
              selectedSolvedCount={selectedSolvedCount}
              onBatchFill={handleBatchFill}
              onBatchParse={handleBatchParse}
              onCancelFullPage={handleCancelFullPage}
              onCandidateFilterChange={setCandidateViewFilter}
              onClearSelection={handleClearSelection}
              onDetect={handleDetect}
              onFillCandidate={handleFillCandidate}
              onFlashCandidate={handleFlash}
              onFullPageDetect={handleFullPageDetect}
              onRetryRisky={handleRetryRisky}
              onRetryVision={handleRetryVision}
              onSelectAll={handleSelectAll}
              onSelectRisky={handleSelectRisky}
              onStartAutoSolve={handleStartAutoSolve}
              onStopAutoSolve={handleStopAutoSolve}
              onToggleCandidate={toggleSelect}
              onToggleDetails={toggleDetails}
            />
            </>
            )}
          </WorkspaceTabPanel>
        ) : state.tab === "history" ? (
          <WorkspaceTabPanel id="sidepanel-tabpanel-history" tabId="history">
            <HistoryTab lang={state.uiLang} />
          </WorkspaceTabPanel>
        ) : null}
      </div>

      {activity ? (
        <SidePanelActivityStrip activity={activity} lang={state.uiLang} />
      ) : null}
    </div>
  );
};
