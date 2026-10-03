import type { ExtMessage, MessageType } from "@/shared/types";

const BOOTSTRAP_MESSAGE_TYPES = new Set<MessageType>([
  "GET_CANDIDATE_WORKSPACE_SNAPSHOT",
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

export type RuntimeMessageListener = (
  message: ExtMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean;

export type RuntimeHandle = {
  listener: RuntimeMessageListener;
  dispose: () => void;
};

export type RuntimeBootstrapModule = {
  bootstrapContentRuntime: (options?: { onShutdown?: () => void }) => RuntimeHandle;
};

type RuntimeMessagePort = {
  addListener: (listener: RuntimeMessageListener) => void;
  removeListener: (listener: RuntimeMessageListener) => void;
};

/** Own the lazy content-main listener and its symmetric runtime re-arm path. */
export function installContentMainBootstrapListener(
  onMessage: RuntimeMessagePort,
  loadBootstrapModule: () => Promise<RuntimeBootstrapModule>,
): () => void {
  let runtimeHandlePromise: Promise<RuntimeHandle> | null = null;
  let bootstrapListenerInstalled = false;

  const installBootstrapListener = () => {
    if (bootstrapListenerInstalled) return;
    onMessage.addListener(bootstrapListener);
    bootstrapListenerInstalled = true;
  };

  const removeBootstrapListener = () => {
    if (!bootstrapListenerInstalled) return;
    onMessage.removeListener(bootstrapListener);
    bootstrapListenerInstalled = false;
  };

  const ensureRuntimeHandle = (): Promise<RuntimeHandle> => {
    if (!runtimeHandlePromise) {
      runtimeHandlePromise = loadBootstrapModule()
        .then((module) => module.bootstrapContentRuntime({
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
  };

  const bootstrapListener: RuntimeMessageListener = (message, sender, sendResponse) => {
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

  installBootstrapListener();
  return removeBootstrapListener;
}
