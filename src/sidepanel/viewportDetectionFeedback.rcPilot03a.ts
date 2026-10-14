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
  const unconfirmed = () => userFeedback(
    "warning",
    lang === "en"
      ? "The current-screen request was received, but a verified detection result is not available. Try syncing the workspace again."
      : "已发送当前屏识别请求，但尚未取得可验证的结果。请重新同步工作区后重试。",
    { code: "VIEWPORT_DETECT_RESULT_UNCONFIRMED" },
  );
  // Trust only a valid, current, exact-request viewport snapshot. A START ACK
  // or an unrelated generation must never be interpreted as proof of failure.
  if (!response?.ok || !isWorkspaceSnapshot(snapshot) || snapshot.disposed
    || snapshot.originUrl !== origin.url
    || (expectedRequestId !== undefined && snapshot.detection.requestId !== expectedRequestId)
    || snapshot.detection.mode !== "viewport") return unconfirmed();

  // A content-owned failed terminal is neither an uncertain transport result
  // nor a successful zero-question scan. Preserve that distinction in copy.
  if (snapshot.detection.phase === "failed") {
    return userFeedback(
      "error",
      lang === "en"
        ? "Current-screen detection failed. No verified question result was produced. Check the page and retry detection."
        : "当前屏识别已失败，本次未取得可信的题目结果。请检查页面后重新识别。",
      { code: "VIEWPORT_DETECT_FAILED_CONFIRMED", viewportRequestId: snapshot.detection.requestId },
    );
  }
  if (snapshot.detection.phase !== "completed") return unconfirmed();

  const count = snapshot.candidates.length;
  if (count === 0) return {
    ...viewportEmptyDiagnosticFeedback(lang, snapshot.detection.diagnostics?.domDiagnostics),
    ...(snapshot.detection.requestId ? { viewportRequestId: snapshot.detection.requestId } : {}),
  };
  // DG-003: partial misses used to be invisible — a clean "N candidates" hid
  // swallowed questions. Surface a hint when lossy filters dropped candidates
  // (group competition / fragment filter / dedup); other reject reasons are
  // mostly true negatives and stay quiet to avoid noise.
  const dom = snapshot.detection.diagnostics?.domDiagnostics?.rejected;
  const dropped = dom ? dom.grouped + dom.fragment + dom.duplicate : 0;
  const partialHint = dropped > 0
    ? (lang === "en"
      ? ` ${dropped} candidate(s) were dropped during filtering/dedup; some questions may have been missed. If the count looks off, try manual capture.`
      : ` 另有 ${dropped} 个候选在筛选/去重中被舍去，可能存在未识别的题目；如题数不符，可尝试手动框选。`)
    : "";
  return userFeedback(
    "success",
    lang === "en"
      ? `The workspace currently reports ${count} candidate question(s). Please review before parsing or filling.${partialHint}`
      : `工作区当前识别到 ${count} 道候选题。请核对题目后再解析或填写。${partialHint}`,
    { code: "VIEWPORT_DETECT_CANDIDATES", viewportRequestId: snapshot.detection.requestId },
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
        ["grouped", "同组竞争", "group competition"],
        ["fragment", "片段过滤", "fragment filter"],
        ["duplicate", "重复去除", "duplicate removal"],
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
