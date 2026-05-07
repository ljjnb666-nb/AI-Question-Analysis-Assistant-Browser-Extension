import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { DetectedCandidate, ParseResult, QuestionBlock, QuestionType } from "@/shared/types";
import { addHistoryEntry, clearHistory, exportHistory, loadSettings, saveSettings } from "@/shared/utils/storage";
import { getProvider, parseQuestion, PROVIDERS } from "@/shared/utils/parseRouter";
import type { ProviderId } from "@/shared/utils/parseRouter";

type HistoryItem = {
  id: string;
  timestamp: number;
  result: Partial<ParseResult> & { answer?: string; confidence?: number };
  block: { previewText?: string; questionTypeGuess?: QuestionType; imageDataUrl?: string; questionImageUrl?: string };
};

type UILang = "zh" | "en";

export const SidePanelApp: React.FC = () => {
  const [uiLang, setUiLang] = useState<UILang>("zh");
  const [tab, setTab] = useState<"candidates" | "history" | "settings">("candidates");
  const [candidates, setCandidates] = useState<DetectedCandidate[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isFullPageScan, setIsFullPageScan] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ progress: number; found: number; step: number; total: number } | null>(null);
  const [isBatchParsing, setIsBatchParsing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

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
        const blocks = (msg.candidates as QuestionBlock[]) ?? [];
        setCandidates((prev) => {
          const prevById = new Map(prev.map((c) => [c.block.id, c] as const));
          return blocks.map((b) => {
            const old = prevById.get(b.id);
            return {
              block: b,
              selected: (b as any)._selected === true,
              status: old?.status ?? "idle",
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
    if (activeTab?.id) chrome.tabs.sendMessage(activeTab.id, { type: "START_AUTO_DETECT" });
  };

  const handleFullPageDetect = async () => {
    setIsDetecting(false);
    setCandidates([]);
    setExpandedIds({});
    setScanProgress({ progress: 0, found: 0, step: 0, total: 1 });
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) chrome.tabs.sendMessage(activeTab.id, { type: "START_FULL_PAGE_DETECT" });
  };

  const handleCancelFullPage = async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) chrome.tabs.sendMessage(activeTab.id, { type: "FULL_PAGE_DETECT_CANCELLED" });
    setIsFullPageScan(false);
    setScanProgress(null);
  };

  const syncSelection = async (payload: { blockId?: string; selected?: boolean; selectAll?: boolean }) => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) chrome.tabs.sendMessage(activeTab.id, { type: "UPDATE_CANDIDATE_SELECTION", ...payload });
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
    if (activeTab?.id) chrome.tabs.sendMessage(activeTab.id, { type: "HIGHLIGHT_CANDIDATE", blockId });
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

  const selectedCount = candidates.filter((c) => c.selected).length;

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
                  <Btn primary onClick={handleBatchParse} disabled={!selectedCount || isBatchParsing}>
                    {isBatchParsing
                      ? (uiLang === "en" ? "Parsing..." : "解析中...")
                      : (uiLang === "en" ? `Solve ${selectedCount}` : `解析 ${selectedCount} 题`)}
                  </Btn>
                </>
              )}
            </div>

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

            {candidates.length === 0 && !isDetecting && !isFullPageScan && !scanProgress && (
                <div style={{ textAlign: "center", padding: "28px 0", color: "#6c7086", fontSize: 13 }}>
                {uiLang === "en"
                  ? "Click 'Current View' or 'Full Page Scan' to detect questions"
                  : "点击“当前屏”或“整页扫描”开始识别题目"}
              </div>
            )}

            {candidates.map((cand, i) => (
              <CandidateCard
                key={cand.block.id}
                index={i + 1}
                cand={cand}
                isExpanded={!!expandedIds[cand.block.id]}
                onToggle={() => toggleSelect(cand.block.id)}
                onFlash={() => handleFlash(cand.block.id)}
                onToggleDetails={() => toggleDetails(cand.block.id)}
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
  onRetryVision: () => void;
  lang: UILang;
}> = ({ index, cand, isExpanded, onToggle, onFlash, onToggleDetails, onRetryVision, lang }) => (
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
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ color: "#6c7086", fontSize: 11 }}>#{index}</span>
          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, backgroundColor: "#313244", color: "#89b4fa" }}>
            {(lang === "en" ? TYPE_LABELS_EN : TYPE_LABELS)[cand.block.questionTypeGuess] ?? "?"}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: STATUS_COLORS[cand.status] ?? "#45475a" }}>
            {(lang === "en" ? STATUS_LABELS_EN : STATUS_LABELS)[cand.status] ?? cand.status}
          </span>
        </div>

        <div
          style={{
            fontSize: 12,
            color: "#a6adc8",
            lineHeight: 1.5,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {cand.block.previewText || (lang === "en" ? "(No preview text)" : "(无预览文本)")}
        </div>

        {(cand.debugInfo?.routeUsed || cand.debugInfo?.imageAttached !== undefined) && (
          <div style={{ marginTop: 4, fontSize: 10, color: "#6c7086" }}>
            {lang === "en" ? "Route" : "路由"}: {cand.debugInfo?.routeUsed ?? "-"} |{" "}
            {lang === "en" ? "Image attached" : "已附图"}: {cand.debugInfo?.imageAttached ? (lang === "en" ? "Yes" : "是") : (lang === "en" ? "No" : "否")}
          </div>
        )}

        {cand.status === "success" && cand.result && (
          <div style={{ marginTop: 6, padding: "4px 8px", borderRadius: 4, backgroundColor: "#1e3a2e", border: "1px solid #2d5a3d", fontSize: 12, color: "#a6e3a1" }}>
            {lang === "en" ? "Answer" : "答案"}: <strong>{cand.result.answer}</strong>{" "}
            <span style={{ color: "#6c7086", fontSize: 11 }}>{cand.result.briefExplanation.slice(0, 40)}...</span>
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
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}
              >
                {cand.result.detailedExplanation || cand.result.briefExplanation}
              </div>
            )}
            {cand.status === "success" && shouldRetryWithVision(cand.result as ParseResult) && (
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
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 11, color: "#f38ba8" }}>{cand.error?.slice(0, 80)}</div>
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
                <div style={historyStemStyle}>{formatQuestionTextForDisplay(stem || sourceText) || (lang === "en" ? "(No stem)" : "(无题干)")}</div>
                <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                  {options.length > 0
                    ? options.map((op) => (
                        <div key={op.key} style={historyOptionStyle}>
                          <span style={{ color: "#89b4fa", fontWeight: 700, width: 18 }}>{op.key}</span>
                          <span style={{ color: "#cdd6f4" }}>{op.value}</span>
                        </div>
                      ))
                    : <div style={{ color: "#a6adc8", fontSize: 12 }}>{lang === "en" ? "No standard option structure extracted" : "未提取到标准选项结构"}</div>}
                </div>
              </>
            )}

            {dtype === "judge" && (
              <div style={historyStemStyle}>{formatQuestionTextForDisplay(stem || sourceText) || (lang === "en" ? "(No stem)" : "(无题干)")}</div>
            )}

            {(dtype === "fill_blank" || dtype === "short_answer" || dtype === "unknown") && (
              <div style={historyStemStyle}>{prettySourceText || (lang === "en" ? "(No stem)" : "(无题干)")}</div>
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

      {(providerId === "ollama" || providerId === "openai" || providerId === "custom" || providerId === "anthropic") && (
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

async function requestBlockImage(tabId: number, bbox: QuestionBlock["bbox"]): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: "CAPTURE_BLOCK_IMAGE", bbox },
      (resp?: { ok?: boolean; dataUrl?: string }) => resolve(resp?.ok && resp.dataUrl ? resp.dataUrl : null),
    );
  });
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
  return /(g\(s\)|h\(s\)|f\(x\)|\bkv\b|s\^|\/|=\s*0|传递函数|积分环节|稳态误差)/i.test(t);
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
  return String(s || "").replace(/\s+/g, " ").trim();
}

