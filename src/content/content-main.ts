import type { ExtMessage, MessageType } from "@/shared/types";

const BOOTSTRAP_MESSAGE_TYPES = new Set<MessageType>([
  "START_MANUAL_CAPTURE",
  "CANCEL_MANUAL_CAPTURE",
  "CLOSE_FLOATING_RESULT",
  "START_AUTO_DETECT",
  "HIGHLIGHT_CANDIDATE",
  "UPDATE_CANDIDATE_SELECTION",
  "CLEAR_HIGHLIGHTS",
  "START_FULL_PAGE_DETECT",
  "FULL_PAGE_DETECT_CANCELLED",
  "CAPTURE_BLOCK_IMAGE",
  "FILL_PARSED_ANSWER",
  "VERIFY_PARSED_ANSWER",
  "START_AUTO_SOLVE_ALL",
  "STOP_AUTO_SOLVE_ALL",
]);

type RuntimeListener = (
  message: ExtMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean;

type RuntimeBootstrapModule = {
  bootstrapContentRuntime: () => RuntimeListener;
};

let runtimeListenerPromise: Promise<RuntimeListener> | null = null;

async function ensureRuntimeListener(): Promise<RuntimeListener> {
  if (!runtimeListenerPromise) {
    const runtimeUrl = chrome.runtime.getURL("content/contentRuntimeBootstrap.js");
    runtimeListenerPromise = import(/* @vite-ignore */ runtimeUrl)
      .then((module) => (module as RuntimeBootstrapModule).bootstrapContentRuntime())
      .catch((error) => {
        runtimeListenerPromise = null;
        throw error;
      });
  }
  return runtimeListenerPromise;
}

const bootstrapListener = (message: ExtMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
  if (!BOOTSTRAP_MESSAGE_TYPES.has(message.type)) return false;

  void ensureRuntimeListener()
    .then((runtimeListener) => {
      chrome.runtime.onMessage.removeListener(bootstrapListener);
      return runtimeListener(message, sender, sendResponse);
    })
    .catch((error) => {
      console.error("[ContentBootstrap] failed to load runtime:", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  return true;
};

chrome.runtime.onMessage.addListener(bootstrapListener);
