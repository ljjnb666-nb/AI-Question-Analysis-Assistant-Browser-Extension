import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { CandidateSnapshot, DetectedCandidate, ExtMessage, HistoryEntry, ParseResult, QuestionBlock, QuestionDisplaySegment, QuestionType } from "@/shared/types";
import { addHistoryEntry, clearHistory, exportHistory, loadSettings, saveSettings } from "@/shared/utils/storage";
import { getProvider, parseQuestion, PROVIDERS } from "@/shared/utils/parseRouter";
import type { ProviderId } from "@/shared/utils/parseRouter";

type HistoryItem = HistoryEntry;

type UILang = "zh" | "en";
type CandidateViewFilter = "all" | "risky" | "done";
const JUDGE_HEADER_RE = /\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)/g;

export const SidePanelApp: React.FC = () => {
  const [uiLang, setUiLang] = useState<UILang>("zh");
  const [tab, setTab] = useState<"candidates" | "history" | "settings">("candidates");
  const [candidates, setCandidates] = useState<DetectedCandidate[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isFullPageScan, setIsFullPageScan] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ progress: number; found: number; step: number; total: number } | null>(null);
  const [isBatchParsing, setIsBatchParsing] = useState(false);
  const [isBatchFilling, setIsBatchFilling] = useState(false);
  const [isRetryingRisky, setIsRetryingRisky] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [candidateViewFilter, setCandidateViewFilter] = useState<CandidateViewFilter>("all");
  const [fillFeedback, setFillFeedback] = useState<string>("");
  const [isAutoSolving, setIsAutoSolving] = useState(false);
  const [autoSolveProgress, setAutoSolveProgress] = useState<{
    solved: number;
    filled: number;
    total: number;
    current: number;
    statusText: string;
    currentPreview?: string;
  } | null>(null);

  useEffect(() => {
    loadSettings().then((s) => {
      setUiLang((s.language ?? "zh") as UILang);
    });

    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== "local" || !changes.appSettings?.newValue) return;
      const maybeLang = (changes.appSettings.newValue as { language?: UILang }).language;
      if (maybeLang === "zh" || maybeLang === "en") setUiLang(maybeLang);
    };

    const handler = (msg: Record<string, unknown>) => {
      if (msg.type === "AUTO_DETECT_RESULT_READY") {
        const snapshots = (msg.candidates as CandidateSnapshot[]) ?? [];
        setCandidates((prev) => {
          const prevById = new Map(prev.map((c) => [c.block.id, c] as const));
          return snapshots.map((snapshot) => {
            const old = prevById.get(snapshot.block.id);
            return {
              block: snapshot.block,
              selected: snapshot.selected,
              status: snapshot.status ?? old?.status ?? "idle",
              result: old?.result,
              error: old?.error,
              debugInfo: old?.debugInfo,
            };
          });
        });
        setIsDetecting(false);
      }
      if (msg.type === "FULL_PAGE_DETECT_PROGRESS") {
        setIsFullPageScan(true);
        setScanProgress({
          progress: (msg.progress as number) ?? 0,
          found: (msg.found as number) ?? 0,
          step: (msg.currentStep as number) ?? 0,
          total: (msg.totalScrollSteps as number) ?? 1,
        });
      }
      if (msg.type === "FULL_PAGE_DETECT_DONE") {
        setIsFullPageScan(false);
        setScanProgress(null);
        const blocks = (msg.candidates as QuestionBlock[]) ?? [];
        setCandidates(blocks.map((b) => ({ block: b, selected: false, status: "idle" as const })));
        setExpandedIds({});
      }
      if (msg.type === "AUTO_SOLVE_PROGRESS") {
        setIsAutoSolving(Boolean(msg.running));
        setAutoSolveProgress({
          solved: Number(msg.solved ?? 0),
          filled: Number(msg.filled ?? 0),
          total: Number(msg.total ?? 0),
          current: Number(msg.current ?? 0),
          statusText: String(msg.statusText ?? ""),
          currentPreview: typeof msg.currentPreview === "string" ? msg.currentPreview : "",
        });
      }
      if (msg.type === "AUTO_SOLVE_DONE") {
        setIsAutoSolving(false);
        setAutoSolveProgress(null);
        setFillFeedback(String(msg.message || (msg.ok ? "自动答题完成" : "自动答题失败")));
        window.setTimeout(() => setFillFeedback(""), 3200);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      chrome.runtime.onMessage.removeListener(handler);
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const handleDetect = async () => {
    setIsDetecting(true);
    setIsFullPageScan(false);
    setScanProgress(null);
    setCandidates([]);
    setExpandedIds({});
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) await sendTabMessageWithBootstrap(activeTab.id, { type: "START_AUTO_DETECT" });
  };

  const handleFullPageDetect = async () => {
    setIsDetecting(false);
    setCandidates([]);
    setExpandedIds({});
    setScanProgress({ progress: 0, found: 0, step: 0, total: 1 });
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) await sendTabMessageWithBootstrap(activeTab.id, { type: "START_FULL_PAGE_DETECT" });
  };

  const handleCancelFullPage = async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) await sendTabMessageWithBootstrap(activeTab.id, { type: "FULL_PAGE_DETECT_CANCELLED" });
    setIsFullPageScan(false);
    setScanProgress(null);
  };

  const syncSelection = async (payload: { blockId?: string; selected?: boolean; selectAll?: boolean }) => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) await sendTabMessageWithBootstrap(activeTab.id, { type: "UPDATE_CANDIDATE_SELECTION", ...payload });
  };

  const toggleSelect = (id: string) =>
    setCandidates((prev) => {
      const next = prev.map((c) => (c.block.id === id ? { ...c, selected: !c.selected } : c));
      const target = next.find((c) => c.block.id === id);
      void syncSelection({ blockId: id, selected: !!target?.selected });
      return next;
    });

  const handleFlash = async (blockId: string) => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) await sendTabMessageWithBootstrap(activeTab.id, { type: "HIGHLIGHT_CANDIDATE", blockId });
  };

  const toggleDetails = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleBatchParse = useCallback(async () => {
    const selected = candidates.filter((c) => c.selected);
    if (!selected.length) return;
    setIsBatchParsing(true);
    const settings = await loadSettings();
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let sourceHost = "";
    try {
      sourceHost = activeTab?.url ? new URL(activeTab.url).hostname : "";
    } catch {
      sourceHost = "";
    }

    for (const cand of selected) {
      setCandidates((prev) => prev.map((c) => (c.block.id === cand.block.id ? { ...c, status: "loading" as const } : c)));
      try {
        const looksMath = looksMathHeavy(cand.block.previewText || "");
        const provider = getProvider(settings.providerId ?? "anthropic");
        const firstPassSettings = (looksMath || provider.supportsVision)
          ? { ...settings, preferredRoute: "vision" as const }
          : settings;
        let firstPassBlock: QuestionBlock = cand.block;
        let imageAttached = false;
        if (activeTab?.id) {
          const firstPassImage = await requestBlockImage(activeTab.id, cand.block.bbox);
          if (firstPassImage) {
            firstPassBlock = { ...cand.block, hasImage: true, imageDataUrl: firstPassImage };
            imageAttached = true;
          }
        }
        if (provider.supportsVision && cand.block.hasImage && !firstPassBlock.imageDataUrl) {
          throw new Error(langSafe(settings.language, "图片题截图失败，请重试或滚动后重试", "Image capture failed for image question. Please retry."));
        }

        let historyBlock: QuestionBlock = firstPassBlock;
        let result: ParseResult = await parseQuestion(firstPassBlock, firstPassSettings);
        const needVisionRetry =
          provider.supportsVision &&
          shouldRetryWithVision(result) &&
          !!activeTab?.id;

        if (needVisionRetry) {
          const imageDataUrl = await requestBlockImage(activeTab!.id!, cand.block.bbox);
          if (imageDataUrl) {
            const visionBlock: QuestionBlock = { ...cand.block, hasImage: true, imageDataUrl };
            const visionSettings = { ...settings, preferredRoute: "vision" as const };
            const visionResult = await parseQuestion(visionBlock, visionSettings);
            if (preferVisionResult(result, visionResult)) {
              result = visionResult;
              historyBlock = visionBlock;
              imageAttached = true;
            }
          }
        }

        setCandidates((prev) =>
          prev.map((c) =>
            c.block.id === cand.block.id
              ? { ...c, status: "success" as const, result, debugInfo: { imageAttached, routeUsed: result.routeUsed } }
              : c,
          ),
        );
        await addHistoryEntry({ id: cand.block.id, timestamp: Date.now(), block: historyBlock, result, host: sourceHost });
      } catch (err) {
        setCandidates((prev) => prev.map((c) => (c.block.id === cand.block.id ? { ...c, status: "error" as const, error: String(err) } : c)));
      }
    }
    setIsBatchParsing(false);
  }, [candidates]);

  const handleRetryVision = useCallback(async (cand: DetectedCandidate) => {
    const settings = await loadSettings();
    const provider = getProvider(settings.providerId ?? "anthropic");
    if (!provider.supportsVision) return;
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) return;

    setCandidates((prev) => prev.map((c) => (c.block.id === cand.block.id ? { ...c, status: "loading" as const } : c)));
    try {
      const imageDataUrl = await requestBlockImage(activeTab.id, cand.block.bbox);
      if (!imageDataUrl) throw new Error("截图失败");
      const visionBlock: QuestionBlock = { ...cand.block, hasImage: true, imageDataUrl };
      const visionResult = await parseQuestion(visionBlock, { ...settings, preferredRoute: "vision" as const });
      setCandidates((prev) =>
        prev.map((c) =>
          c.block.id === cand.block.id
            ? { ...c, status: "success" as const, result: visionResult, debugInfo: { imageAttached: true, routeUsed: visionResult.routeUsed } }
            : c,
        ),
      );
      await addHistoryEntry({ id: cand.block.id, timestamp: Date.now(), block: visionBlock, result: visionResult, host: location.hostname });
    } catch (err) {
      setCandidates((prev) => prev.map((c) => (c.block.id === cand.block.id ? { ...c, status: "error" as const, error: String(err) } : c)));
    }
  }, []);

  const handleSelectRisky = useCallback(() => {
    setCandidates((prev) => {
      const next = prev.map((cand) => ({ ...cand, selected: isRiskyCandidate(cand) }));
      const riskyIds = new Set(next.filter((cand) => cand.selected).map((cand) => cand.block.id));
      for (const cand of next) {
        void syncSelection({ blockId: cand.block.id, selected: riskyIds.has(cand.block.id) });
      }
      return next;
    });
  }, []);

  const handleRetryRisky = useCallback(async () => {
    const settings = await loadSettings();
    const provider = getProvider(settings.providerId ?? "anthropic");
    if (!provider.supportsVision) return;
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) return;

    const riskyCandidates = candidates.filter(isRiskyCandidate);
    if (!riskyCandidates.length) return;

    setIsRetryingRisky(true);
    for (const cand of riskyCandidates) {
      setCandidates((prev) => prev.map((c) => (c.block.id === cand.block.id ? { ...c, status: "loading" as const } : c)));
      try {
        const imageDataUrl = await requestBlockImage(activeTab.id, cand.block.bbox);
        if (!imageDataUrl) throw new Error(langSafe(settings.language, "截图失败", "Image capture failed"));
        const visionBlock: QuestionBlock = { ...cand.block, hasImage: true, imageDataUrl };
        const visionResult = await parseQuestion(visionBlock, { ...settings, preferredRoute: "vision" as const });
        setCandidates((prev) =>
          prev.map((c) =>
            c.block.id === cand.block.id
              ? { ...c, status: "success" as const, result: visionResult, error: undefined, debugInfo: { imageAttached: true, routeUsed: visionResult.routeUsed } }
              : c,
          ),
        );
        await addHistoryEntry({ id: cand.block.id, timestamp: Date.now(), block: visionBlock, result: visionResult, host: location.hostname });
      } catch (err) {
        setCandidates((prev) =>
          prev.map((c) => (c.block.id === cand.block.id ? { ...c, status: "error" as const, error: String(err) } : c)),
        );
      }
    }
    setIsRetryingRisky(false);
  }, [candidates]);

  const handleFillCandidate = useCallback(async (cand: DetectedCandidate) => {
    if (!cand.result) return;
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) return;

    const resp = await sendFillMessage(activeTab.id, cand.block, cand.result);
    setFillFeedback(resp?.message || (resp?.ok ? "填写完成" : "填写失败"));
    window.setTimeout(() => setFillFeedback(""), 2200);
  }, []);

  const handleBatchFill = useCallback(async () => {
    const targets = candidates.filter((cand) => cand.selected && cand.status === "success" && cand.result);
    if (!targets.length) return;

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) return;

    setIsBatchFilling(true);
    let totalFilled = 0;
    for (const cand of targets) {
      const resp = await sendFillMessage(activeTab.id, cand.block, cand.result!);
      totalFilled += resp?.filledCount ?? 0;
    }
    setIsBatchFilling(false);
    setFillFeedback(
      uiLang === "en"
        ? `Filled ${totalFilled} fields across ${targets.length} question(s)`
        : `已在 ${targets.length} 题中填写 ${totalFilled} 个控件`,
    );
    window.setTimeout(() => setFillFeedback(""), 2600);
  }, [candidates, uiLang]);

  const handleStartAutoSolve = useCallback(async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) return;
    setFillFeedback("");
    setIsAutoSolving(true);
    setAutoSolveProgress({
      solved: 0,
      filled: 0,
      total: 0,
      current: 0,
      statusText: uiLang === "en" ? "Starting auto solve..." : "开始自动答题...",
    });
    await sendTabMessageWithBootstrap(activeTab.id, { type: "START_AUTO_SOLVE_ALL" });
  }, [uiLang]);

  const handleStopAutoSolve = useCallback(async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) return;
    await sendTabMessageWithBootstrap(activeTab.id, { type: "STOP_AUTO_SOLVE_ALL" });
  }, []);

  const selectedCount = candidates.filter((c) => c.selected).length;
  const selectedSolvedCount = candidates.filter((c) => c.selected && c.status === "success" && c.result).length;
  const riskyCount = candidates.filter(isRiskyCandidate).length;
  const doneCount = candidates.filter((cand) => cand.status === "success").length;
  const filteredCandidates = candidates.filter((cand) => {
    if (candidateViewFilter === "risky") return isRiskyCandidate(cand);
    if (candidateViewFilter === "done") return cand.status === "success";
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <div style={{ display: "flex", flexShrink: 0, backgroundColor: "#181825", borderBottom: "1px solid #313244" }}>
        {[
          { id: "candidates" as const, label: uiLang === "en" ? "Candidates" : "候选题" },
          { id: "history" as const, label: uiLang === "en" ? "History" : "历史" },
          { id: "settings" as const, label: uiLang === "en" ? "Settings" : "设置" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              padding: "11px 4px",
              border: "none",
              cursor: "pointer",
              backgroundColor: tab === t.id ? "#1e1e2e" : "transparent",
              color: tab === t.id ? "#cba6f7" : "#6c7086",
              fontSize: 12,
              fontWeight: tab === t.id ? 700 : 400,
              borderBottom: `2px solid ${tab === t.id ? "#cba6f7" : "transparent"}`,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "candidates" && (
          <div style={{ padding: 12 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
              <Btn primary onClick={handleDetect} disabled={isDetecting || isFullPageScan}>
                {isDetecting ? (uiLang === "en" ? "Detecting..." : "识别中...") : (uiLang === "en" ? "Current View" : "当前屏")}
              </Btn>
              <Btn primary={isFullPageScan} onClick={isFullPageScan ? handleCancelFullPage : handleFullPageDetect} disabled={isDetecting}>
                {isFullPageScan ? (uiLang === "en" ? "Stop Scan" : "停止扫描") : (uiLang === "en" ? "Full Page Scan" : "整页扫描")}
              </Btn>
              <Btn
                primary={isAutoSolving}
                onClick={isAutoSolving ? handleStopAutoSolve : handleStartAutoSolve}
                disabled={isDetecting || isFullPageScan || isBatchParsing || isBatchFilling}
              >
                {isAutoSolving
                  ? (uiLang === "en" ? "Stop Auto Solve" : "停止自动答题")
                  : (uiLang === "en" ? "Auto Solve All" : "自动答题")}
              </Btn>
              {candidates.length > 0 && !isFullPageScan && (
                <>
                  <Btn
                    onClick={() => {
                      setCandidates((p) => p.map((c) => ({ ...c, selected: true })));
                      void syncSelection({ selectAll: true });
                    }}
                  >
                    {uiLang === "en" ? "Select All" : "全选"}
                  </Btn>
                  <Btn
                    onClick={() => {
                      setCandidates((p) => p.map((c) => ({ ...c, selected: false })));
                      void syncSelection({ selectAll: false });
                    }}
                  >
                    {uiLang === "en" ? "Clear" : "清空"}
                  </Btn>
                  <Btn onClick={handleSelectRisky} disabled={!riskyCount}>
                    {uiLang === "en" ? `Select Risky ${riskyCount}` : `选中风险题 ${riskyCount}`}
                  </Btn>
                  <Btn onClick={handleRetryRisky} disabled={!riskyCount || isRetryingRisky || isBatchParsing}>
                    {isRetryingRisky
                      ? (uiLang === "en" ? "Reviewing..." : "复核中...")
                      : (uiLang === "en" ? `Review Risky ${riskyCount}` : `复核风险题 ${riskyCount}`)}
                  </Btn>
                  <Btn primary onClick={handleBatchParse} disabled={!selectedCount || isBatchParsing}>
                    {isBatchParsing
                      ? (uiLang === "en" ? "Parsing..." : "解析中...")
                      : (uiLang === "en" ? `Solve ${selectedCount}` : `解析 ${selectedCount} 题`)}
                  </Btn>
                  <Btn primary onClick={handleBatchFill} disabled={!selectedSolvedCount || isBatchFilling || isBatchParsing}>
                    {isBatchFilling
                      ? (uiLang === "en" ? "Filling..." : "填写中...")
                      : (uiLang === "en" ? `Fill ${selectedSolvedCount}` : `填写 ${selectedSolvedCount} 题`)}
                  </Btn>
                </>
              )}
            </div>

            {fillFeedback && (
              <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 8, backgroundColor: "#1c2a3a", border: "1px solid #4f9cf9", fontSize: 12, color: "#cfe7ff" }}>
                {fillFeedback}
              </div>
            )}

            {autoSolveProgress && (
              <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 8, backgroundColor: "#1f2d1f", border: "1px solid #5ab56b" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                  <span style={{ color: "#8fe39a", fontWeight: 700 }}>
                    {uiLang === "en" ? "Auto Solving" : "自动答题中"}
                  </span>
                  <span style={{ color: "#9bc7a3" }}>
                    {uiLang === "en"
                      ? `Solved ${autoSolveProgress.solved}${autoSolveProgress.total ? ` / ${autoSolveProgress.total}` : ""}, filled ${autoSolveProgress.filled}`
                      : `已解析 ${autoSolveProgress.solved}${autoSolveProgress.total ? ` / ${autoSolveProgress.total}` : ""}，已填写 ${autoSolveProgress.filled}`}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#d5f5da", lineHeight: 1.5 }}>
                  {autoSolveProgress.statusText}
                </div>
                {autoSolveProgress.currentPreview && (
                  <AutoSolvePreviewCard previewText={autoSolveProgress.currentPreview} lang={uiLang} />
                )}
              </div>
            )}

            {scanProgress && (
              <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 8, backgroundColor: "#1c2a3a", border: "1px solid #4f9cf9" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                  <span style={{ color: "#89b4fa", fontWeight: 600 }}>{uiLang === "en" ? "Scanning full page" : "整页扫描中"}</span>
                  <span style={{ color: "#6c7086" }}>
                    {uiLang === "en"
                      ? `Step ${scanProgress.step}/${scanProgress.total}, found ${scanProgress.found}`
                      : `第 ${scanProgress.step}/${scanProgress.total} 步，已发现 ${scanProgress.found} 题`}
                  </span>
                </div>
                <div style={{ height: 5, backgroundColor: "#313244", borderRadius: 3, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${scanProgress.progress}%`,
                      backgroundColor: "#4f9cf9",
                      borderRadius: 3,
                      transition: "width 0.25s",
                    }}
                  />
                </div>
                <div style={{ marginTop: 4, fontSize: 10, color: "#585b70", textAlign: "right" }}>{scanProgress.progress}%</div>
              </div>
            )}

            {candidates.length > 0 && !isFullPageScan && (
              <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                {([
                  ["all", uiLang === "en" ? `All ${candidates.length}` : `全部 ${candidates.length}`],
                  ["risky", uiLang === "en" ? `Risky ${riskyCount}` : `风险 ${riskyCount}`],
                  ["done", uiLang === "en" ? `Done ${doneCount}` : `完成 ${doneCount}`],
                ] as const).map(([filterId, label]) => (
                  <button
                    key={filterId}
                    onClick={() => setCandidateViewFilter(filterId)}
                    style={{
                      border: `1px solid ${candidateViewFilter === filterId ? "#4f9cf9" : "#313244"}`,
                      backgroundColor: candidateViewFilter === filterId ? "#1c2a3a" : "transparent",
                      color: candidateViewFilter === filterId ? "#89b4fa" : "#6c7086",
                      borderRadius: 999,
                      fontSize: 11,
                      padding: "4px 10px",
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {candidates.length === 0 && !isDetecting && !isFullPageScan && !scanProgress && (
                <div style={{ textAlign: "center", padding: "28px 0", color: "#6c7086", fontSize: 13 }}>
                {uiLang === "en"
                  ? "Click 'Current View' or 'Full Page Scan' to detect questions"
                  : "点击“当前屏”或“整页扫描”开始识别题目"}
              </div>
            )}

            {filteredCandidates.map((cand, i) => (
              <CandidateCard
                key={cand.block.id}
                index={i + 1}
                cand={cand}
                isExpanded={!!expandedIds[cand.block.id]}
                onToggle={() => toggleSelect(cand.block.id)}
                onFlash={() => handleFlash(cand.block.id)}
                onToggleDetails={() => toggleDetails(cand.block.id)}
                onFill={() => handleFillCandidate(cand)}
                onRetryVision={() => handleRetryVision(cand)}
                lang={uiLang}
              />
            ))}
          </div>
        )}

        {tab === "history" && <HistoryTab lang={uiLang} />}
        {tab === "settings" && <SettingsTab lang={uiLang} onLanguageChange={setUiLang} />}
      </div>
    </div>
  );
};

const STATUS_COLORS: Record<string, string> = {
  idle: "#45475a",
  loading: "#f9e2af",
  success: "#a6e3a1",
  error: "#f38ba8",
};

const STATUS_LABELS: Record<string, string> = {
  idle: "待解析",
  loading: "解析中...",
  success: "完成",
  error: "失败",
};
const STATUS_LABELS_EN: Record<string, string> = {
  idle: "Pending",
  loading: "Parsing...",
  success: "Done",
  error: "Failed",
};

const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选",
  multi_choice: "多选",
  judge: "判断",
  fill_blank: "填空",
  short_answer: "简答",
  unknown: "未知",
};
const TYPE_LABELS_EN: Record<string, string> = {
  single_choice: "Single",
  multi_choice: "Multi",
  judge: "Judge",
  fill_blank: "Blank",
  short_answer: "Short",
  unknown: "Unknown",
};

const CandidateCard: React.FC<{
  index: number;
  cand: DetectedCandidate;
  isExpanded: boolean;
  onToggle: () => void;
  onFlash: () => void;
  onToggleDetails: () => void;
  onFill: () => void;
  onRetryVision: () => void;
  lang: UILang;
}> = ({ index, cand, isExpanded, onToggle, onFlash, onToggleDetails, onFill, onRetryVision, lang }) => {
  const rawPreviewText = cand.block.previewText || "";
  const normalizedPreviewText = cleanCandidatePreviewText(rawPreviewText);
  const { stem, options } = splitStemAndOptions(normalizedPreviewText);
  const blankView = splitStemAndBlanks(normalizedPreviewText);
  const judgeView = splitJudgeStemAndOptions(normalizedPreviewText);
  const displaySegments = buildDisplaySegmentsForCandidate(cand.block, stem || normalizedPreviewText, rawPreviewText, lang);
  const displayStem = formatQuestionTextForDisplay(
    buildCandidateStemForDisplay(cand.block, stem || normalizedPreviewText, rawPreviewText, lang),
  );
  const fillBlankStem = formatQuestionTextForDisplay(ensureBlankPlaceholders(blankView.stem || normalizedPreviewText, blankView.blanks.length));
  const judgeStem = formatQuestionTextForDisplay(judgeView.stem || normalizedPreviewText);
  const answerSummary = formatQuestionTextForDisplay(cand.result?.briefExplanation || "");
  const displayImageUrl = displaySegments.some((segment) => segment.type === "image") ? "" : getDisplayQuestionImageFromBlock(cand.block);

  return (
    <div
      onClick={onToggle}
      style={{
        border: `1px solid ${cand.selected ? "#4f9cf9" : "#313244"}`,
        borderRadius: 8,
        padding: "10px 12px",
        marginBottom: 8,
        backgroundColor: cand.selected ? "#1c2a3a" : "#181825",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: 3,
            flexShrink: 0,
            marginTop: 2,
            border: `2px solid ${cand.selected ? "#4f9cf9" : "#45475a"}`,
            backgroundColor: cand.selected ? "#4f9cf9" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {cand.selected && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            <span style={{ color: "#6c7086", fontSize: 11 }}>#{index}</span>
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, backgroundColor: "#313244", color: "#89b4fa" }}>
              {(lang === "en" ? TYPE_LABELS_EN : TYPE_LABELS)[cand.block.questionTypeGuess] ?? "?"}
            </span>
            {isRiskyCandidate(cand) && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, backgroundColor: "#36241c", color: "#f9c58f" }}>
                {lang === "en" ? "Needs review" : "建议复核"}
              </span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 10, color: STATUS_COLORS[cand.status] ?? "#45475a" }}>
              {(lang === "en" ? STATUS_LABELS_EN : STATUS_LABELS)[cand.status] ?? cand.status}
            </span>
          </div>

          <div
            style={{
              fontSize: 12,
              color: "#dce0ff",
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {displaySegments.length > 0
              ? <DisplaySegmentsView segments={displaySegments} lang={lang} />
              : renderMathText(
                (cand.block.questionTypeGuess === "fill_blank"
                  ? fillBlankStem
                  : cand.block.questionTypeGuess === "judge"
                    ? judgeStem
                    : displayStem) || (lang === "en" ? "(No preview text)" : "(无预览文本)"),
              )}
          </div>

          {displayImageUrl && (
            <div style={{ marginTop: 8 }}>
              <img
                src={displayImageUrl}
                alt={lang === "en" ? "Question figure" : "题目配图"}
                style={{
                  width: "100%",
                  maxHeight: 220,
                  objectFit: "contain",
                  borderRadius: 8,
                  border: "1px solid #313244",
                  backgroundColor: "#11111b",
                }}
              />
            </div>
          )}

          {cand.block.questionTypeGuess === "judge" && judgeView.options.length > 0 && (
            <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
              {judgeView.options.map((option) => (
                <div
                  key={option.key}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "#bac2de",
                    padding: "4px 8px",
                    borderRadius: 6,
                    backgroundColor: "#11111b",
                    border: "1px solid #313244",
                  }}
                >
                  <span style={{ color: "#f9c58f", fontWeight: 700, width: 18, flexShrink: 0 }}>{option.key}</span>
                  {option.value ? (
                    <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderMathText(option.value)}</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {cand.block.questionTypeGuess === "fill_blank" && blankView.blanks.length > 0 && (
            <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
              {blankView.blanks.map((blank, idx) => (
                <div
                  key={`${blank.label}-${idx}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "#bac2de",
                    padding: "4px 8px",
                    borderRadius: 6,
                    backgroundColor: "#11111b",
                    border: "1px solid #313244",
                  }}
                >
                  <span style={{ color: "#cba6f7", fontWeight: 700, minWidth: 32, flexShrink: 0 }}>{blank.label}</span>
                  <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderMathText(blank.hint || (lang === "en" ? "Blank" : "填空"))}</span>
                </div>
              ))}
            </div>
          )}

          {options.length > 0 && (
            <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
              {options.map((option) => (
                <div
                  key={option.key}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "#bac2de",
                    padding: "4px 8px",
                    borderRadius: 6,
                    backgroundColor: "#11111b",
                    border: "1px solid #313244",
                  }}
                >
                  <span style={{ color: "#89b4fa", fontWeight: 700, width: 18, flexShrink: 0 }}>{option.key}</span>
                  <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderMathText(formatQuestionTextForDisplay(option.value))}</span>
                </div>
              ))}
            </div>
          )}

          {(cand.debugInfo?.routeUsed || cand.debugInfo?.imageAttached !== undefined) && (
            <div style={{ marginTop: 6, fontSize: 10, color: "#6c7086" }}>
              {lang === "en" ? "Route" : "路由"}: {cand.debugInfo?.routeUsed ?? "-"} |{" "}
              {lang === "en" ? "Image attached" : "已附图"}: {cand.debugInfo?.imageAttached ? (lang === "en" ? "Yes" : "是") : (lang === "en" ? "No" : "否")}
            </div>
          )}

          {cand.status === "success" && cand.result && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                borderRadius: 6,
                backgroundColor: "#1e3a2e",
                border: "1px solid #2d5a3d",
                fontSize: 12,
                color: "#a6e3a1",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              <strong>{lang === "en" ? "Answer" : "答案"}: {renderMathText(cand.result.answer)}</strong>
              <div style={{ marginTop: 4, color: "#cfecc8" }}>
                {lang === "en" ? "Confidence" : "置信度"} {Math.round((cand.result.confidence ?? 0) * 100)}%
                {answerSummary ? <> · {renderMathText(answerSummary)}</> : ""}
              </div>
              <div style={{ marginTop: 6 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onFill();
                  }}
                  style={{
                    border: "1px solid #5bc28c",
                    background: "#173524",
                    color: "#b8f0cc",
                    borderRadius: 6,
                    fontSize: 11,
                    padding: "3px 8px",
                    cursor: "pointer",
                  }}
                >
                  {lang === "en" ? "Fill answer" : "填写答案"}
                </button>
              </div>
            </div>
          )}

          {cand.status === "success" && cand.result && (
            <div style={{ marginTop: 6 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleDetails();
                }}
                style={{
                  border: "1px solid #45475a",
                  background: "transparent",
                  color: "#89b4fa",
                  borderRadius: 6,
                  fontSize: 11,
                  padding: "2px 8px",
                  cursor: "pointer",
                }}
              >
                {isExpanded ? (lang === "en" ? "Hide details" : "收起详情") : (lang === "en" ? "View details" : "查看详情")}
              </button>
              {isExpanded && (
                <div
                  style={{
                    marginTop: 6,
                    padding: "8px",
                    borderRadius: 6,
                    border: "1px solid #313244",
                    backgroundColor: "#11111b",
                    color: "#cdd6f4",
                    fontSize: 12,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {renderMathText(cand.result.detailedExplanation || cand.result.briefExplanation)}
                </div>
              )}
              {shouldRetryWithVision(cand.result as ParseResult) && (
                <div style={{ marginTop: 6 }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetryVision();
                    }}
                    style={{
                      border: "1px solid #7c5cff",
                      background: "#2b1f52",
                      color: "#d9ccff",
                      borderRadius: 6,
                      fontSize: 11,
                      padding: "2px 8px",
                      cursor: "pointer",
                    }}
                  >
                    {lang === "en" ? "Retry with Vision" : "视觉重试"}
                  </button>
                </div>
              )}
            </div>
          )}

          {cand.status === "error" && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: "#f38ba8", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderMathText(cand.error?.slice(0, 160) || "")}</div>
              <div style={{ marginTop: 6 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetryVision();
                  }}
                  style={{
                    border: "1px solid #7c5cff",
                    background: "#2b1f52",
                    color: "#d9ccff",
                    borderRadius: 6,
                    fontSize: 11,
                    padding: "2px 8px",
                    cursor: "pointer",
                  }}
                >
                  {lang === "en" ? "Retry with Vision" : "视觉重试"}
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onFlash();
          }}
          style={{ background: "none", border: "none", color: "#6c7086", cursor: "pointer", fontSize: 12, padding: "2px", flexShrink: 0 }}
          title={lang === "en" ? "Locate on page" : "在页面中定位"}
        >
          {lang === "en" ? "Locate" : "定位"}
        </button>
      </div>
    </div>
  );
};