function formatQuestionTextForDisplay(s: string): string {
  const base = String(s || "").replace(/\r\n?/g, "\n").trim();
  if (!base) return "";
  return base
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s*(\(\d+\)|（\d+）)/g, "\n$1")
    .replace(/\s*([①②③④⑤⑥⑦⑧⑨⑩])/g, "\n$1")
    .replace(/\s*(?=[A-D][\.\):：、]\s)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getDisplayQuestionImage(entry: HistoryItem): string {
  const q = String(entry.block.questionImageUrl || "").trim();
  if (!/^https?:\/\//i.test(q)) return "";
  // Only keep likely original question figure URLs, never screenshot/data URLs.
  if (!/\.(png|jpg|jpeg|webp)(?:[?#]|$)/i.test(q)) return "";
  if (!/(tikuimgs\.oss-|aliyuncs\.com|tiku\.cn)/i.test(q)) return "";
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
  const normalized = normalizeAnswer(raw);
  const looksChoiceLetters = /^[A-D](?:\s*[,，、/|]\s*[A-D])*$/.test(normalized);
  const text = normalizeText(`${entry.result.recognizedText || ""} ${entry.block.previewText || ""}`);
  const looksMultiPart = /\(\s*1\s*\)|（\s*1\s*）|请据图回答|填空|____|________/.test(text);

  if ((dtype === "fill_blank" || dtype === "short_answer" || dtype === "unknown") && looksChoiceLetters && looksMultiPart) {
    return "见分点答案";
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
  const normalized = normalizeText(text);
  const firstOptionIdx = normalized.search(/[A-D][\.\):：、]/);
  if (firstOptionIdx < 0) return { stem: normalized, options: [] };

  const stem = normalizeText(normalized.slice(0, firstOptionIdx));
  const optionSegment = normalized.slice(firstOptionIdx);
  const rawMatches = Array.from(optionSegment.matchAll(/([A-D])[\.\):：、]\s*([\s\S]*?)(?=(?:\s+[A-D][\.\):：、])|$)/g));
  const dedup = new Map<string, string>();
  for (const m of rawMatches) {
    const key = m[1];
    const value = normalizeText(m[2] || "");
    if (!value) continue;
    if (!dedup.has(key)) dedup.set(key, value);
  }
  const options = [...dedup.entries()].map(([key, value]) => ({ key, value }));
  return { stem, options };
}





