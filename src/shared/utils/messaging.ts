import type { ExtMessage, MessageType } from "../types";

export function sendToBackground<R = unknown>(message: ExtMessage): Promise<R> {
  return chrome.runtime.sendMessage(message) as Promise<R>;
}

export async function sendToActiveTab<R = unknown>(message: ExtMessage): Promise<R> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found");
  return chrome.tabs.sendMessage(tab.id, message) as Promise<R>;
}

export function sendToTab<R = unknown>(tabId: number, message: ExtMessage): Promise<R> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<R>;
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
