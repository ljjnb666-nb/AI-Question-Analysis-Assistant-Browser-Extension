/**
 * Background Service Worker
 * Responsibilities:
 *  - Take tab screenshots (requires background context)
 *  - Relay START_MANUAL_CAPTURE to active tab when called from popup
 *
 * NOTE: sidePanel.open() is intentionally NOT handled here.
 * It must be called in the popup's user-gesture context directly,
 * because chrome.sidePanel.open() requires a synchronous user gesture chain.
 */

import type { ExtMessage } from "@/shared/types";

chrome.runtime.onMessage.addListener((
  message: ExtMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (r?: unknown) => void
) => {
  switch (message.type) {
    case "CAPTURE_TAB_SCREENSHOT":
      captureTab(sender, sendResponse);
      return true; // keep channel open for async response

    case "START_MANUAL_CAPTURE":
      // Relay from popup to active tab's content script
      relayToActiveTab(message);
      return false;

    case "LOG_EVENT":
      // No-op in background; events are stored in content script context
      return false;

    default:
      return false;
  }
});

async function captureTab(
  sender: chrome.runtime.MessageSender,
  sendResponse: (r?: unknown) => void
) {
  try {
    let windowId = sender.tab?.windowId;
    if (!windowId) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      windowId = activeTab?.windowId;
    }
    if (!windowId) {
      const currentWin = await chrome.windows.getCurrent();
      if (currentWin.id) {
        const dataUrl = await chrome.tabs.captureVisibleTab(currentWin.id, { format: "png" });
        sendResponse({ dataUrl });
        return;
      }
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    sendResponse({ dataUrl });
  } catch (err) {
    console.error("[BG] captureVisibleTab failed:", err);
    sendResponse({ error: String(err) });
  }
}

async function relayToActiveTab(message: ExtMessage) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, message);
    }
  } catch (err) {
    console.warn("[BG] relay to active tab failed:", err);
  }
}
