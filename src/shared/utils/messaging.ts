import type { ExtMessage, MessageType } from "../types";

export function sendToBackground<R = unknown>(message: ExtMessage): Promise<R> {
  return chrome.runtime.sendMessage(message) as Promise<R>;
}

export function shouldBootstrapContentScript(error: unknown): boolean {
  const text = String(error || "");
  return /Receiving end does not exist|Could not establish connection/i.test(text);
}

export function isInjectablePageUrl(url: string | undefined): boolean {
  return /^https?:/i.test(String(url || ""));
}

export async function injectContentScriptIntoTab(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/content-main.js"],
  });
}

/**
 * Authority guard contract for protected dispatches (AUTH-UI-INV-12): the
 * guard runs at every await boundary — after the tab lookup, immediately
 * before the first send, before the bootstrap injection, and immediately
 * before the retry send — so a session that lapses mid-flight can never
 * complete the dispatch. STOP/CANCEL callers must NOT pass a guard:
 * termination has to stay executable after an auth loss.
 */
export async function sendToTabWithBootstrap<R = unknown>(
  tabId: number,
  message: ExtMessage,
  guard?: () => boolean,
): Promise<R> {
  if (guard && !guard()) throw new Error("AUTHORITY_LOST");
  try {
    return await (chrome.tabs.sendMessage(tabId, message) as Promise<R>);
  } catch (error) {
    if (!shouldBootstrapContentScript(error)) throw error;
    if (guard && !guard()) throw authorityLostDuring(error, "bootstrap");
    await injectContentScriptIntoTab(tabId);
    if (guard && !guard()) throw authorityLostDuring(error, "retry");
    return chrome.tabs.sendMessage(tabId, message) as Promise<R>;
  }
}

function authorityLostDuring(cause: unknown, stage: string): Error {
  const authorityLost = new Error(`AUTHORITY_LOST_DURING_${stage.toUpperCase()}`);
  (authorityLost as Error & { cause?: unknown }).cause = cause;
  return authorityLost;
}

/**
 * The optional guard is the last-responsible-moment authority check for
 * protected dispatches: it runs again after the tab lookup await, before the
 * first send, before the bootstrap injection, and before the retry send.
 */
export async function sendToActiveTab<R = unknown>(message: ExtMessage, guard?: () => boolean): Promise<R> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found");
  if (!isInjectablePageUrl(tab.url)) {
    throw new Error("Active tab does not allow extension injection");
  }
  // TOCTOU closure: the tab lookup awaited, so the authority must hold again
  // before the first send is attempted.
  if (guard && !guard()) throw new Error("AUTHORITY_LOST");
  return sendToTabWithBootstrap(tab.id, message, guard);
}

export function sendToTab<R = unknown>(tabId: number, message: ExtMessage): Promise<R> {
  return sendToTabWithBootstrap(tabId, message);
}

type MessageHandler<T extends ExtMessage = ExtMessage> = (
  message: T,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | void | Promise<unknown>;

export function onMessage<T extends ExtMessage>(
  types: MessageType[],
  handler: MessageHandler<T>
): () => void {
  const listener = (
    message: ExtMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    if (types.includes(message.type)) {
      return handler(message as T, sender, sendResponse);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
