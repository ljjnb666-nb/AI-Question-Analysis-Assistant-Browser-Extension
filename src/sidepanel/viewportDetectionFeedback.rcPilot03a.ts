import type { CandidateOrigin, WorkspaceSnapshotResponse } from "@/shared/types";
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
): UserFeedback {
  const snapshot = response?.snapshot;
  if (!response?.ok || !isWorkspaceSnapshot(snapshot) || snapshot.disposed
    || snapshot.originUrl !== origin.url || snapshot.detection.mode !== "viewport"
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
  if (count === 0) {
    return userFeedback(
      "warning",
      lang === "en"
        ? "No usable questions were detected in the current screen. The page may still be loading or its layout may not be supported."
        : "当前屏未识别到可用题目。页面可能尚未加载完成，或题目布局暂不受支持。",
      { code: "VIEWPORT_DETECT_EMPTY" },
    );
  }
  return userFeedback(
    "success",
    lang === "en"
      ? `The workspace currently reports ${count} candidate question(s). Please review before parsing or filling.`
      : `工作区当前识别到 ${count} 道候选题。请核对题目后再解析或填写。`,
    { code: "VIEWPORT_DETECT_CANDIDATES" },
  );
}
