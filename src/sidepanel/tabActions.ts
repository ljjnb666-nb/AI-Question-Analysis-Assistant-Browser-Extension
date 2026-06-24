import type { ExtMessage, ParseResult, QuestionBlock } from "@/shared/types";

type FillResponse = { ok?: boolean; filledCount?: number; message?: string } | null;
type VerifyResponse = { ok?: boolean; expectedKeys?: string[]; actualKeys?: string[]; message?: string } | null;

export function shouldBootstrapContentScript(error: unknown): boolean {
  const text = String(error || "");
  return /Receiving end does not exist|Could not establish connection/i.test(text);
}

export async function injectContentScriptIntoTab(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content-main.js"],
    });
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    return true;
  } catch (err) {
    console.warn("[SidePanel] content bootstrap failed:", err);
    return false;
  }
}

export async function sendRawTabMessage<T = unknown>(
  tabId: number,
  message: ExtMessage,
): Promise<{ ok: boolean; response?: T; error?: string }> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (resp?: T) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message || "unknown tabs.sendMessage error",
        });
        return;
      }
      resolve({ ok: true, response: resp });
    });
  });
}

export async function sendTabMessageWithBootstrap<T = unknown>(
  tabId: number,
  message: ExtMessage,
): Promise<{ ok: boolean; response?: T; error?: string }> {
  const first = await sendRawTabMessage<T>(tabId, message);
  if (first.ok || !shouldBootstrapContentScript(first.error)) return first;

  const injected = await injectContentScriptIntoTab(tabId);
  if (!injected) return first;

  return sendRawTabMessage<T>(tabId, message);
}

export async function getBestActionTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const pageTabs = tabs.filter((tab) => tab.id && /^https?:/i.test(String(tab.url || "")));
  if (!pageTabs.length) return null;

  const examTab = pageTabs.find((tab) => /answer-homework|exam-hub|atHomeworkExam|homeworkQ/i.test(String(tab.url || "")));
  if (examTab) return examTab;

  const activeTab = pageTabs.find((tab) => tab.active);
  if (activeTab) return activeTab;

  return [...pageTabs].sort(
    (a, b) =>
      (((b as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed) ?? 0)
      - (((a as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed) ?? 0),
  )[0] ?? null;
}

export async function requestBlockImage(tabId: number, bbox: QuestionBlock["bbox"]): Promise<string | null> {
  const resp = await sendTabMessageWithBootstrap<{ ok?: boolean; dataUrl?: string }>(
    tabId,
    { type: "CAPTURE_BLOCK_IMAGE", bbox },
  );
  return resp.response?.ok && resp.response.dataUrl ? resp.response.dataUrl : null;
}

export async function sendFillMessage(
  tabId: number,
  block: QuestionBlock,
  result: ParseResult,
): Promise<FillResponse> {
  const resp = await sendTabMessageWithBootstrap<{ ok?: boolean; filledCount?: number; message?: string }>(
    tabId,
    { type: "FILL_PARSED_ANSWER", block, result },
  );
  if (!resp.ok) {
    return {
      ok: false,
      filledCount: 0,
      message: resp.error || "填写消息发送失败",
    };
  }
  return resp.response ?? {
    ok: false,
    filledCount: 0,
    message: "页面未返回填写结果",
  };
}

export async function sendVerifyMessage(
  tabId: number,
  block: QuestionBlock,
  result: ParseResult,
): Promise<VerifyResponse> {
  const resp = await sendTabMessageWithBootstrap<{
    ok?: boolean;
    expectedKeys?: string[];
    actualKeys?: string[];
    message?: string;
  }>(
    tabId,
    { type: "VERIFY_PARSED_ANSWER", block, result },
  );
  if (!resp.ok) {
    return {
      ok: false,
      expectedKeys: [],
      actualKeys: [],
      message: resp.error || "校验消息发送失败",
    };
  }
  return resp.response ?? {
    ok: false,
    expectedKeys: [],
    actualKeys: [],
    message: "页面未返回校验结果",
  };
}

export async function sendFillMessageWithVerify(
  tabId: number,
  block: QuestionBlock,
  result: ParseResult,
  isChoiceLikeResult: (block: QuestionBlock, result: ParseResult) => boolean,
): Promise<FillResponse> {
  const firstFill = await sendFillMessage(tabId, block, result);
  if (!isChoiceLikeResult(block, result)) return firstFill;
  if (!firstFill?.ok) return firstFill;

  const firstVerify = await sendVerifyMessage(tabId, block, result);
  if (firstVerify?.ok) {
    return {
      ok: true,
      filledCount: firstFill.filledCount ?? 0,
      message: firstFill.ok && (firstFill.filledCount ?? 0) > 0 ? firstFill.message : firstVerify.message,
    };
  }

  const retryFill = await sendFillMessage(tabId, block, result);
  const retryVerify = await sendVerifyMessage(tabId, block, result);
  if (retryVerify?.ok) {
    return {
      ok: true,
      filledCount: (firstFill?.filledCount ?? 0) + (retryFill?.filledCount ?? 0),
      message: retryFill?.filledCount ? `重试后已纠正：${retryFill.message}` : `重试后已纠正：${retryVerify?.message || "校验通过"}`,
    };
  }

  return {
    ok: false,
    filledCount: (firstFill?.filledCount ?? 0) + (retryFill?.filledCount ?? 0),
    message: retryVerify?.message || firstVerify?.message || retryFill?.message || firstFill?.message || "填写后校验失败",
  };
}
