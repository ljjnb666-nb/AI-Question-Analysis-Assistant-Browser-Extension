import type { CandidateOrigin, DomCandidateDiagnostics, WorkspaceSnapshotResponse } from "@/shared/types";
import { userFeedback, type UserFeedback } from "@/shared/ui/userFeedback";
import { isWorkspaceSnapshot } from "./workspaceHydration";
import type { UILang } from "./displayUtils";

/**
 * Read-only, fail-closed result feedback. A transport START ACK is not
 * evidence of a completed detection. Only a versioned, origin-matched
 * content-owned snapshot may supply a candidate count.
 */
export function viewportDetectionSnapshotFeedback(
  lang: UILang,
  origin: CandidateOrigin,
  response: WorkspaceSnapshotResponse | null,
  expectedRequestId?: string,
): UserFeedback {
  const snapshot = response?.snapshot;
  if (!response?.ok || !isWorkspaceSnapshot(snapshot) || snapshot.disposed
    || snapshot.originUrl !== origin.url
    || (expectedRequestId !== undefined && snapshot.detection.requestId !== expectedRequestId)
    || snapshot.detection.mode !== "viewport"
    || snapshot.detection.phase !== "completed") {
    return userFeedback(
      "warning",
      lang === "en"
        ? "The current-screen request was received, but a verified detection result is not available. Try syncing the workspace again."
        : "已发送当前屏识别请求，但尚未取得可验证的结果。请重新同步工作区后重试。",
      { code: "VIEWPORT_DETECT_RESULT_UNCONFIRMED" },
    );
  }

  const count = snapshot.candidates.length;
  if (count === 0) return viewportEmptyDiagnosticFeedback(lang, snapshot.detection.diagnostics?.domDiagnostics);
  return userFeedback(
    "success",
    lang === "en"
      ? `The workspace currently reports ${count} candidate question(s). Please review before parsing or filling.`
      : `工作区当前识别到 ${count} 道候选题。请核对题目后再解析或填写。`,
    { code: "VIEWPORT_DETECT_CANDIDATES" },
  );
}

/** Numeric-only, reusable empty detection evidence for independently opened workspaces. */
export function viewportEmptyDiagnosticFeedback(lang: UILang, probes?: DomCandidateDiagnostics): UserFeedback {
    if (probes) {
      // Numeric-only, content-owned evidence; diagnostics cannot establish
      // that the page contains no questions or that OCR would find none.
      if (probes.probedElements === 0) {
        return userFeedback("warning", lang === "en"
          ? "No top-document question containers were probed. The page may still be loading or use an unsupported layout."
          : "当前屏未探测到顶层 DOM 题目候选容器。页面可能尚未就绪，或布局暂不受支持。",
          { code: "VIEWPORT_DETECT_NO_PROBES" });
      }
      const reasons = [
        ["geometry", "位置或尺寸", "geometry"], ["text", "文本长度", "text"],
        ["controls", "页面控件", "controls"], ["navigation", "导航元素", "navigation"],
        ["signal", "题目信号", "question signal"], ["confidence", "置信度", "confidence"],
        ["completeness", "题目完整性", "question completeness"],
      ] as const;
      const topReason = reasons.map(([key, zh, en]) => ({ n: probes.rejected[key], zh, en }))
        .sort((a, b) => b.n - a.n)[0];
      const reasonZh = topReason && topReason.n > 0
        ? `主要拒绝原因：${topReason.zh}（${topReason.n} 次）。` : "尚未形成可用题目候选。";
      const reasonEn = topReason && topReason.n > 0
        ? `Main rejection reason: ${topReason.en} (${topReason.n}).` : "No usable question candidate was formed.";
      return userFeedback("warning", lang === "en"
        ? `The detector performed ${probes.probedElements} top-document DOM candidate probe(s), but retained zero questions. ${reasonEn} Check whether the page has loaded or is supported.`
        : `当前屏检测器进行了 ${probes.probedElements} 次顶层 DOM 候选探测，但保留题目数为 0。${reasonZh}请检查页面加载状态或题目布局。`,
        { code: "VIEWPORT_DETECT_FILTERED_EMPTY" });
    }
    return userFeedback(
      "warning",
      lang === "en"
        ? "No usable questions were detected in the current screen. The page may still be loading or its layout may not be supported."
        : "当前屏未识别到可用题目。页面可能尚未加载完成，或题目布局暂不受支持。",
      { code: "VIEWPORT_DETECT_EMPTY" },
    );
}
