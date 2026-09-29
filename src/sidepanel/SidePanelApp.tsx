import React, { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { loadSettings } from "@/shared/utils/storage";
import { useAuthSession } from "@/shared/auth/useAuthSession";
import type { UILang } from "./displayUtils";
import { isRiskyCandidate } from "./batchParseHeuristics";
import { HistoryTab } from "./HistoryTab";
import { SettingsTab } from "./settingsPanel";
import { registerSidePanelRuntimeListeners } from "./sidepanelMessageBridge";
import { computeCandidateMetrics, type CandidateViewFilter } from "./sidepanelCandidateMetrics";
import { planAuthLossStop } from "./sidepanelAuthLoss";
import { CandidatesTab } from "./CandidatesTab";
import { getBestActionTab, sendTabMessageWithBootstrap } from "./tabActions";
import {
  APP_SHELL_STYLE,
  PANEL_BODY_STYLE,
  SidePanelHeader,
  SidePanelLockedState,
} from "./sidePanelShell";
import type { AutoSolveProgressState, ScanProgressState, SidePanelAppState } from "./sidepanelAppState";
import { initialSidePanelAppState, sidePanelAppReducer } from "./sidepanelAppState";
import { useSidePanelActions } from "./useSidePanelActions";

export { findNextFractionExpression, normalizeRenderableMathText, renderMathText } from "./displayUtils";

gsap.registerPlugin(useGSAP);

export const SidePanelApp: React.FC = () => {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const [state, dispatch] = useReducer(sidePanelAppReducer, initialSidePanelAppState);

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
    (updater: React.SetStateAction<string>) => dispatch({ type: "fillFeedback", updater }),
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

  // Latest committed state for non-render consumers (the auth-loss watchdog
  // runs from coordinator notifications, outside React's render cycle).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
      // AUTH-UI-INV-11: leaving `authenticated` must terminate protected
      // work already dispatched to the content script and reset the
      // transient protected-work flags, best-effort. The in-flight flags are
      // read from the latest committed state.
      if (wasAuthenticated === true && !nowAuthenticated) {
        const plan = planAuthLossStop(stateRef.current);
        void (async () => {
          try {
            if (!plan.stopAutoSolve && !plan.cancelFullPage) return;
            const activeTab = await getBestActionTab();
            if (!activeTab?.id) return;
            if (plan.stopAutoSolve) {
              await sendTabMessageWithBootstrap(activeTab.id, { type: "STOP_AUTO_SOLVE_ALL" });
            }
            if (plan.cancelFullPage) {
              await sendTabMessageWithBootstrap(activeTab.id, { type: "FULL_PAGE_DETECT_CANCELLED" });
            }
          } catch {
            // Best-effort termination; the flags are reset regardless.
          }
        })();
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
    loadSettings().then((settings) => {
      setUiLang((settings.language ?? "zh") as UILang);
    });

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== "local" || !changes.appSettings?.newValue) return;

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

  useGSAP(() => {
    gsap.from(".sp-header-copy", {
      y: 12,
      autoAlpha: 0,
      duration: 0.6,
      ease: "power2.out",
    });
    gsap.from(".sp-tab", {
      y: 8,
      autoAlpha: 0,
      duration: 0.42,
      stagger: 0.06,
      ease: "power2.out",
      delay: 0.08,
    });
    gsap.to(".sp-glow-a", {
      x: 18,
      y: -8,
      duration: 8,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
    });
    gsap.to(".sp-glow-b", {
      x: -8,
      y: 8,
      duration: 9,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
    });
  }, { scope: scopeRef });

  return (
    <div ref={scopeRef} style={APP_SHELL_STYLE}>
      <SidePanelHeader
        authStatus={state.authStatus}
        isAuthenticated={state.isAuthenticated}
        lang={state.uiLang}
        onTabChange={setTab}
        tab={state.tab}
        userEmail={state.userEmail}
      />

      <div style={PANEL_BODY_STYLE}>
        {state.tab === "settings" ? (
          <SettingsTab
            lang={state.uiLang}
            onLanguageChange={setUiLang}
            authOnly={!state.isAuthenticated}
            sessionRejectedHint={state.sessionRejected}
          />
        ) : !state.isAuthenticated ? (
          // Authority-first structure: while not server-validated, nothing
          // but the locked state may mount — History and Candidates are
          // unreachable in every non-authenticated status (validating,
          // server_unavailable, unauthenticated).
          <SidePanelLockedState
            authStatus={state.authStatus}
            lang={state.uiLang}
            onOpenSettings={() => setTab("settings")}
          />
        ) : state.tab === "candidates" ? (
          <CandidatesTab
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
        ) : state.tab === "history" ? (
          <HistoryTab lang={state.uiLang} />
        ) : null}
      </div>
    </div>
  );
};
