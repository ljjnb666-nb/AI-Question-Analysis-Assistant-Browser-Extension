import React, { useCallback, useReducer } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateOrigin, CandidateWorkspaceSnapshot } from "@/shared/types";
import { createCandidateWorkspaceRuntime } from "@/content/candidateWorkspaceRuntime";
import { markProtectedWorkOwner, readProtectedWorkOwners, terminateRecordedProtectedWork } from "@/shared/auth/protectedWorkOwner";
import { useCandidateWorkspaceHydration } from "./useCandidateWorkspaceHydration";
import type { WorkspaceHydrationStatus } from "./workspaceHydration";
import { initialSidePanelAppState, sidePanelAppReducer } from "./sidepanelAppState";
import { deriveSidePanelWorkspaceStatus } from "./sidePanelWorkspaceState";

const listeners = new Set<(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) => void>();
const sessionListeners = new Set<() => void>();
const sessionStore: Record<string, unknown> = {};
let auth = "authenticated";
let runtime: ReturnType<typeof createCandidateWorkspaceRuntime>;
let response: Promise<unknown> | null = null;
const order: string[] = [];
const url = "https://quiz.example/exam";
const session = { getState: () => ({ status: auth }), subscribe: (fn: () => void) => { sessionListeners.add(fn); return () => { sessionListeners.delete(fn); }; } };
const publishLive = (message: unknown) => { for (const listener of listeners) listener(message as Record<string, unknown>, { tab: { id: 7, url }, frameId: 0 } as chrome.runtime.MessageSender); };

beforeEach(() => {
  listeners.clear(); sessionListeners.clear(); order.length = 0; auth = "authenticated"; response = null;
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  runtime = createCandidateWorkspaceRuntime({ url: () => url, send: publishLive, runtimeInstanceId: "hook-runtime", runtimeGeneration: 1 });
  vi.stubGlobal("chrome", {
    runtime: { onMessage: { addListener: (fn: typeof publishLive) => { order.push("listener"); listeners.add(fn); }, removeListener: (fn: typeof publishLive) => listeners.delete(fn) } },
    tabs: { query: async () => { order.push("origin"); return [{ id: 7, url, active: true }]; }, get: async (id: number) => ({ id, url }),
      sendMessage: (_tabId: number, message: { type: string; expectedUrl: string }, callback: (value: unknown) => void) => {
        order.push(message.type);
        if (response) void response.then(callback);
        else callback(runtime.snapshot(message.expectedUrl));
      } },
    storage: { session: {
      get: async () => ({ ...sessionStore }), set: async (items: Record<string, unknown>) => Object.assign(sessionStore, items),
      remove: async (key: string) => { delete sessionStore[key]; },
    } },
  });
});

function Workspace() {
  const [state, dispatch] = useReducer(sidePanelAppReducer, initialSidePanelAppState);
  const publish = useCallback((status: WorkspaceHydrationStatus, snapshot?: CandidateWorkspaceSnapshot, origin?: CandidateOrigin) => dispatch({ type: "hydrateWorkspace", status, snapshot, origin }), []);
  useCandidateWorkspaceHydration(session, publish);
  const status = deriveSidePanelWorkspaceStatus({ ...state, authStatus: auth === "authenticated" ? "authenticated" : "unauthenticated", isAuthenticated: auth === "authenticated" });
  return <div><output data-testid="hydration">{state.hydrationStatus}</output><output data-testid="status">{status}</output><output data-testid="detection">{state.detectionPhase}</output><output data-testid="running">{String(state.isAutoSolving)}</output></div>;
}

describe("UI-04A real hydration hook/reducer contract", () => {
  it("UI04A-03 listener is installed before origin resolution and snapshot dispatch", async () => {
    runtime.setAutoSolveRunning(true);
    render(<Workspace />);
    await waitFor(() => expect(screen.getByTestId("hydration")).toHaveTextContent("ready"));
    expect(order.indexOf("listener")).toBeLessThan(order.indexOf("origin"));
    expect(order.indexOf("listener")).toBeLessThan(order.indexOf("GET_CANDIDATE_WORKSPACE_SNAPSHOT"));
    expect(screen.getByTestId("running")).toHaveTextContent("true");
    expect(screen.getByTestId("status")).toHaveTextContent("solving");
  });
  it("UI04A-02 opening restores completed-empty through the real hook and reducer", async () => {
    runtime.beginDetection("viewport"); runtime.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    render(<Workspace />);
    await waitFor(() => expect(screen.getByTestId("hydration")).toHaveTextContent("ready"));
    expect(screen.getByTestId("detection")).toHaveTextContent("completed");
  });
  it("UI04A-10 pending snapshot shows runtime syncing, not authentication-server-unavailable or Ready", () => {
    response = new Promise(() => undefined);
    render(<Workspace />);
    expect(screen.getByTestId("status")).toHaveTextContent("syncing_runtime");
  });
  it("UI04A-12/18 snapshot cannot alter multi-tab owners; auth-loss STOP/CANCEL still targets every owner", async () => {
    await markProtectedWorkOwner("autoSolve", 7); await markProtectedWorkOwner("autoSolve", 8); await markProtectedWorkOwner("fullPage", 9);
    const before = await readProtectedWorkOwners();
    render(<Workspace />);
    await waitFor(() => expect(screen.getByTestId("hydration")).toHaveTextContent("ready"));
    expect(await readProtectedWorkOwners()).toEqual(before);
    await act(async () => { auth = "unauthenticated"; for (const fn of sessionListeners) fn(); });
    const send = vi.fn(async () => undefined);
    await terminateRecordedProtectedWork(send);
    expect(send.mock.calls).toEqual([[7, { type: "STOP_AUTO_SOLVE_ALL" }], [8, { type: "STOP_AUTO_SOLVE_ALL" }], [9, { type: "FULL_PAGE_DETECT_CANCELLED" }]]);
    expect(screen.getByTestId("hydration")).toHaveTextContent("idle");
  });
  it("UI04A-11 before server authentication no snapshot dispatch or projection is permitted", async () => {
    auth = "unauthenticated";
    runtime.setAutoSolveRunning(true);
    render(<Workspace />);
    await act(async () => { runtime.setAutoSolveRunning(true); });
    expect(order).toEqual(["listener"]);
    expect(screen.getByTestId("status")).toHaveTextContent("signed_out");
    expect(screen.getByTestId("running")).toHaveTextContent("false");
  });
});
