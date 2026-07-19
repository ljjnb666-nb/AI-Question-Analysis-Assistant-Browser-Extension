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

export async function sendToTabWithBootstrap<R = unknown>(tabId: number, message: ExtMessage): Promise<R> {
  try {
    return await (chrome.tabs.sendMessage(tabId, message) as Promise<R>);
  } catch (error) {
    if (!shouldBootstrapContentScript(error)) throw error;
    await injectContentScriptIntoTab(tabId);
    return chrome.tabs.sendMessage(tabId, message) as Promise<R>;
  }
}

export async function sendToActiveTab<R = unknown>(message: ExtMessage): Promise<R> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found");
  if (!isInjectablePageUrl(tab.url)) {
    throw new Error("Active tab does not allow extension injection");
  }
  return sendToTabWithBootstrap(tab.id, message);
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
