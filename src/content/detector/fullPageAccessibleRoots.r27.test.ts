import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectCandidatesFullPage, cancelFullPageScan, isFullPageScanRunning, type ScanProgress } from "./fullPageDetector";
import { sharedRootRegistry } from "../roots/rootRegistry";
import { rootAttachmentOf } from "../roots/rootContext";

const TEXT = "实验安全检查中哪种做法正确？ A. 核对设备 B. 跳过检查 C. 隐瞒告警 D. 删除记录";
const MARKUP = (id: string) => `
  <article class="question-item" data-question-id="${id}">
    <p class="stem">${TEXT}</p>
    <ul><li><button>A. 核对设备</button></li><li><button>B. 跳过检查</button></li>
    <li><button>C. 隐瞒告警</button></li><li><button>D. 删除记录</button></li></ul>
  </article>`;

function rect(el: Element, left = 20, top = 20, width = 640, height = 220): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: left, y: top, left, top, width, height,
      right: left + width, bottom: top + height, toJSON: () => ({}) }),
  });
}

function shadowQuestion(id = "r27-shadow"): HTMLElement {
  const host = document.createElement("quiz-question-host");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = MARKUP(id);
  rect(host, 10, 10, 680, 270);
  rect(shadow.querySelector(".question-item")!, 20, 20, 640, 220);
  return host;
}

function frameQuestion(id = "r27-frame"): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.body.innerHTML = MARKUP(id);
  rect(frame, 0, 0, 800, 600);
  for (const [field, value] of Object.entries({
    clientWidth: 800, offsetWidth: 800, clientHeight: 600, offsetHeight: 600,
    clientLeft: 0, clientTop: 0,
  })) Object.defineProperty(frame, field, { configurable: true, value });
  rect(doc.querySelector(".question-item")!, 20, 20, 640, 220);
  return frame;
}

describe("Issue #102 R27: full-page scan retains accessible non-top-root questions", () => {
  let scrollTo: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    sharedRootRegistry().reset();
    document.body.innerHTML = "<main></main>";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1100 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(document.body, "scrollHeight", { configurable: true, value: 600 });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 600 });
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });
  afterEach(() => {
    cancelFullPageScan();
    sharedRootRegistry().reset();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("R27-01 discovers one open ShadowRoot-only question in the same fixed viewport", async () => {
    shadowQuestion();
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    const blocks = await scan;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.previewText).toContain("核对设备");
    expect(rootAttachmentOf(blocks[0]!).kind).toBe("open-shadow-root");
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(progress[0]?.totalScrollSteps).toBe(1);
    expect(progress[0]?.found).toBe(1);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R27-02 finds same-origin iframe-only question with root identity intact", async () => {
    frameQuestion();
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    const blocks = await scan;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.previewText).toContain("核对设备");
    expect(rootAttachmentOf(blocks[0]!).kind).toBe("same-origin-frame");
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(progress[0]?.totalScrollSteps).toBe(1);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R27-03 does not erase identical question text and overlapping coordinates in distinct roots", async () => {
    shadowQuestion("same-native-id");
    frameQuestion("same-native-id");
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    const blocks = await scan;
    expect(blocks).toHaveLength(2);
    expect(new Set(blocks.map((b) => rootAttachmentOf(b).rootKey)).size).toBe(2);
    expect(blocks.every((b) => b.previewText.includes("核对设备"))).toBe(true);
    expect(progress).toHaveLength(1);
    expect(progress[0]?.totalScrollSteps).toBe(1);
  });

  it("R27-04 CANCEL during the bounded observation fences results and progress", async () => {
    shadowQuestion();
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.advanceTimersByTimeAsync(350);
    cancelFullPageScan();
    const priorScrollCount = scrollTo.mock.calls.length;
    await vi.runAllTimersAsync();
    // Collected candidates may be retained on cancel, but no progress/scroll
    // is authorized after STOP and no cancelled run restores the old position.
    expect(progress).toEqual([]);
    expect(scrollTo).toHaveBeenCalledTimes(priorScrollCount);
    expect(isFullPageScanRunning()).toBe(false);
    await scan;
  });
});
