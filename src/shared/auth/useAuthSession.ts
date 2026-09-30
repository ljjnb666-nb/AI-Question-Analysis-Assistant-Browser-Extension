import { useEffect, useState, useSyncExternalStore } from "react";
import { validateAuthSession } from "@/shared/utils/auth";
import { loadSettings } from "@/shared/utils/storage";
import { createAuthSessionCoordinator, type AuthSessionCoordinator } from "./authSessionCoordinator";

function subscribeToAppSettingsChanges(listener: () => void): () => void {
  const handler = (changes: { [key: string]: unknown }, areaName: string) => {
    if (areaName !== "local" || !changes.appSettings) return;
    // Defer to a microtask so listeners registered earlier in this context —
    // notably the settings cache invalidation in storage.ts — run first. The
    // coordinator must re-read FRESH settings, never the snapshot from before
    // the change, or a logout broadcast would be mistaken for a no-op.
    queueMicrotask(() => {
      // Never trust the stored values directly: hand the event to the
      // coordinator, which re-reads settings and reconciles against the
      // server.
      listener();
    });
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/**
 * Shared, server-authoritative auth session state for a UI surface. The
 * coordinator is created once per surface instance and converges with other
 * surfaces through chrome.storage change notifications.
 */
export function useAuthSession(): AuthSessionCoordinator {
  const [coordinator] = useState(() =>
    createAuthSessionCoordinator({
      loadSettings,
      validateAuthSession,
      subscribeToStorageChanges: subscribeToAppSettingsChanges,
    }),
  );

  useSyncExternalStore(coordinator.subscribe, coordinator.getState, coordinator.getState);

  useEffect(() => {
    coordinator.start();
    return () => coordinator.dispose();
  }, [coordinator]);

  return coordinator;
}
