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
import { logEvent } from "@/shared/utils/analytics";
import { injectContentScriptIntoTab, isInjectablePageUrl, shouldBootstrapContentScript } from "@/shared/utils/messaging";
import { getOrCreateDeviceId } from "@/shared/utils/storage";

chrome.runtime.onInstalled.addListener((details) => {
  void getOrCreateDeviceId();
  if (details.reason === "install") {
    logEvent("extension_installed", { reason: details.reason });
  }
});

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

    case "REAL_CLICK":
      clickRealPoint(sender, message, sendResponse);
      return true;

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

async function clickRealPoint(
  sender: chrome.runtime.MessageSender,
  message: Extract<ExtMessage, { type: "REAL_CLICK" }>,
  sendResponse: (r?: unknown) => void,
) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ ok: false, error: "missing sender tab id" });
    return;
  }

  const target = { tabId };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (err) {
    const text = String(err);
    if (/Another debugger is already attached/i.test(text)) {
      sendResponse({
        ok: false,
        error: "tab is already being debugged by another session",
      });
    } else {
      sendResponse({ ok: false, error: text });
    }
    return;
  }

  try {
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.round(message.x),
      y: Math.round(message.y),
      button: "none",
      buttons: 0,
      clickCount: 0,
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: Math.round(message.x),
      y: Math.round(message.y),
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: Math.round(message.x),
      y: Math.round(message.y),
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    sendResponse({ ok: true });
  } catch (err) {
    sendResponse({ ok: false, error: String(err) });
  } finally {
    try {
      await chrome.debugger.detach(target);
    } catch {
      // Ignore detach races when another call already released it.
    }
  }
}

async function relayToActiveTab(message: ExtMessage) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && isInjectablePageUrl(tab.url)) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch (err) {
        if (!shouldBootstrapContentScript(err)) throw err;
        await injectContentScriptIntoTab(tab.id);
        await chrome.tabs.sendMessage(tab.id, message);
      }
    }
  } catch (err) {
    console.warn("[BG] relay to active tab failed:", err);
  }
}
