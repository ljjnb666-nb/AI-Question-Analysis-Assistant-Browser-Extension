import { useCallback, useEffect, useRef } from "react";
import type { CandidateOrigin, CandidateWorkspaceSnapshot } from "@/shared/types";
import { createWorkspaceHydration, type WorkspaceHydrationStatus } from "./workspaceHydration";
import { readWorkspaceOrigin, requestWorkspaceSnapshot, resolveWorkspaceOrigin } from "./workspaceTarget";

type Session = {
  getState: () => { status: string };
  subscribe: (listener: () => void) => () => void;
};

export function useCandidateWorkspaceHydration(session: Session, publish: (status: WorkspaceHydrationStatus, snapshot?: CandidateWorkspaceSnapshot, origin?: CandidateOrigin) => void) {
  const ref = useRef<ReturnType<typeof createWorkspaceHydration> | null>(null);
  useEffect(() => {
    const isAuthenticated = () => session.getState().status === "authenticated";
    const controller = createWorkspaceHydration({ isAuthenticated, resolveOrigin: resolveWorkspaceOrigin, readOrigin: readWorkspaceOrigin,
      request: (origin) => requestWorkspaceSnapshot(origin, isAuthenticated), publish });
    ref.current = controller;
    const onMessage = (msg: Record<string, unknown>, sender: chrome.runtime.MessageSender) => controller.observe(msg, sender);
    const onUpdated = (tabId: number, change: chrome.tabs.TabChangeInfo) => {
      if (change.url || change.status === "loading") controller.navigation(tabId);
    };
    // Register first, including for an already-authenticated mount.
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs?.onUpdated?.addListener(onUpdated);
    let authorized = false;
    const reconcile = () => {
      if (!isAuthenticated()) {
        authorized = false;
        controller.invalidate();
      } else if (!authorized) {
        authorized = true;
        void controller.sync();
      }
    };
    const unsubscribe = session.subscribe(reconcile);
    reconcile();
    return () => {
      unsubscribe();
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs?.onUpdated?.removeListener(onUpdated);
      controller.invalidate();
      ref.current = null;
    };
  }, [session, publish]);
  return useCallback(() => { void ref.current?.sync(); }, []);
}
