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

type RuntimeHandle = {
  listener: RuntimeListener;
  dispose: () => void;
};

type RuntimeBootstrapModule = {
  bootstrapContentRuntime: (options?: { onShutdown?: () => void }) => RuntimeHandle;
};

let runtimeHandlePromise: Promise<RuntimeHandle> | null = null;
let bootstrapListenerInstalled = false;

async function ensureRuntimeHandle(): Promise<RuntimeHandle> {
  if (!runtimeHandlePromise) {
    const runtimeUrl = chrome.runtime.getURL("content/contentRuntimeBootstrap.js");
    runtimeHandlePromise = import(/* @vite-ignore */ runtimeUrl)
      .then((module) => (module as RuntimeBootstrapModule).bootstrapContentRuntime({
        onShutdown: () => {
          runtimeHandlePromise = null;
          installBootstrapListener();
        },
      }))
      .catch((error) => {
        runtimeHandlePromise = null;
        throw error;
      });
  }
  return runtimeHandlePromise;
}

const bootstrapListener = (message: ExtMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
  if (!BOOTSTRAP_MESSAGE_TYPES.has(message.type)) return false;

  void ensureRuntimeHandle()
    .then((runtimeHandle) => {
      removeBootstrapListener();
      return runtimeHandle.listener(message, sender, sendResponse);
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

function installBootstrapListener() {
  if (bootstrapListenerInstalled) return;
  chrome.runtime.onMessage.addListener(bootstrapListener);
  bootstrapListenerInstalled = true;
}

function removeBootstrapListener() {
  if (!bootstrapListenerInstalled) return;
  chrome.runtime.onMessage.removeListener(bootstrapListener);
  bootstrapListenerInstalled = false;
}

installBootstrapListener();
