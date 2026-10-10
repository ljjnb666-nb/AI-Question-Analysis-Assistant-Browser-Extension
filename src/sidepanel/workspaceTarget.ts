import type { CandidateOrigin, WorkspaceSnapshotResponse } from "@/shared/types";
import { sendProtectedTabMessageWithBootstrap } from "./tabActions";

type WorkspaceTab = Pick<chrome.tabs.Tab, "id" | "url" | "active"> & { lastAccessed?: number };
const eligible = (tab: WorkspaceTab) => tab.id != null && /^https?:\/\//i.test(tab.url ?? "");
export function chooseWorkspaceOrigin(tabs: WorkspaceTab[]): CandidateOrigin | null {
  const pages = tabs.filter(eligible);
  const exams = pages.filter((tab) => /answer-homework|exam-hub|atHomeworkExam|homeworkQ/i.test(tab.url ?? ""));
  const choices = exams.length ? exams : pages;
  const active = choices.filter((tab) => tab.active);
  if (active.length > 1) return null;
  const latest = Math.max(0, ...choices.map((tab) => tab.lastAccessed ?? 0));
  const recent = latest > 0 ? choices.filter((tab) => tab.lastAccessed === latest) : [];
  const chosen = active.length === 1 ? active[0] : choices.length === 1 ? choices[0] : recent.length === 1 ? recent[0] : undefined;
  return chosen?.id != null && chosen.url ? { tabId: chosen.id, url: chosen.url } : null;
}
export async function resolveWorkspaceOrigin(): Promise<CandidateOrigin | null> {
  return chooseWorkspaceOrigin(await chrome.tabs.query({ currentWindow: true }));
}
export async function readWorkspaceOrigin(tabId: number): Promise<CandidateOrigin | null> {
  const tab = await chrome.tabs.get(tabId);
  return eligible(tab) && tab.url ? { tabId, url: tab.url } : null;
}
export async function requestWorkspaceSnapshot(origin: CandidateOrigin, isAuthenticated: () => boolean): Promise<WorkspaceSnapshotResponse | null> {
  if (!isAuthenticated()) return null;

  // Every attempt is still the same authenticated, read-only snapshot request.
  // Retry at most once for a *quick transport failure*, e.g. an MV3 content
  // receiver waking during an active scan. A 6s timeout never starts another
  // 6s wait; invalid content payloads must not be retried or trusted here.
  const requestOnce = async (): Promise<{ result: { ok: boolean; response?: WorkspaceSnapshotResponse; error?: string } | null; timedOut: boolean }> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const result = await Promise.race([
        sendProtectedTabMessageWithBootstrap<WorkspaceSnapshotResponse>(
          origin.tabId,
          { type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT", expectedUrl: origin.url },
          isAuthenticated,
        ),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve(null);
          }, 6000);
        }),
      ]);
      return { result, timedOut };
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await requestOnce();
  if (!isAuthenticated()) return null;
  if (first.result?.ok) return first.result.response ?? null;
  if (first.timedOut) return null;

  // Revalidate the exact origin before any retry. Tab replacement/navigation,
  // auth loss and an invalid snapshot all fail closed without another send.
  const current = await readWorkspaceOrigin(origin.tabId);
  if (!isAuthenticated() || current?.url !== origin.url) return null;
  const second = await requestOnce();
  return isAuthenticated() && second.result?.ok ? second.result.response ?? null : null;
}
