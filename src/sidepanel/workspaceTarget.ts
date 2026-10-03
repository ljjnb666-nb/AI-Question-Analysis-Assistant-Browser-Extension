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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      sendProtectedTabMessageWithBootstrap<WorkspaceSnapshotResponse>(origin.tabId, { type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT", expectedUrl: origin.url }, isAuthenticated),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 6000); }),
    ]);
    return isAuthenticated() && response?.ok ? response.response ?? null : null;
  } finally { clearTimeout(timer); }
}