const DisplaySegmentsView: React.FC<{ segments: QuestionDisplaySegment[]; lang: UILang }> = ({ segments, lang }) => (
  <div style={{ display: "grid", gap: 8 }}>
    {segments.map((segment, idx) => (
      segment.type === "image" ? (
        <img
          key={`${segment.type}-${idx}`}
          src={segment.url}
          alt={lang === "en" ? "Question figure" : "题目配图"}
          style={{
            width: "100%",
            maxHeight: 220,
            objectFit: "contain",
            borderRadius: 8,
            border: "1px solid #313244",
            backgroundColor: "#11111b",
          }}
        />
      ) : (
        <div key={`${segment.type}-${idx}`}>{renderMathText(formatQuestionTextForDisplay(segment.text))}</div>
      )
    ))}
  </div>
);

const AutoSolvePreviewCard: React.FC<{ previewText: string; lang: UILang }> = ({ previewText, lang }) => {
  const normalizedPreviewText = cleanCandidatePreviewText(previewText);
  const { stem, options } = splitStemAndOptions(normalizedPreviewText);
  const blankView = splitStemAndBlanks(normalizedPreviewText);
  const judgeView = splitJudgeStemAndOptions(normalizedPreviewText);
  const inferredType = inferPreviewQuestionType(normalizedPreviewText, options.length, blankView.blanks.length, judgeView.options.length);

  const displayStem = formatQuestionTextForDisplay(stem || normalizedPreviewText);
  const fillBlankStem = formatQuestionTextForDisplay(ensureBlankPlaceholders(blankView.stem || normalizedPreviewText, blankView.blanks.length));
  const judgeStem = formatQuestionTextForDisplay(judgeView.stem || normalizedPreviewText);

  return (
    <div
      style={{
        marginTop: 8,
        padding: "8px 9px",
        borderRadius: 6,
        backgroundColor: "#162116",
        border: "1px solid #355c39",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, backgroundColor: "#223622", color: "#8fe39a" }}>
          {(lang === "en" ? TYPE_LABELS_EN : TYPE_LABELS)[inferredType] ?? (lang === "en" ? "Question" : "题目")}
        </span>
      </div>

      <div style={{ fontSize: 11, color: "#d5f5da", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {renderMathText(
          (inferredType === "fill_blank"
            ? fillBlankStem
            : inferredType === "judge"
              ? judgeStem
              : displayStem) || (lang === "en" ? "(No preview text)" : "(无预览文本)"),
        )}
      </div>

      {inferredType === "judge" && judgeView.options.length > 0 && (
        <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
          {judgeView.options.map((option) => (
            <div
              key={option.key}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                fontSize: 11,
                lineHeight: 1.5,
                color: "#cbe9ce",
                padding: "4px 8px",
                borderRadius: 6,
                backgroundColor: "#111a11",
                border: "1px solid #2a442e",
              }}
            >
              <span style={{ color: "#f9c58f", fontWeight: 700, width: 18, flexShrink: 0 }}>{option.key}</span>
              {option.value ? <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderMathText(option.value)}</span> : null}
            </div>
          ))}
        </div>
      )}

      {inferredType === "fill_blank" && blankView.blanks.length > 0 && (
        <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
          {blankView.blanks.map((blank, idx) => (
            <div
              key={`${blank.label}-${idx}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                fontSize: 11,
                lineHeight: 1.5,
                color: "#cbe9ce",
                padding: "4px 8px",
                borderRadius: 6,
                backgroundColor: "#111a11",
                border: "1px solid #2a442e",
              }}
            >
              <span style={{ color: "#cba6f7", fontWeight: 700, minWidth: 32, flexShrink: 0 }}>{blank.label}</span>
              <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderMathText(blank.hint || (lang === "en" ? "Blank" : "填空"))}</span>
            </div>
          ))}
        </div>
      )}

      {options.length > 0 && (
        <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
          {options.map((option) => (
            <div
              key={option.key}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                fontSize: 11,
                lineHeight: 1.5,
                color: "#cbe9ce",
                padding: "4px 8px",
                borderRadius: 6,
                backgroundColor: "#111a11",
                border: "1px solid #2a442e",
              }}
            >
              <span style={{ color: "#89b4fa", fontWeight: 700, width: 18, flexShrink: 0 }}>{option.key}</span>
              <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderMathText(formatQuestionTextForDisplay(option.value))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const HistoryTab: React.FC<{ lang: UILang }> = ({ lang }) => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const reload = () => {
      chrome.storage.local.get("parseHistory").then((r) => {
        setHistory((r.parseHistory as HistoryItem[]) ?? []);
      });
    };

    reload();

    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === "local" && changes.parseHistory) reload();
    };

    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const handleClear = async () => {
    await clearHistory();
    setHistory([]);
    setExpandedIds({});
  };

  const handleExport = async () => {
    const json = await exportHistory();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quiz-history-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!history.length) {
    return <div style={{ textAlign: "center", padding: "32px 16px", color: "#6c7086" }}>{lang === "en" ? "No history yet" : "暂无解析历史"}</div>;
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 8 }}>
        <Btn onClick={handleExport}>{lang === "en" ? "Export JSON" : "导出 JSON"}</Btn>
        <Btn onClick={handleClear}>{lang === "en" ? "Clear History" : "清空历史"}</Btn>
      </div>

      {history.map((entry) => {
        const dtype = getDisplayType(entry);
        const rawSourceText = entry.result.recognizedText || entry.block.previewText || "";
        const sourceText = normalizeText(rawSourceText);
        const prettySourceText = formatQuestionTextForDisplay(rawSourceText);
        const { stem, options } = splitStemAndOptions(sourceText);
        const blankView = splitStemAndBlanks(sourceText);
        const judgeView = splitJudgeStemAndOptions(sourceText);
        const fillBlankStem = formatQuestionTextForDisplay(ensureBlankPlaceholders(blankView.stem || sourceText, blankView.blanks.length));
        const prettyImageUrl = getDisplayQuestionImage(entry);
        const showDetails = !!expandedIds[entry.id];

        return (
          <div
            key={entry.id}
            style={{
              border: "1px solid #313244",
              borderRadius: 12,
              padding: "12px 12px 10px",
              marginBottom: 12,
              backgroundColor: "#181825",
              boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: "#8b8ea3" }}>{new Date(entry.timestamp).toLocaleString(lang === "en" ? "en-US" : "zh-CN")}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TypeBadge type={dtype} lang={lang} />
                <div style={{ fontSize: 12, color: "#a6e3a1", fontWeight: 700 }}>{lang === "en" ? "Answer" : "答案"}: {normalizeHistoryAnswer(entry, dtype)}</div>
              </div>
            </div>

            {prettyImageUrl && (
              <div style={{ marginBottom: 8 }}>
                <img
                  src={prettyImageUrl}
                  alt={lang === "en" ? "Question figure" : "题目配图"}
                  style={{
                    width: "100%",
                    maxHeight: 220,
                    objectFit: "contain",
                    borderRadius: 8,
                    border: "1px solid #313244",
                    backgroundColor: "#11111b",
                  }}
                />
              </div>
            )}

            {(dtype === "single_choice" || dtype === "multi_choice") && (
              <>
                <div style={historyStemStyle}>{renderMathText(formatQuestionTextForDisplay(stem || sourceText) || (lang === "en" ? "(No stem)" : "(无题干)"))}</div>
                <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                  {options.length > 0
                    ? options.map((op) => (
                        <div key={op.key} style={historyOptionStyle}>
                          <span style={{ color: "#89b4fa", fontWeight: 700, width: 18 }}>{op.key}</span>
                          <span style={{ color: "#cdd6f4" }}>{renderMathText(op.value)}</span>
                        </div>
                      ))
                    : <div style={{ color: "#a6adc8", fontSize: 12 }}>{lang === "en" ? "No standard option structure extracted" : "未提取到标准选项结构"}</div>}
                </div>
              </>
            )}

            {dtype === "judge" && (
              <>
                <div style={historyStemStyle}>{renderMathText(formatQuestionTextForDisplay(judgeView.stem || sourceText) || (lang === "en" ? "(No stem)" : "(无题干)"))}</div>
                {judgeView.options.length > 0 && (
                  <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                    {judgeView.options.map((op) => (
                      <div key={op.key} style={historyOptionStyle}>
                        <span style={{ color: "#f9c58f", fontWeight: 700, width: 18 }}>{op.key}</span>
                        {op.value ? <span style={{ color: "#cdd6f4" }}>{renderMathText(op.value)}</span> : null}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {(dtype === "fill_blank" || dtype === "short_answer" || dtype === "unknown") && (
              <>
                <div style={historyStemStyle}>
                  {renderMathText(
                    dtype === "fill_blank"
                      ? fillBlankStem || (lang === "en" ? "(No stem)" : "(无题干)")
                      : prettySourceText || (lang === "en" ? "(No stem)" : "(无题干)"),
                  )}
                </div>
                {dtype === "fill_blank" && blankView.blanks.length > 0 && (
                  <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                    {blankView.blanks.map((blank, idx) => (
                      <div key={`${blank.label}-${idx}`} style={historyOptionStyle}>
                        <span style={{ color: "#cba6f7", fontWeight: 700, width: 32 }}>{blank.label}</span>
                        <span style={{ color: "#cdd6f4" }}>{renderMathText(blank.hint || (lang === "en" ? "Blank" : "填空"))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => setExpandedIds((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))}
                style={{
                  border: "1px solid #45475a",
                  background: "transparent",
                  color: "#89b4fa",
                  borderRadius: 6,
                  fontSize: 11,
                  padding: "2px 8px",
                  cursor: "pointer",
                }}
              >
                {showDetails ? (lang === "en" ? "Hide details" : "收起详情") : (lang === "en" ? "View details" : "查看详情")}
              </button>
              <div style={{ fontSize: 10, color: "#6c7086" }}>
                {lang === "en" ? "Confidence" : "置信度"} {Math.round((entry.result.confidence ?? 0) * 100)}%
              </div>
            </div>

            {showDetails && (
              <div
                style={{
                  marginTop: 6,
                  padding: "8px",
                  borderRadius: 6,
                  border: "1px solid #313244",
                  backgroundColor: "#11111b",
                  color: "#cdd6f4",
                  fontSize: 12,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}
              >
                {entry.result.detailedExplanation || entry.result.briefExplanation || (lang === "en" ? "(No detailed explanation)" : "(无详细解析)")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const TypeBadge: React.FC<{ type: QuestionType; lang: UILang }> = ({ type, lang }) => {
  const map: Record<QuestionType, { text: string; bg: string; fg: string }> = {
    single_choice: { text: lang === "en" ? "Single" : "单选", bg: "#1d2a3d", fg: "#89b4fa" },
    multi_choice: { text: lang === "en" ? "Multi" : "多选", bg: "#23301f", fg: "#a6e3a1" },
    judge: { text: lang === "en" ? "Judge" : "判断", bg: "#36241c", fg: "#f9c58f" },
    fill_blank: { text: lang === "en" ? "Blank" : "填空", bg: "#2d2236", fg: "#cba6f7" },
    short_answer: { text: lang === "en" ? "Short" : "简答", bg: "#2a2a2a", fg: "#f2cdcd" },
    unknown: { text: lang === "en" ? "Unknown" : "未知", bg: "#2b2d40", fg: "#bac2de" },
  };
  const s = map[type];
  return (
    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, backgroundColor: s.bg, color: s.fg }}>
      {s.text}
    </span>
  );
};

const SettingsTab: React.FC<{ lang: UILang; onLanguageChange: (lang: UILang) => void }> = ({ lang: initialLang, onLanguageChange }) => {
  const [providerId, setProviderId] = useState<ProviderId>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [route, setRoute] = useState<"auto" | "text" | "vision">("auto");
  const [customUrl, setCustomUrl] = useState("");
  const [customProtocol, setCustomProtocol] = useState<"openai" | "anthropic">("openai");
  const [lang, setLang] = useState<"zh" | "en">(initialLang);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const provider = getProvider(providerId);

  useEffect(() => {
    loadSettings().then((s) => {
      setProviderId((s.providerId as ProviderId) ?? "anthropic");
      setApiKey(s.apiKey ?? "");
      setModel(s.apiModel ?? "");
      setRoute(s.preferredRoute ?? "auto");
      setCustomUrl(s.customBaseUrl ?? "");
      setCustomProtocol(s.customProviderProtocol ?? "openai");
      setLang(s.language ?? "zh");
    });
  }, []);

  useEffect(() => {
    setLang(initialLang);
  }, [initialLang]);

  const handleProviderChange = (id: ProviderId) => {
    setProviderId(id);
    setModel(getProvider(id).defaultModel);
    setApiKey("");
    setTestResult(null);
  };

  const handleSave = async () => {
    await saveSettings({
      providerId,
      apiKey: apiKey.trim(),
      apiModel: model || provider.defaultModel,
      preferredRoute: route,
      customBaseUrl: customUrl || undefined,
      customProviderProtocol: customProtocol,
      language: lang,
    });
    onLanguageChange(lang);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const currentProvider = getProvider(providerId);
      const settings = await loadSettings();
      const testBlock: QuestionBlock = {
        id: "test",
        bbox: { x: 0, y: 0, width: 100, height: 50 },
        previewText: "1+1等于多少？A.1 B.2 C.3 D.4",
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
      const routeLabel = result.routeUsed === "vision" ? (isEn ? "vision" : "视觉") : result.routeUsed === "text" ? (isEn ? "text" : "文本") : (isEn ? "hybrid" : "混合");
      setTestResult(
        isEn
          ? `Connection success, route: ${routeLabel} | answer: ${result.answer} (confidence ${Math.round(result.confidence * 100)}%)`
          : `连接成功，路由: ${routeLabel} | 答案: ${result.answer} (置信度 ${Math.round(result.confidence * 100)}%)`,
      );
    } catch (err) {
      const errorMsg = String(err);
      const match = errorMsg.match(/\"message\":\"([^\"]+)\"/);
      const displayError = match ? match[1] : errorMsg.slice(0, 120);
      setTestResult(isEn ? `Failed: ${displayError}` : `失败: ${displayError}`);
    }
    setTesting(false);
  };

  const KEY_LINKS: Record<string, [string, string]> = {
    anthropic: ["https://console.anthropic.com", "Anthropic Console"],
    openai: ["https://platform.openai.com", "OpenAI Platform"],
    deepseek: ["https://platform.deepseek.com", "DeepSeek Platform"],
    gemini: ["https://aistudio.google.com", "Google AI Studio"],
    qwen: ["https://dashscope.aliyun.com", "阿里云百炼"],
    moonshot: ["https://platform.moonshot.cn", "Moonshot Platform"],
    zhipu: ["https://open.bigmodel.cn", "智谱开放平台"],
    minimax: ["https://platform.minimaxi.com", "MiniMax Platform"],
    custom: ["https://platform.openai.com/docs/api-reference/chat", "OpenAI Compatible API Docs"],
  };
  const isEn = lang === "en";

  return (
    <div style={{ padding: "14px 12px", display: "flex", flexDirection: "column", gap: 16 }}>
      <FieldGroup label={isEn ? "AI Provider" : "AI 提供商"}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleProviderChange(p.id as ProviderId)}
              style={{
                padding: "8px 8px",
                borderRadius: 7,
                cursor: "pointer",
                textAlign: "left",
                border: `1px solid ${providerId === p.id ? "#4f9cf9" : "#313244"}`,
                backgroundColor: providerId === p.id ? "#1c2a3a" : "#181825",
                color: providerId === p.id ? "#89b4fa" : "#a6adc8",
                fontWeight: providerId === p.id ? 600 : 400,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              <div style={{ fontSize: 12, marginBottom: 2 }}>{p.name}</div>
              <div style={{ fontSize: 10, color: "#6c7086" }}>
                {p.supportsVision ? (isEn ? "Vision" : "支持图片") : (isEn ? "Text only" : "仅文本")}
                {p.keyOptional ? (isEn ? " | Key optional" : " | 免 Key") : ""}
              </div>
            </button>
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label={provider.keyOptional ? (isEn ? "API Key (Optional)" : "API Key（可选）") : "API Key *"}>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={provider.keyPlaceholder} style={inputStyle} />
        {!provider.keyOptional && !apiKey && (
          <div style={{ fontSize: 10, color: "#f9e2af", marginTop: 4 }}>
            {isEn ? "If unset, mock demo data will be used" : "未设置时将使用 Mock 演示数据"}
          </div>
        )}
        {KEY_LINKS[providerId] && (
          <a href={KEY_LINKS[providerId][0]} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#89b4fa", display: "block", marginTop: 4 }}>
            {isEn ? `Get Key at ${KEY_LINKS[providerId][1]}` : `前往 ${KEY_LINKS[providerId][1]} 获取 Key`}
          </a>
        )}
      </FieldGroup>

      <FieldGroup label={isEn ? "Model" : "模型"}>
        {providerId === "custom" ? (
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={isEn ? "Enter model name, e.g. gpt-4o-mini" : "手动输入模型名，如 gpt-4o-mini"}
            style={inputStyle}
          />
        ) : (
          <select value={model || provider.defaultModel} onChange={(e) => setModel(e.target.value)} style={inputStyle}>
            {provider.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </FieldGroup>

      {providerId === "custom" && (
        <FieldGroup label={isEn ? "Custom Protocol" : "自定义协议"}>
          {([
            ["openai", isEn ? "OpenAI Compatible" : "OpenAI 兼容"],
            ["anthropic", isEn ? "Claude (Anthropic) Compatible" : "Claude(Anthropic) 兼容"],
          ] as const).map(([val, label]) => (
            <label key={val} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
              <input
                type="radio"
                name="custom-protocol"
                checked={customProtocol === val}
                onChange={() => setCustomProtocol(val)}
                style={{ accentColor: "#4f9cf9" }}
              />
              <span style={{ fontSize: 13 }}>{label}</span>
            </label>
          ))}
        </FieldGroup>
      )}

      {(providerId === "ollama" || providerId === "openai" || providerId === "custom" || providerId === "anthropic" || providerId === "minimax") && (
        <FieldGroup label={isEn ? "Custom Base URL (Optional)" : "自定义 Base URL（可选）"}>
          <input type="text" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder={provider.baseUrl} style={inputStyle} />
          <div style={{ fontSize: 10, color: "#6c7086", marginTop: 4 }}>
            {isEn ? "Leave empty to use default endpoint. Proxy/self-hosted URL is supported." : "留空则使用默认地址，也可以填写代理或自托管地址。"}
          </div>
        </FieldGroup>
      )}

      <FieldGroup label={isEn ? "Parse Route" : "解析路由"}>
        {([
          ["auto", isEn ? "Auto (Recommended)" : "自动判断（推荐）"],
          ["text", isEn ? "Text First" : "文本优先"],
          ["vision", isEn ? "Vision First" : "视觉优先"],
        ] as const).map(([val, label]) => (
          <label key={val} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
            <input type="radio" name="route" checked={route === val} onChange={() => setRoute(val)} style={{ accentColor: "#4f9cf9" }} />
            <span style={{ fontSize: 13 }}>{label}</span>
          </label>
        ))}
      </FieldGroup>

      <FieldGroup label={isEn ? "UI Language" : "界面语言"}>
        <div style={{ display: "flex", gap: 8 }}>
          {(["zh", "en"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              style={{
                flex: 1,
                padding: "7px",
                borderRadius: 7,
                border: `1px solid ${lang === l ? "#4f9cf9" : "#313244"}`,
                backgroundColor: lang === l ? "#1c2a3a" : "transparent",
                color: lang === l ? "#89b4fa" : "#6c7086",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              {l === "zh" ? "中文" : "English"}
            </button>
          ))}
        </div>
      </FieldGroup>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn primary onClick={handleSave}>{saved ? (isEn ? "Saved" : "已保存") : (isEn ? "Save Settings" : "保存设置")}</Btn>
        <Btn onClick={handleTest} disabled={testing}>{testing ? (isEn ? "Testing..." : "测试中...") : (isEn ? "Connection Test" : "连接测试")}</Btn>
      </div>

      {testResult && (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            fontSize: 12,
            wordBreak: "break-all",
            backgroundColor: /^(连接成功|Connection success)/.test(testResult) ? "#1e3a2e" : "#2c1515",
            border: `1px solid ${/^(连接成功|Connection success)/.test(testResult) ? "#2d5a3d" : "#5a2d2d"}`,
            color: /^(连接成功|Connection success)/.test(testResult) ? "#a6e3a1" : "#f38ba8",
          }}
        >
          {testResult}
        </div>
      )}
    </div>
  );
};

const FieldGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div style={{ fontSize: 10, color: "#a6adc8", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    {children}
  </div>
);

const Btn: React.FC<{ children: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean }> = ({ children, onClick, primary, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      padding: "7px 14px",
      borderRadius: 7,
      border: "none",
      cursor: disabled ? "not-allowed" : "pointer",
      backgroundColor: disabled ? "#313244" : primary ? "#4f9cf9" : "#313244",
      color: disabled ? "#6c7086" : primary ? "#fff" : "#cdd6f4",
      fontSize: 12,
      fontWeight: primary ? 600 : 400,
      fontFamily: "system-ui, sans-serif",
    }}
  >
    {children}
  </button>
);

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  borderRadius: 6,
  border: "1px solid #45475a",
  backgroundColor: "#181825",
  color: "#cdd6f4",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "system-ui, sans-serif",
};

function shouldBootstrapContentScript(error: unknown): boolean {
  const text = String(error || "");
  return /Receiving end does not exist|Could not establish connection/i.test(text);
}

async function injectContentScriptIntoTab(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content-main.js"],
    });
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    return true;
  } catch (err) {
    console.warn("[SidePanel] content bootstrap failed:", err);
    return false;
  }
}

async function sendRawTabMessage<T = unknown>(tabId: number, message: ExtMessage): Promise<{ ok: boolean; response?: T; error?: string }> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (resp?: T) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message || "unknown tabs.sendMessage error",
        });
        return;
      }
      resolve({ ok: true, response: resp });
    });
  });
}

async function sendTabMessageWithBootstrap<T = unknown>(tabId: number, message: ExtMessage): Promise<{ ok: boolean; response?: T; error?: string }> {
  const first = await sendRawTabMessage<T>(tabId, message);
  if (first.ok || !shouldBootstrapContentScript(first.error)) return first;

  const injected = await injectContentScriptIntoTab(tabId);
  if (!injected) return first;

  return sendRawTabMessage<T>(tabId, message);
}

async function requestBlockImage(tabId: number, bbox: QuestionBlock["bbox"]): Promise<string | null> {
  const resp = await sendTabMessageWithBootstrap<{ ok?: boolean; dataUrl?: string }>(
    tabId,
    { type: "CAPTURE_BLOCK_IMAGE", bbox },
  );
  return resp.response?.ok && resp.response.dataUrl ? resp.response.dataUrl : null;
}

async function sendFillMessage(tabId: number, block: QuestionBlock, result: ParseResult): Promise<{ ok?: boolean; filledCount?: number; message?: string } | null> {
  const resp = await sendTabMessageWithBootstrap<{ ok?: boolean; filledCount?: number; message?: string }>(
    tabId,
    { type: "FILL_PARSED_ANSWER", block, result },
  );
  if (!resp.ok) {
    return {
      ok: false,
      filledCount: 0,
      message: resp.error || "填写消息发送失败",
    };
  }
  return resp.response ?? {
    ok: false,
    filledCount: 0,
    message: "页面未返回填写结果",
  };
}

function isRiskyCandidate(cand: DetectedCandidate): boolean {
  if (cand.status === "error") return true;
  if (cand.status !== "success" || !cand.result) return false;
  if ((cand.result.confidence ?? 0) < 0.72) return true;
  return shouldRetryWithVision(cand.result);
}

function shouldRetryWithVision(result: ParseResult): boolean {
  if ((result.confidence ?? 0) < 0.5) return true;
  const s = `${result.warning ?? ""} ${result.briefExplanation ?? ""}`.toLowerCase();
  return /(选项缺失|无法判断|无法确定|无法作答|missing options|incomplete)/i.test(s);
}

function preferVisionResult(textResult: ParseResult, visionResult: ParseResult): boolean {
  const jump = (visionResult.confidence ?? 0) - (textResult.confidence ?? 0);
  if (jump >= 0.12) return true;
  const t = `${textResult.warning ?? ""} ${textResult.briefExplanation ?? ""}`;
  const v = `${visionResult.warning ?? ""} ${visionResult.briefExplanation ?? ""}`;
  const textBad = /(选项缺失|无法判断|无法确定|无法作答|missing options|incomplete)/i.test(t);
  const visionBad = /(选项缺失|无法判断|无法确定|无法作答|missing options|incomplete)/i.test(v);
  return textBad && !visionBad;
}

function looksMathHeavy(text: string): boolean {
  const t = String(text || "");
  if (!t) return false;
  return /(g\(s\)|h\(s\)|g\(j|h\(j|f\(x\)|\bkv\b|s\^|\/|=\s*0|jω|jw|ω|σ|∫|Σ|√|传递函数|积分环节|稳态误差|奈奎斯特|伯德图|如图|图中|下图|上图)/i.test(t);
}

function langSafe(lang: "zh" | "en" | undefined, zh: string, en: string): string {
  return lang === "en" ? en : zh;
}

const historyStemStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#cdd6f4",
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const historyOptionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  fontSize: 12,
  lineHeight: 1.45,
};

function normalizeText(s: string): string {
  return normalizeMathDisplayText(String(s || "").replace(/\s+/g, " ").trim());
}

function normalizeMathDisplayText(text: string): string {
  let out = String(text || "");
  if (!out) return "";

  out = out
    .replace(/&infin;|&#8734;|\\infty/gi, "∞")
    .replace(/负无穷/g, "-∞")
    .replace(/正无穷/g, "+∞")
    .replace(/&omega;|&#969;|\\omega/gi, "ω")
    .replace(/&sigma;|&#963;|\\sigma/gi, "σ")
    .replace(/&minus;|&#8722;/gi, "-")
    .replace(/[−﹣－]/g, "-")
    .replace(/[＋﹢]/g, "+")
    .replace(/\b([+-])\s*infty\b/gi, "$1∞")
    .replace(/\binfty\b/gi, "∞")
    .replace(/由\s*-\s*(?:∞)?\s*到\s*\+\s*(?:∞)?/g, "由-∞到+∞")
    .replace(/从\s*-\s*(?:∞)?\s*到\s*\+\s*(?:∞)?/g, "从-∞到+∞");

  out = out.replace(
    /((?:ω|w|omega)[^。；;,.，\n]{0,24}?由)\s*-\s*(?:∞)?\s*到\s*\+\s*(?:∞)?/gi,
    (_m, prefix) => `${prefix}-∞到+∞`,
  );

  return out;
}

function cleanCandidatePreviewText(s: string): string {
  const normalized = normalizeText(s);
  if (!normalized) return "";

  const noiseMarkers = [
    "返回",
    "作业详情",
    "提交作业",
    "上一题",
    "下一题",
    "标记此题",
    "课堂练习",
    "总分",
    "题库卡",
    "答题卡",
    "提示我知道了",
    "提示提交",
    "重做",
    "取消",
    "退出",
    "文件预览",
    "在线客服",
  ];

  let cutIndex = -1;
  for (const marker of noiseMarkers) {
    const index = normalized.indexOf(marker);
    if (index > 0 && (cutIndex < 0 || index < cutIndex)) {
      cutIndex = index;
    }
  }

  const cleaned = cutIndex > 0 ? normalized.slice(0, cutIndex) : normalized;
  return normalizeText(cleaned);
}

export function formatQuestionTextForDisplay(s: string): string {
  const base = String(s || "").replace(/\r\n?/g, "\n").trim();
  if (!base) return "";
  return base
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(^|[\n。；;!?！？]\s*|\s{2,})(\(\d+\)|（\d+）)(?!\s*\/)/g, (_m, prefix, marker) => `${prefix}\n${marker}`)
    .replace(/\s*([①②③④⑤⑥⑦⑧⑨⑩])/g, "\n$1")
    .replace(/\s*(?=[A-D][\.\):：、]\s)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderMathText(text: string): React.ReactNode {
  const lines = String(text || "")
    .split("\n")
    .map((line) => normalizeRenderableMathText(line));
  return (
    <>
      {lines.map((line, lineIndex) => (
        <React.Fragment key={`line-${lineIndex}`}>
          {lineIndex > 0 ? <br /> : null}
          {renderMathTextLine(line, `line-${lineIndex}`)}
        </React.Fragment>
      ))}
    </>
  );
}

export function renderMathTextLine(text: string, keyPrefix: string): React.ReactNode[] {
  return renderStructuredMathTextLine(text, keyPrefix, 0);
}

export function renderStructuredMathTextLine(text: string, keyPrefix: string, depth: number): React.ReactNode[] {
  if (!text) return [];
  if (depth >= 4) return renderMathAtoms(text, keyPrefix);

  const fraction = findNextFractionExpression(text);
  if (!fraction) return renderMathAtoms(text, keyPrefix);

  const out: React.ReactNode[] = [];
  out.push(...renderStructuredMathTextLine(text.slice(0, fraction.start), `${keyPrefix}-pre`, depth + 1));
  out.push(
    <span
      key={`${keyPrefix}-frac-${depth}-${fraction.start}`}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        verticalAlign: "middle",
        margin: "0 0.14em",
        lineHeight: 1.05,
      }}
    >
      <span style={{ padding: "0 0.18em", borderBottom: "1px solid currentColor" }}>
        {renderStructuredMathTextLine(fraction.numerator, `${keyPrefix}-num`, depth + 1)}
      </span>
      <span style={{ padding: "0 0.18em" }}>
        {renderStructuredMathTextLine(fraction.denominator, `${keyPrefix}-den`, depth + 1)}
      </span>
    </span>,
  );
  out.push(...renderStructuredMathTextLine(text.slice(fraction.end), `${keyPrefix}-post`, depth + 1));
  return out;
}

export function renderMathAtoms(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /([\p{Script=Latin}\p{Script=Greek}\u0300-\u036f]{1,8})_\{([^{}]+)\}\^\{([^{}]+)\}|([\p{Script=Latin}\p{Script=Greek}\u0300-\u036f]{1,8})_\{([^{}]+)\}|([\p{Script=Latin}\p{Script=Greek}\u0300-\u036f]{1,8})\^\{([^{}]+)\}|(\d+)\^\{([^{}]+)\}|([\p{Script=Latin}\p{Script=Greek}\u0300-\u036f]{1,6})(\d{1,3})(?![\p{Script=Latin}\p{Script=Greek}\p{N}])|\^(\([^)]+\)|[\p{L}\p{N}+\-*/=.θωσμλφψπτχ]{1,24})/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    const index = match.index ?? 0;
    if (index > cursor) {
      out.push(text.slice(cursor, index));
    }

    if (match[1] && match[2] && match[3]) {
      if (looksLikeMathIdentifier(match[1])) {
        out.push(
          <React.Fragment key={`${keyPrefix}-subsup-${tokenIndex++}`}>
            {match[1]}
            <sub>{match[2]}</sub>
            <sup>{match[3]}</sup>
          </React.Fragment>,
        );
      } else {
        out.push(match[0]);
      }
    } else if (match[4] && match[5]) {
      if (looksLikeMathIdentifier(match[4])) {
        out.push(
          <React.Fragment key={`${keyPrefix}-sub-${tokenIndex++}`}>
            {match[4]}
            <sub>{match[5]}</sub>
          </React.Fragment>,
        );
      } else {
        out.push(match[0]);
      }
    } else if (match[6] && match[7]) {
      if (looksLikeMathIdentifier(match[6])) {
        out.push(
          <React.Fragment key={`${keyPrefix}-sup-${tokenIndex++}`}>
            {match[6]}
            <sup>{match[7]}</sup>
          </React.Fragment>,
        );
      } else {
        out.push(match[0]);
      }
    } else if (match[8] && match[9]) {
      out.push(
        <React.Fragment key={`${keyPrefix}-numsup-${tokenIndex++}`}>
          {match[8]}
          <sup>{match[9]}</sup>
        </React.Fragment>,
      );
    } else if (match[10] && match[11]) {
      if (looksLikeMathIdentifier(match[10])) {
        out.push(
          <React.Fragment key={`${keyPrefix}-sub-${tokenIndex++}`}>
            {match[10]}
            <sub>{match[11]}</sub>
          </React.Fragment>,
        );
      } else {
        out.push(match[0]);
      }
    } else if (match[12]) {
      if (looksLikeMathIdentifier(match[12])) {
        out.push(
          <React.Fragment key={`${keyPrefix}-sub-${tokenIndex++}`}>
            {match[12]}
            <sub>{match[13]}</sub>
          </React.Fragment>,
        );
      } else {
        out.push(match[0]);
      }
    } else if (match[14]) {
      const superscript = match[14].replace(/^\((.*)\)$/u, "$1");
      out.push(<sup key={`${keyPrefix}-sup-${tokenIndex++}`}>{superscript}</sup>);
    }

    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    out.push(text.slice(cursor));
  }

  return out;
}

export function normalizeRenderableMathText(text: string): string {
  const raw = String(text || "");
  if (!raw) return "";

  // Normalize common OCR/SVG flattening patterns before rendering.
  return raw
    .replace(/\b([A-Za-z])\s+(\d+)\s+(\d+)(?=\s*(?:[),+\-*/=]|$))/g, "$1_{$2}^{$3}")
    .replace(/([\p{Script=Greek}])\s+(\d+)(?=\s*(?:[),+\-*/=]|$))/gu, "$1^{$2}")
    .replace(/\b([A-Za-z])\s+(\d+)(?=\s*(?:[),+\-*/=]|$))/g, "$1_{$2}")
    .replace(/([\p{Script=Latin}\p{Script=Greek}])_\{(\d+)\}\s+(\d+)(?=\s*(?:[),+\-*/=]|$))/gu, "$1_{$2}^{$3}")
    .replace(/([\p{Script=Latin}\p{Script=Greek}])_\{(\d+)\}\s+\^\{(\d+)\}/gu, "$1_{$2}^{$3}")
    .replace(/([\p{Script=Latin}\p{Script=Greek}])(\d+)(?=[\p{Script=Han}])/gu, "$1_{$2}")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

export function findNextFractionExpression(text: string): { start: number; end: number; numerator: string; denominator: string } | null {
  const input = String(text || "");
  for (let i = 0; i < input.length; i += 1) {
    if (input[i] !== "(") continue;
    const numeratorEnd = findMatchingParen(input, i);
    if (numeratorEnd < 0) continue;

    let cursor = numeratorEnd + 1;
    while (cursor < input.length && /\s/.test(input[cursor])) cursor += 1;
    if (input[cursor] !== "/") continue;
    cursor += 1;
    while (cursor < input.length && /\s/.test(input[cursor])) cursor += 1;
    if (input[cursor] !== "(") continue;

    const denominatorStart = cursor;
    const denominatorEnd = findMatchingParen(input, denominatorStart);
    if (denominatorEnd < 0) continue;

    return {
      start: i,
      end: denominatorEnd + 1,
      numerator: input.slice(i + 1, numeratorEnd).trim(),
      denominator: input.slice(denominatorStart + 1, denominatorEnd).trim(),
    };
  }
  return null;
}

export function findMatchingParen(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function looksLikeMathIdentifier(token: string): boolean {
  const value = String(token || "").trim();
  if (!value) return false;
  if (/^[\p{Script=Han}]+$/u.test(value)) return false;
  return /[\p{L}θωσμλφψπτχ]/u.test(value);
}

function buildCandidateStemForDisplay(
  block: QuestionBlock,
  stemText: string,
  rawPreviewText: string,
  lang: UILang,
): string {
  const normalizedStem = cleanCandidatePreviewText(stemText);
  const imageLike = Boolean(block.questionImageUrl) || /\[图片\]|图片/.test(rawPreviewText);
  if (!imageLike) {
    return normalizedStem;
  }

  const compact = compactImageHeavyStem(rawPreviewText, normalizedStem);
  if (compact) {
    return `${compact} ${lang === "en" ? "(Image question)" : "（配图题）"}`.trim();
  }

  return `${normalizedStem.replace(/\[图片\]/g, "").trim()} ${lang === "en" ? "(Image question)" : "（配图题）"}`.trim();
}

function buildDisplaySegmentsForCandidate(
  block: QuestionBlock,
  stemText: string,
  rawPreviewText: string,
  lang: UILang,
): QuestionDisplaySegment[] {
  if (block.questionTypeGuess === "judge" || block.questionTypeGuess === "fill_blank") return [];

  if (block.displaySegments?.length) {
    return block.displaySegments
      .map((segment) => {
        if (segment.type === "image") return segment;
        return { ...segment, text: segment.text.replace(/\[图片\]/g, "").trim() };
      })
      .filter((segment) => segment.type === "image" || segment.text);
  }

  const imageUrl = getDisplayQuestionImageFromBlock(block);
  if (!imageUrl) return [];

  const displayStem = buildCandidateStemForDisplay(block, stemText, rawPreviewText, lang)
    .replace(/\s*[（(]配图题[)）]\s*$/g, "")
    .trim();
  const [lead, ...tailParts] = displayStem.split(/\[图片\]/g);
  const tail = tailParts.join(" ").trim();
  const segments: QuestionDisplaySegment[] = [];
  if (lead.trim()) segments.push({ type: "text", text: lead.trim() });
  segments.push({ type: "image", url: imageUrl });
  if (tail) segments.push({ type: "text", text: tail });
  return segments;
}

function compactImageHeavyStem(rawPreviewText: string, fallbackStem: string): string {
  const raw = cleanCandidatePreviewText(rawPreviewText || "");
  const headerMatch = raw.match(/^\d{1,3}\s*[\.、]\s*(?:单选题|多选题|判断题|填空题)?\s*(?:（\d+分）|\(\d+分\))?/);
  const header = normalizeText(headerMatch?.[0] || "");
  const withoutHeader = raw.replace(headerMatch?.[0] || "", "").trim();

  const imageParts = withoutHeader.split("[图片]");
  const beforeImage = normalizeText((imageParts[0] || "").trim());
  const afterImage = normalizeText(imageParts.slice(1).join(" ").trim());

  let lead = stripFormulaNoiseForImageStem(beforeImage);
  let tail = sanitizeImageStemTail(afterImage);

  if (!/[\u4e00-\u9fa5]{4,}/.test(lead)) {
    lead = stripFormulaNoiseForImageStem(
      normalizeText(fallbackStem)
        .replace(/\[图片\]/g, " ")
        .trim(),
    );
  }

  if (lead.length > 80) {
    lead = lead.slice(0, 80).replace(/\s+\S*$/, "").trim();
  }

  if ((!tail || tail.length < 6) && /[\u4e00-\u9fa5]{6,}/.test(fallbackStem)) {
    const fallbackTail = sanitizeImageStemTail(
      normalizeText(fallbackStem)
        .replace(beforeImage, "")
        .replace(/\[图片\]/g, " ")
        .trim(),
    );
    if (fallbackTail.length > tail.length) tail = fallbackTail;
  }

  const fallbackLead = stripFormulaNoiseForImageStem(
    beforeImage
      .replace(/\[图片\]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    { keepMathPlaceholders: true },
  );
  const mergedBody = [lead || fallbackLead, tail]
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const merged = normalizeText(`${header} ${mergedBody}`.trim());
  return trimDisplayStemTailNoise(merged);
}

function sanitizeImageStemTail(text: string): string {
  const normalized = normalizeText(text || "");
  if (!normalized) return "";

  return trimDisplayStemTailNoise(
    normalized
      .replace(/\.w\d+[a-z0-9]*\s+\.brush\d+\s*\{[^}]*\}/gi, " ")
      .replace(/\.w\d+[a-z0-9]*\s+\.pen\d+\s*\{[^}]*\}/gi, " ")
      .replace(/\b(?:q|TXXXX|\^+|=+\++|\(\d+\d+\d+\)|[xX]\s+[xX]\s+[xX])\b/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
}

function stripFormulaNoiseForImageStem(
  text: string,
  options?: { keepMathPlaceholders?: boolean },
): string {
  const normalized = normalizeText(text || "");
  if (!normalized) return "";

  let out = normalized
    .replace(/\.w\d+[a-z0-9]*\s+\.brush\d+\s*\{[^}]*\}/gi, " ")
    .replace(/\.w\d+[a-z0-9]*\s+\.pen\d+\s*\{[^}]*\}/gi, " ")
    .replace(/[A-Za-z]{2,}\s*[:=]?\s*[0-9.()\-+*/]*/g, " ")
    .replace(/[0-9]+\s*(?:[,，]\s*[0-9]+){2,}/g, " ")
    .replace(/[θωσμλφψπτxyzXYZTLHGS]{1,}/g, " ");

  if (options?.keepMathPlaceholders) {
    out = out.replace(/\(\s*\)/g, "（ ）");
  } else {
    out = out.replace(/[=+\-*/()[\]{}<>]/g, " ");
  }

  return trimDisplayStemTailNoise(
    out
      .replace(/\s{2,}/g, " ")
      .replace(/\s*[:：]\s*/g, "：")
      .trim(),
  );
}

function trimDisplayStemTailNoise(text: string): string {
  const normalized = normalizeText(text || "");
  if (!normalized) return "";
  return normalized
    .replace(/\s*(?:\[图片\]|图片)\s*$/g, "")
    .replace(/\s*[=+\-*/(){}\[\]<>.,，;；:：]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getDisplayQuestionImage(entry: HistoryItem): string {
  return getDisplayQuestionImageFromBlock(entry.block);
}

function getDisplayQuestionImageFromBlock(block: QuestionBlock): string {
  const q = String(block.questionImageUrl || "").trim();
  if (!/^https?:\/\//i.test(q)) return "";
  // Only keep likely original question figure URLs, never screenshot/data URLs.
  if (!/\.(png|jpg|jpeg|webp)(?:[?#]|$)/i.test(q)) return "";
  if (!/(tikuimgs\.oss-|aliyuncs\.com|tiku\.cn|polymas\.com)/i.test(q)) return "";
  return q;
}

function normalizeAnswer(ans?: string): string {
  if (!ans) return "-";
  const letters = String(ans).toUpperCase().match(/[A-D]/g);
  if (!letters?.length) return ans;
  return Array.from(new Set(letters)).sort().join(",");
}

function normalizeHistoryAnswer(entry: HistoryItem, dtype: QuestionType): string {
  const raw = String(entry.result.answer || "");
  if (/(见分点答案|见分点作答|按分点作答|分点作答|仅供参考|参考答案见解析|详见解析|示例答案|需人工确认)/.test(raw)) {
    return "需人工确认";
  }
  const normalized = normalizeAnswer(raw);
  const looksChoiceLetters = /^[A-D](?:\s*[,，、/|]\s*[A-D])*$/.test(normalized);
  const text = normalizeText(`${entry.result.recognizedText || ""} ${entry.block.previewText || ""}`);
  const looksMultiPart = /\(\s*1\s*\)|（\s*1\s*）|请据图回答|填空|____|________/.test(text);

  if ((dtype === "fill_blank" || dtype === "short_answer" || dtype === "unknown") && looksChoiceLetters && looksMultiPart) {
    return "需人工确认";
  }
  return normalized;
}

function getDisplayType(entry: HistoryItem): QuestionType {
  const t1 = entry.result.questionType;
  if (t1 && ["single_choice", "multi_choice", "judge", "fill_blank", "short_answer", "unknown"].includes(t1)) {
    return t1 as QuestionType;
  }
  const t2 = entry.block.questionTypeGuess;
  if (t2 && ["single_choice", "multi_choice", "judge", "fill_blank", "short_answer", "unknown"].includes(t2)) {
    return t2 as QuestionType;
  }
  const text = normalizeText(entry.result.recognizedText || entry.block.previewText || "");
  if (/判断|对错|正确|错误|true|false/i.test(text)) return "judge";
  if (/填空|____|___/.test(text)) return "fill_blank";
  const optionCount = (text.match(/[A-D][\.\):：、]/g) || []).length;
  if (optionCount >= 4) return "single_choice";
  if (optionCount >= 2) return "multi_choice";
  return "unknown";
}

function splitStemAndOptions(text: string): { stem: string; options: Array<{ key: string; value: string }> } {
  const normalized = cleanCandidatePreviewText(text);
  const firstOptionIdx = normalized.search(/[A-D][\.\):：、]/);
  if (firstOptionIdx < 0) return { stem: normalized, options: [] };

  const stem = normalizeText(normalized.slice(0, firstOptionIdx));
  const optionSegment = normalized.slice(firstOptionIdx);
  const rawMatches = Array.from(optionSegment.matchAll(/([A-D])[\.\):：、]\s*([\s\S]*?)(?=(?:\s+[A-D][\.\):：、])|$)/g));
  const dedup = new Map<string, string>();
  for (const m of rawMatches) {
    const key = m[1];
    const value = sanitizeOptionValue(m[2] || "");
    if (!value) continue;
    if (!dedup.has(key)) dedup.set(key, value);
  }
  const options = [...dedup.entries()].map(([key, value]) => ({ key, value }));
  if (!looksLikeCleanOptions(stem, options)) {
    return { stem: normalized, options: [] };
  }
  return { stem, options };
}

function splitStemAndBlanks(text: string): { stem: string; blanks: Array<{ label: string; hint: string }> } {
  const normalized = cleanCandidatePreviewText(text).replace(/请输入答案/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return { stem: "", blanks: [] };

  const labelRegex = /(?:^|\s)(\d+\.\d+|[（(]\d+[)）])(?=\s|$)/g;
  const matches = Array.from(normalized.matchAll(labelRegex));
  const labels = matches.map((m) => m[1]);
  const uniqueLabels = Array.from(new Set(labels));
  const firstLabelIdx = matches[0]?.index ?? -1;
  const stemCandidate = firstLabelIdx > 0 ? normalized.slice(0, firstLabelIdx).trim() : normalized;

  if (uniqueLabels.length > 0) {
    return {
      stem: stemCandidate,
      blanks: uniqueLabels.map((label, idx) => ({
        label: normalizeBlankLabel(label, idx),
        hint: "",
      })),
    };
  }

  const underscoreCount = (normalized.match(/_{3,}|—{2,}|﹍{2,}/g) || []).length;
  if (underscoreCount > 0) {
    return {
      stem: normalized,
      blanks: Array.from({ length: underscoreCount }, (_, idx) => ({
        label: `空${idx + 1}`,
        hint: "",
      })),
    };
  }

  return { stem: normalized, blanks: [] };
}

function splitJudgeStemAndOptions(text: string): { stem: string; options: Array<{ key: string; value: string }> } {
  const normalized = cleanCandidatePreviewText(text);
  if (!normalized) return { stem: "", options: [] };

  let stem = extractJudgeDisplayStem(normalized);
  const options: Array<{ key: string; value: string }> = [];
  const hasStandaloneJudgeWords = /(?:^|\s)(?:对|错|正确|错误)(?=\s|$)/.test(normalized);

  if (/\btrue\b|\bfalse\b/i.test(normalized)) {
    options.push({ key: "T", value: "True" });
    options.push({ key: "F", value: "False" });
    return { stem, options };
  }

  if (/(?:^|\s)(?:正确|错误)(?=\s|$)/.test(normalized)) {
    options.push({ key: "对", value: "" });
    options.push({ key: "错", value: "" });
    return { stem, options };
  }

  if (hasStandaloneJudgeWords) {
    options.push({ key: "对", value: "" });
    options.push({ key: "错", value: "" });
  }

  return { stem, options };
}

function extractJudgeDisplayStem(text: string): string {
  const normalized = cleanCandidatePreviewText(text);
  if (!normalized) return "";

  const headers = Array.from(normalized.matchAll(JUDGE_HEADER_RE));
  let out = normalized;
  const firstIndex = headers[0]?.index ?? -1;
  if (firstIndex > 0) out = out.slice(firstIndex).trim();
  if (headers.length >= 2 && typeof headers[1].index === "number") {
    out = out.slice(0, headers[1].index!).trim();
  }

  const explicitSentence = out.match(/^(\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)\s*.*?[。！？!?])/);
  if (explicitSentence?.[1]) return dedupeRepeatedJudgeStemForDisplay(explicitSentence[1]);

  const cutAtOption = out.match(/^(\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)\s*.*?)(?=\s+(?:对|错|正确|错误|true|false)\b)/i);
  if (cutAtOption?.[1]) return dedupeRepeatedJudgeStemForDisplay(cutAtOption[1]);

  return dedupeRepeatedJudgeStemForDisplay(out);
}

function dedupeRepeatedJudgeStemForDisplay(text: string): string {
  const normalized = cleanCandidatePreviewText(text);
  if (!normalized) return "";

  const headerMatch = normalized.match(/^(\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)\s*)(.+)$/);
  if (!headerMatch) return normalizeText(normalized);

  const header = headerMatch[1];
  const body = headerMatch[2].trim();
  if (!body) return normalizeText(normalized);

  const firstOptionAt = body.search(/\b(?:对|错|正确|错误|true|false)\b/i);
  const leadStem = normalizeText((firstOptionAt > 0 ? body.slice(0, firstOptionAt) : body).trim());
  if (leadStem.length >= 8) {
    const repeatedLeadAt = body.indexOf(leadStem, leadStem.length);
    if (repeatedLeadAt > 0) {
      return normalizeText(`${header}${body.slice(0, repeatedLeadAt).trim()}`);
    }
  }

  const firstSentence = body.match(/^(.{6,}?[。！？!?])/);
  if (firstSentence?.[1]) {
    const sentence = normalizeText(firstSentence[1]);
    const secondIndex = body.indexOf(sentence, sentence.length);
    if (secondIndex > 0) {
      return normalizeText(`${header}${body.slice(0, secondIndex).trim()}`);
    }
  }

  const probe = normalizeText(body.slice(0, Math.min(24, Math.max(12, Math.floor(body.length / 2)))));
  if (probe.length >= 12) {
    const repeatedAt = body.indexOf(probe, probe.length);
    if (repeatedAt > 0) {
      return normalizeText(`${header}${body.slice(0, repeatedAt).trim()}`);
    }
  }

  return normalizeText(`${header}${body}`);
}

function ensureBlankPlaceholders(text: string, blankCount: number): string {
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized || blankCount <= 0) return normalized;

  const existingBlankCount = (normalized.match(/_{3,}|—{2,}|﹍{2,}/g) || []).length;
  if (existingBlankCount >= blankCount) return normalized;

  let remaining = blankCount - existingBlankCount;
  let rebuilt = normalized.replace(
    /([\u4e00-\u9fa5A-Za-z0-9])\s+(?=[\u4e00-\u9fa5A-Za-z0-9])/g,
    (full, prev) => {
      if (remaining <= 0) return full;
      remaining -= 1;
      return `${prev} ____ `;
    },
  );

  if (remaining > 0) {
    const suffix = Array.from({ length: remaining }, () => " ____ ").join("");
    rebuilt = `${rebuilt}${suffix}`;
  }

  return rebuilt.replace(/\s{2,}/g, " ").trim();
}

function normalizeBlankLabel(label: string, idx: number): string {
  const trimmed = normalizeText(label).replace(/[()（）]/g, "");
  if (/^\d+\.\d+$/.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `空${trimmed}`;
  return trimmed || `空${idx + 1}`;
}

function inferPreviewQuestionType(
  previewText: string,
  choiceOptionCount: number,
  blankCount: number,
  judgeOptionCount: number,
): QuestionType {
  const text = cleanCandidatePreviewText(previewText);
  if (!text) return "unknown";
  if (/判断题|是非题/.test(text) || judgeOptionCount >= 2) return "judge";
  if (/填空题|____|________/.test(text) || blankCount > 0) return "fill_blank";
  if (/多选/.test(text)) return "multi_choice";
  if (/单选/.test(text)) return "single_choice";
  if (choiceOptionCount >= 4) return "single_choice";
  return "unknown";
}

function sanitizeOptionValue(raw: string): string {
  const normalized = cleanCandidatePreviewText(raw);
  if (!normalized) return "";

  const repeatedHeaderMatch = normalized.match(/\s+\d{1,3}\s*[\.、．]\s*[\[【]?(?:单选题|多选题|判断题|填空题)[\]】]?\s*\(\d+分\)/u);
  const preTrimmed = repeatedHeaderMatch?.index && repeatedHeaderMatch.index > 0
    ? normalizeText(normalized.slice(0, repeatedHeaderMatch.index))
    : normalized;

  const noisePattern = /(?:返回|作业详情|提交作业|上一题|下一题|标记此题|课堂练习|总分|题库卡|答题卡|单选题|多选题|判断题|填空题|提示我知道了|提示提交|重做|取消|退出|文件预览|在线客服|submit|previous|next)/i;
  const match = noisePattern.exec(preTrimmed);
  let trimmed = (!match || match.index <= 0)
    ? preTrimmed
    : normalizeText(preTrimmed.slice(0, match.index));

  trimmed = trimTrailingNextQuestionMarker(trimmed);
  return stripTrailingSectionNoise(trimmed);
}

function trimTrailingNextQuestionMarker(text: string): string {
  let out = normalizeText(text);
  if (!out) return "";

  out = out
    .replace(/\s+[一二三四五六七八九十]+、\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【](?:单选题|多选题|判断题|填空题)?[\]】]?\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【]\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*$/u, "")
    .trim();

  return out;
}

function stripTrailingSectionNoise(text: string): string {
  let out = normalizeText(text);
  if (!out) return "";

  out = out
    .replace(/\s+[一二三四五六七八九十]+、\s*$/u, "")
    .replace(/\s+第\s*[一二三四五六七八九十\d]+\s*[章节题]\s*$/u, "")
    .replace(/\s+\d+\s*[、.．]\s*$/u, "")
    .trim();

  return out;
}

function looksLikeCleanOptions(stem: string, options: Array<{ key: string; value: string }>): boolean {
  if (options.length < 2) return false;

  const keys = options.map((option) => option.key).join("");
  if (!/^A(B(C(D)?)?)?$/.test(keys)) return false;

  const values = options.map((option) => option.value);
  if (values.some((value) => !value || value.length > 120)) return false;
  if (values.some((value) => /返回|提交作业|上一题|下一题|课堂练习|文件预览|在线客服/i.test(value))) return false;

  const stemLength = normalizeText(stem).length;
  const totalOptionLength = values.reduce((sum, value) => sum + value.length, 0);
  if (stemLength > 0 && totalOptionLength > stemLength * 3.2) return false;

  return true;
}





