import type { QuestionCompleteness, QuestionType } from "@/shared/types";
import type { QuestionBoundaryState } from "@/shared/types/questionBoundary";
import type { MediaOwnershipRole, MediaSourceKind } from "@/shared/types/mediaAsset";

export type CompatibilitySourceKind = "real-platform-derived" | "synthetic-framework" | "historical-regression";
export type CompatibilityCategory = "SUPPORTED" | "KNOWN_SAFE_LIMITATION" | "KNOWN_ARCHITECTURE_LIMITATION" | "UNSUPPORTED_BY_BROWSER_SECURITY";
export type CompatibilityRootMode = "top-document" | "same-origin-frame" | "open-shadow-root" | "iframe-open-shadow";
export type CompatibilityPath =
  | { kind: "generic-path"; siteBranch: "not-applicable" }
  | { kind: "site-specialized-path"; siteBranch: "polymas-zhihuishu-right-cut" | "pintia-programming" | "pintia-question-list" };
export type CompatibilityCompleteness = Pick<QuestionCompleteness,
  "state" | "boundaryComplete" | "stemComplete" | "optionsComplete" | "visualComplete" | "controlsComplete">;
export type FillSupportContract =
  | { capability: "supported"; answer: string; expectedFilledCount: number }
  | { capability: "withheld"; answer: string; expectedFailure: string }
  | {
      capability: "known-safe-limitation";
      answer: string;
      expectedFailure: string;
      stateAfterFailure: "unchanged" | "requested-answer-selected-by-pointerdown";
    }
  | { capability: "not-applicable" };

export type CompatibilityFixtureQuestion = {
  ownerId: string;
  type: QuestionType;
  previewContains: string[] | "not-applicable";
  previewExcludes: string[] | "not-applicable";
  identityBehavior: "single-observation" | "media-sensitive" | "stable-after-equivalent-rerender" | "changes-on-virtual-reuse";
  completeness: CompatibilityCompleteness;
  boundary: { state: QuestionBoundaryState; clippedTop: boolean; clippedBottom: boolean };
  mediaOwnership: Array<{ role: MediaOwnershipRole | "not-applicable"; count: number; optionKey?: string | "not-applicable"; sourceKinds?: MediaSourceKind[] | "not-applicable" }>;
  optionKeys: string[] | "not-applicable";
  controlMapping: { capability: "supported" | "safe-rejection" | "known-limitation" | "not-applicable"; optionKeys: string[] | "not-applicable" };
  fillSupport: FillSupportContract;
  rootKind: "top-document" | "same-origin-frame" | "open-shadow-root" | "open-shadow-root-in-same-origin-frame";
  displaySegmentRoles: string[] | "not-applicable";
};

export type CompatibilityFixture = {
  fixtureId: string;
  sourceKind: CompatibilitySourceKind;
  platformFamily: "generic" | "pintia" | "zhihuishu" | "polymas" | "react" | "vue";
  scenario: string;
  path: CompatibilityPath;
  category: CompatibilityCategory;
  pageUrl: string;
  viewport: { width: number; height: number };
  rootMode: CompatibilityRootMode;
  html: string;
  questionRects: Record<string, { left: number; top: number; width: number; height: number }>;
  currentSrcOverrides?: Array<{ selector: string; value: string }>;
  interactionTrigger?: "pointerdown";
  transition?:
    | { kind: "replace-owner"; ownerId: string; replacementHtml: string; afterOwnerId: string; afterPreviewContains: string[] }
    | { kind: "recycle-owner"; ownerId: string; nativeQuestionId: string; innerHtml: string; afterPreviewContains: string[] };
  expectedQuestionCount: number;
  expectedQuestions: CompatibilityFixtureQuestion[];
  expectedWithheld?: { ownerId: string; reason: string; previewSignal: string; boundaryState: QuestionBoundaryState; completenessState: QuestionCompleteness["state"] };
  validationReference?: string;
};

const COMPLETE_BOUNDARY = { state: "complete", clippedTop: false, clippedBottom: false } as const;
const COMPLETE_COMPLETENESS: CompatibilityCompleteness = {
  state: "complete", boundaryComplete: true, stemComplete: true, optionsComplete: true,
  visualComplete: true, controlsComplete: true,
};
const COMPLETE_JUDGE_COMPLETENESS: CompatibilityCompleteness = { ...COMPLETE_COMPLETENESS, optionsComplete: true };
const COMPLETE_SHORT_ANSWER_COMPLETENESS: CompatibilityCompleteness = { ...COMPLETE_COMPLETENESS, optionsComplete: true };

function choiceQuestion(
  ownerId: string,
  previewContains: string[],
  overrides: Partial<CompatibilityFixtureQuestion> = {},
): CompatibilityFixtureQuestion {
  return {
    ownerId,
    type: "single_choice",
    previewContains,
    previewExcludes: "not-applicable",
    identityBehavior: "single-observation",
    completeness: COMPLETE_COMPLETENESS,
    boundary: COMPLETE_BOUNDARY,
    mediaOwnership: [{ role: "not-applicable", count: 0, optionKey: "not-applicable", sourceKinds: "not-applicable" }],
    optionKeys: ["A", "B", "C", "D"],
    controlMapping: { capability: "supported", optionKeys: ["A", "B", "C", "D"] },
    fillSupport: { capability: "supported", answer: "B", expectedFilledCount: 1 },
    rootKind: "top-document",
    displaySegmentRoles: "not-applicable",
    ...overrides,
  };
}

function judgeQuestion(ownerId: string, previewContains: string[], previewExcludes: string[] = []): CompatibilityFixtureQuestion {
  return {
    ownerId, type: "judge", previewContains, previewExcludes, identityBehavior: "single-observation",
    completeness: COMPLETE_JUDGE_COMPLETENESS, boundary: COMPLETE_BOUNDARY,
    mediaOwnership: [{ role: "not-applicable", count: 0, optionKey: "not-applicable", sourceKinds: "not-applicable" }],
    optionKeys: "not-applicable", controlMapping: { capability: "not-applicable", optionKeys: "not-applicable" },
    fillSupport: { capability: "not-applicable" }, rootKind: "top-document", displaySegmentRoles: "not-applicable",
  };
}

function supportedJudgeQuestion(ownerId: string, previewContains: string[]): CompatibilityFixtureQuestion {
  return {
    ...judgeQuestion(ownerId, previewContains),
    optionKeys: ["A", "B"],
    controlMapping: { capability: "supported", optionKeys: ["A", "B"] },
    fillSupport: { capability: "supported", answer: "对", expectedFilledCount: 1 },
  };
}

const generic = { kind: "generic-path", siteBranch: "not-applicable" } as const;
const questionMarkup = (id: string, questionId: string, stem: string, optionLabels = ["A. Amber", "B. Blue", "C. Green", "D. Gray"]) =>
  `<section id="${id}" class="question-item" data-question-id="${questionId}"><h3 class="questionTit">Single choice</h3><div class="stem">${stem}</div><ul>${optionLabels.map((label) => `<li><button class="option" role="radio" aria-checked="false">${label}</button></li>`).join("")}</ul></section>`;

export const COMPATIBILITY_FIXTURES: CompatibilityFixture[] = [
  {
    fixtureId: "COMPAT-01", sourceKind: "synthetic-framework", platformFamily: "polymas",
    scenario: "Static single-choice card beside an answer panel", path: { kind: "site-specialized-path", siteBranch: "polymas-zhihuishu-right-cut" },
    category: "SUPPORTED", pageUrl: "https://exam.polymas.com/quiz/fixture",
    viewport: { width: 1600, height: 900 }, rootMode: "top-document",
    html: `<main id="page"><section id="static-question" class="question-item" data-question-id="static-01"><h3 class="questionTit">Single choice</h3><div class="stem">Which neutral color is named first? Choose one answer.</div><ul><li><button class="option" role="radio">A. Amber</button></li><li><button class="option" role="radio">B. Blue</button></li><li><button class="option" role="radio">C. Green</button></li><li><button class="option" role="radio">D. Gray</button></li></ul></section><aside id="score-panel">总分 10 题目数 1</aside><aside id="answer-card">答题卡 当前题目 1</aside></main>`,
    questionRects: {
      "static-question": { left: 240, top: 170, width: 800, height: 300 },
      "score-panel": { left: 1130, top: 170, width: 220, height: 120 },
      "answer-card": { left: 1130, top: 330, width: 240, height: 360 },
    },
    expectedQuestionCount: 1,
    expectedQuestions: [choiceQuestion("static-question", ["Which neutral color is named first?", "D. Gray"], { previewExcludes: ["答题卡", "总分", "题目数"] })],
  },
  {
    fixtureId: "COMPAT-02", sourceKind: "historical-regression", platformFamily: "generic",
    scenario: "Partial prior card at viewport top followed by a complete question", path: generic, category: "SUPPORTED",
    pageUrl: "https://example.test/quiz/partial-top", viewport: { width: 1280, height: 900 }, rootMode: "top-document",
    html: `<section id="prior-fragment" class="questionBox"><h3 id="prior-title" class="questionTit">Question 30</h3><div class="stem">Previous item tails only: C. Green D. Gray</div></section>${questionMarkup("next-question", "next-31", "Question 31 asks which neutral color follows amber? Choose one.")}`,
    questionRects: { "prior-fragment": { left: 80, top: -150, width: 820, height: 260 }, "next-question": { left: 80, top: 160, width: 820, height: 310 } },
    expectedQuestionCount: 1,
    expectedQuestions: [choiceQuestion("next-question", ["Question 31 asks", "D. Gray"], { previewExcludes: ["Previous item tails only", "Question 30"] })],
  },
  {
    fixtureId: "COMPAT-03", sourceKind: "synthetic-framework", platformFamily: "zhihuishu",
    scenario: "Bottom-clipped card whose lower option is not rendered in the viewport DOM", path: { kind: "site-specialized-path", siteBranch: "polymas-zhihuishu-right-cut" }, category: "SUPPORTED",
    pageUrl: "https://hiexam.zhihuishu.com/atHomeworkExam/stu/homeworkQ/exerciseList/partial-bottom", viewport: { width: 1600, height: 900 }, rootMode: "top-document",
    html: `<section id="partial-bottom" class="question-item" data-question-id="partial-32"><h3 class="questionTit">Single choice</h3><div class="stem">Question 32 asks which neutral color follows amber? Choose one answer.</div><ul><li><button class="option" role="radio">A. Amber</button></li><li><button class="option" role="radio">B. Blue</button></li><li><button class="option" role="radio">C. Green</button></li></ul></section><aside id="partial-score">总分 10 题目数 1</aside><aside id="partial-answer-card">答题卡 当前题目 1</aside>`,
    questionRects: { "partial-bottom": { left: 80, top: 570, width: 820, height: 500 }, "partial-score": { left: 1130, top: 170, width: 220, height: 120 }, "partial-answer-card": { left: 1130, top: 330, width: 240, height: 360 } },
    expectedQuestionCount: 0, expectedQuestions: [],
    expectedWithheld: { ownerId: "partial-bottom", reason: "Bottom-clipped question lacks its lower option in the mounted DOM and must not be promoted as complete", previewSignal: "Question 32 asks", boundaryState: "partial-bottom", completenessState: "incomplete" },
  },
  {
    fixtureId: "COMPAT-04", sourceKind: "synthetic-framework", platformFamily: "generic",
    scenario: "Question stem image", path: generic, category: "SUPPORTED", pageUrl: "https://example.test/quiz/stem-image",
    viewport: { width: 1280, height: 900 }, rootMode: "top-document",
    html: `<section id="stem-image-question" class="question-item" data-question-id="stem-image-04"><h3 class="questionTit">Single choice</h3><div class="stem">According to the diagram, which neutral color is shown? Choose one.<figure><img id="stem-diagram" src="https://assets.example.test/diagram-neutral-a.png" alt="A neutral color diagram"></figure></div><ul><li><button class="option" role="radio">A. Amber</button></li><li><button class="option" role="radio">B. Blue</button></li><li><button class="option" role="radio">C. Green</button></li><li><button class="option" role="radio">D. Gray</button></li></ul></section>`,
    questionRects: { "stem-image-question": { left: 80, top: 100, width: 820, height: 440 } },
    expectedQuestionCount: 1,
    expectedQuestions: [choiceQuestion("stem-image-question", ["According to the diagram", "D. Gray"], {
      identityBehavior: "media-sensitive", mediaOwnership: [{ role: "stem", count: 1, optionKey: "not-applicable", sourceKinds: ["img-current-src"] }],
    })],
  },
  {
    fixtureId: "COMPAT-05", sourceKind: "synthetic-framework", platformFamily: "generic",
    scenario: "Each choice owns its own image", path: generic, category: "SUPPORTED", pageUrl: "https://example.test/quiz/option-images",
    viewport: { width: 1280, height: 900 }, rootMode: "top-document",
    html: `<section id="option-image-question" class="question-item" data-question-id="option-image-05"><h3 class="questionTit">Single choice</h3><div class="stem">Which picture corresponds to each printed color name? Choose one.</div><ul><li><button class="option" role="radio">A. Amber <img src="https://assets.example.test/a.png" alt="Amber swatch"></button></li><li><button class="option" role="radio">B. Blue <img src="https://assets.example.test/b.png" alt="Blue swatch"></button></li><li><button class="option" role="radio">C. Green <img src="https://assets.example.test/c.png" alt="Green swatch"></button></li><li><button class="option" role="radio">D. Gray <img src="https://assets.example.test/d.png" alt="Gray swatch"></button></li></ul></section>`,
    questionRects: { "option-image-question": { left: 80, top: 100, width: 820, height: 500 } },
    expectedQuestionCount: 1,
    expectedQuestions: [choiceQuestion("option-image-question", ["Which picture corresponds", "D. Gray"], {
      identityBehavior: "media-sensitive", mediaOwnership: ["A", "B", "C", "D"].map((optionKey) => ({ role: "option", optionKey, count: 1, sourceKinds: ["img-current-src"] })),
    })],
  },
  {
    fixtureId: "COMPAT-06", sourceKind: "synthetic-framework", platformFamily: "generic",
    scenario: "Lazy image data-src plus picture/currentSrc", path: generic, category: "SUPPORTED", pageUrl: "https://example.test/quiz/lazy-media",
    viewport: { width: 1280, height: 900 }, rootMode: "top-document",
    html: `<section id="lazy-media-question" class="question-item" data-question-id="lazy-media-06"><h3 class="questionTit">Single choice</h3><div class="stem">Look at the diagram and choose the neutral color shown. <picture><source type="image/webp" srcset="https://assets.example.test/diagram-selected.webp"><img id="picture-current" data-src="https://assets.example.test/diagram-fallback.png" alt="Selected diagram"></picture><img id="lazy-image" data-src="https://assets.example.test/lazy-detail.png" alt="Lazy detail"></div><ul><li><button class="option" role="radio">A. Amber</button></li><li><button class="option" role="radio">B. Blue</button></li><li><button class="option" role="radio">C. Green</button></li><li><button class="option" role="radio">D. Gray</button></li></ul></section>`,
    questionRects: { "lazy-media-question": { left: 80, top: 100, width: 820, height: 460 } },
    currentSrcOverrides: [{ selector: "#picture-current", value: "https://assets.example.test/diagram-selected.webp" }],
    expectedQuestionCount: 1,
    expectedQuestions: [choiceQuestion("lazy-media-question", ["Look at the diagram", "D. Gray"], {
      identityBehavior: "media-sensitive", mediaOwnership: [{ role: "stem", count: 2, optionKey: "not-applicable", sourceKinds: ["picture", "lazy-src"] }],
    })],
  },
  {
    fixtureId: "COMPAT-07", sourceKind: "real-platform-derived", platformFamily: "pintia",
    scenario: "Programming statement with title, description, table, function signature, sample, and separate editor", path: { kind: "site-specialized-path", siteBranch: "pintia-programming" },
    category: "SUPPORTED", pageUrl: "https://pintia.cn/problem-sets/fixture/exam/problems/type/7?problemSetProblemId=fixture-problem",
    viewport: { width: 1440, height: 960 }, rootMode: "top-document",
    html: `<main><aside id="exam-notice">Exam notice and question navigator</aside><article id="pintia-problem-panel" class="problem-panel description"><header><h1 id="problem-title">7. Neutral sample coding task</h1><div id="problem-meta">作者：示例 单位：示例</div></header><div class="rendered-markdown"><h2>题目描述</h2><p>Given a short list of neutral labels, return the number of entries in the list.</p><table><tr><th>Input</th><th>Output</th></tr><tr><td>alpha beta</td><td>2</td></tr></table><h2>函数接口定义</h2><pre>int countLabels(vector&lt;string&gt; labels);</pre><h2>输入样例</h2><pre>alpha beta</pre><h2>输出样例</h2><pre>2</pre></div></article><aside id="code-editor" class="cm-editor">int countLabels(...) { return 0; }</aside></main>`,
    questionRects: { "pintia-problem-panel": { left: 320, top: 90, width: 1080, height: 780 }, "code-editor": { left: 1100, top: 90, width: 330, height: 780 } },
    expectedQuestionCount: 1,
    expectedQuestions: [{
      ownerId: "pintia-problem-panel", type: "short_answer",
      previewContains: ["Neutral sample coding task", "题目描述", "alpha beta | 2", "函数接口", "输入样例", "输出样例"],
      previewExcludes: ["Exam notice", "question navigator", "code editor"], identityBehavior: "single-observation",
      completeness: COMPLETE_SHORT_ANSWER_COMPLETENESS, boundary: COMPLETE_BOUNDARY,
      mediaOwnership: [{ role: "not-applicable", count: 0, optionKey: "not-applicable", sourceKinds: "not-applicable" }],
      optionKeys: "not-applicable", controlMapping: { capability: "not-applicable", optionKeys: "not-applicable" },
      fillSupport: { capability: "not-applicable" }, rootKind: "top-document", displaySegmentRoles: ["title", "meta", "section"],
    }],
  },
  {
    fixtureId: "COMPAT-08", sourceKind: "real-platform-derived", platformFamily: "pintia",
    scenario: "Question list with judge and single-choice cards beside an announcement", path: { kind: "site-specialized-path", siteBranch: "pintia-question-list" },
    category: "SUPPORTED", pageUrl: "https://pintia.cn/problem-sets/fixture/exam/problems/type/1?problemSetProblemId=fixture-list",
    viewport: { width: 1600, height: 900 }, rootMode: "top-document",
    html: `<main id="list-page"><aside id="announcement">Exam notice: neutral timing information only.</aside><nav id="question-overview">Question overview Page 1 Page 2 Navigator</nav><div id="question-list"><div id="10000001" class="pc-x pt-2 scroll-mt-0"><div>1-1 分数 1</div><div>Classify this neutral statement as true or false. T F</div></div><div id="10000002" class="pc-x pt-2 scroll-mt-0"><div>1-2 分数 2</div><div class="question-item">Which neutral color name follows amber?<ul><li><button class="option" role="radio">A. Blue</button></li><li><button class="option" role="radio">B. Green</button></li><li><button class="option" role="radio">C. Gray</button></li><li><button class="option" role="radio">D. Violet</button></li></ul></div></div></div></main>`,
    questionRects: { "10000001": { left: 320, top: 180, width: 1200, height: 150 }, "10000002": { left: 320, top: 360, width: 1200, height: 180 } },
    expectedQuestionCount: 2,
    expectedQuestions: [
      judgeQuestion("10000001", ["Classify this neutral statement", "T F"], ["Exam notice", "Question overview"]),
      choiceQuestion("10000002", ["Which neutral color name follows amber?", "D. Violet"], {
        previewExcludes: ["Exam notice", "Question overview"],
        fillSupport: { capability: "known-safe-limitation", answer: "B", expectedFailure: "STALE_ACTION_PLAN", stateAfterFailure: "unchanged" },
      }),
    ],
  },
  {
    fixtureId: "COMPAT-09", sourceKind: "synthetic-framework", platformFamily: "react",
    scenario: "Equivalent React rerender with a new DOM owner", path: generic, category: "SUPPORTED", pageUrl: "https://example.test/react/quiz",
    viewport: { width: 1280, height: 900 }, rootMode: "top-document",
    html: questionMarkup("react-owner-before", "", "Question 9 asks which neutral color follows amber? Choose one."),
    questionRects: { "react-owner-before": { left: 80, top: 120, width: 820, height: 320 } },
    transition: { kind: "replace-owner", ownerId: "react-owner-before", replacementHtml: questionMarkup("react-owner-after", "", "Question 9 asks which neutral color follows amber? Choose one."), afterOwnerId: "react-owner-after", afterPreviewContains: ["Question 9 asks", "D. Gray"] },
    expectedQuestionCount: 1,
    expectedQuestions: [choiceQuestion("react-owner-before", ["Question 9 asks", "D. Gray"], { identityBehavior: "stable-after-equivalent-rerender" })],
  },
  {
    fixtureId: "COMPAT-10", sourceKind: "synthetic-framework", platformFamily: "react",
    scenario: "Virtualized card shell recycled from Question 12 to Question 13", path: generic, category: "SUPPORTED", pageUrl: "https://example.test/react/virtualized-quiz",
    viewport: { width: 1280, height: 900 }, rootMode: "top-document",
    html: questionMarkup("recycled-shell", "question-12", "Question 12 asks which neutral color follows amber? Choose one."),
    questionRects: { "recycled-shell": { left: 80, top: 120, width: 820, height: 320 } },
    transition: { kind: "recycle-owner", ownerId: "recycled-shell", nativeQuestionId: "question-13", innerHtml: `<h3 class="questionTit">Single choice</h3><div class="stem">Question 13 asks which neutral color follows blue? Choose one.</div><ul><li><button class="option" role="radio">A. Amber</button></li><li><button class="option" role="radio">B. Blue</button></li><li><button class="option" role="radio">C. Green</button></li><li><button class="option" role="radio">D. Gray</button></li></ul>`, afterPreviewContains: ["Question 13 asks", "D. Gray"] },
    expectedQuestionCount: 1,
    expectedQuestions: [choiceQuestion("recycled-shell", ["Question 12 asks", "D. Gray"], { identityBehavior: "changes-on-virtual-reuse" })],
  },
  {
    fixtureId: "COMPAT-11", sourceKind: "synthetic-framework", platformFamily: "generic",
    scenario: "Question hosted in a same-origin iframe", path: generic, category: "SUPPORTED", pageUrl: "https://example.test/iframe/quiz",
    viewport: { width: 1280, height: 900 }, rootMode: "same-origin-frame",
    html: questionMarkup("frame-question", "frame-question-11", "Question 11 asks which neutral color follows amber? Choose one."),
    questionRects: { "frame-question": { left: 20, top: 40, width: 820, height: 320 } },
    expectedQuestionCount: 1,
    expectedQuestions: [choiceQuestion("frame-question", ["Question 11 asks", "D. Gray"], { rootKind: "same-origin-frame" })],
  },
  {
    fixtureId: "COMPAT-12", sourceKind: "synthetic-framework", platformFamily: "vue",
    scenario: "Question hosted in an open shadow root", path: generic, category: "SUPPORTED", pageUrl: "https://example.test/web-component/quiz",
    viewport: { width: 1280, height: 900 }, rootMode: "open-shadow-root",
    html: questionMarkup("shadow-question", "shadow-question-12", "Question 12 asks which neutral color follows amber? Choose one."),
    questionRects: { "shadow-question": { left: 24, top: 36, width: 820, height: 320 } },
    expectedQuestionCount: 1,
    expectedQuestions: [choiceQuestion("shadow-question", ["Question 12 asks", "D. Gray"], { rootKind: "open-shadow-root" })],
  },
  {
    fixtureId: "COMPAT-13", sourceKind: "synthetic-framework", platformFamily: "react",
    scenario: "Question in an open shadow root nested in a same-origin iframe", path: generic, category: "SUPPORTED", pageUrl: "https://example.test/iframe-shadow/quiz",
    viewport: { width: 1280, height: 900 }, rootMode: "iframe-open-shadow",
    html: questionMarkup("nested-root-question", "nested-question-13", "Question 13 asks which neutral color follows amber? Choose one."),
    questionRects: { "nested-root-question": { left: 24, top: 36, width: 820, height: 320 } },
    expectedQuestionCount: 1,
    expectedQuestions: [choiceQuestion("nested-root-question", ["Question 13 asks", "D. Gray"], { rootKind: "open-shadow-root-in-same-origin-frame" })],
  },
  {
    fixtureId: "COMPAT-14", sourceKind: "synthetic-framework", platformFamily: "react",
    scenario: "Portal controls rendered under document.body without proven question ownership", path: generic, category: "KNOWN_SAFE_LIMITATION",
    pageUrl: "https://example.test/react/portal", viewport: { width: 1280, height: 900 }, rootMode: "top-document",
    html: `<section id="portal-question" class="question-item" data-question-id="portal-question-14"><h3 class="questionTit">Single choice</h3><div class="stem">Question 14 asks which neutral color follows amber? Choose one.</div><ul><li>A. Amber</li><li>B. Blue</li><li>C. Green</li><li>D. Gray</li></ul></section><div id="portal-root"><button role="radio" class="option">A. Amber</button><button role="radio" class="option">B. Blue</button><button role="radio" class="option">C. Green</button><button role="radio" class="option">D. Gray</button></div>`,
    questionRects: { "portal-question": { left: 80, top: 120, width: 820, height: 240 } },
    expectedQuestionCount: 1,
    expectedQuestions: [choiceQuestion("portal-question", ["Question 14 asks", "D. Gray"], {
      controlMapping: { capability: "safe-rejection", optionKeys: [] }, fillSupport: { capability: "withheld", answer: "B", expectedFailure: "INVALID_ANSWER_OPTION" },
    })],
  },
  {
    fixtureId: "COMPAT-15", sourceKind: "synthetic-framework", platformFamily: "vue",
    scenario: "Pointerdown-driven custom choice widget requiring fail-closed behavior", path: generic, category: "KNOWN_SAFE_LIMITATION",
    pageUrl: "https://example.test/vue/pointerdown-widget", viewport: { width: 1280, height: 900 }, rootMode: "top-document",
    html: `<section id="pointerdown-question" class="question-item" data-question-id="pointerdown-question-15"><h3 class="questionTit">Single choice</h3><div class="stem">Question 15 asks which neutral color follows amber? Choose one.</div><ul class="widget-options"><li><button class="option" role="radio" aria-checked="false">A. Amber</button></li><li><button class="option" role="radio" aria-checked="false">B. Blue</button></li><li><button class="option" role="radio" aria-checked="false">C. Green</button></li><li><button class="option" role="radio" aria-checked="false">D. Gray</button></li></ul></section>`,
    questionRects: { "pointerdown-question": { left: 80, top: 120, width: 820, height: 320 } },
    interactionTrigger: "pointerdown",
    expectedQuestionCount: 1,
    expectedQuestions: [choiceQuestion("pointerdown-question", ["Question 15 asks", "D. Gray"], {
      controlMapping: { capability: "known-limitation", optionKeys: ["A", "B", "C", "D"] }, fillSupport: {
        capability: "known-safe-limitation", answer: "B", expectedFailure: "PARTIAL_MUTATION_UNPROVABLE",
        stateAfterFailure: "requested-answer-selected-by-pointerdown",
      },
    })],
    validationReference: "transactionEventBoundary.test.ts EVENT-CHOICE-POINTERDOWN-RERENDER-1; phase5ProductionRace.test.ts PROD-USR1",
  },
  {
    fixtureId: "COMPAT-16", sourceKind: "synthetic-framework", platformFamily: "generic",
    scenario: "Generic static single-choice question without media or site-specific selectors", path: generic, category: "SUPPORTED",
    pageUrl: "https://example.test/generic/static-choice", viewport: { width: 1280, height: 900 }, rootMode: "top-document",
    html: questionMarkup("generic-static-question", "generic-static-16", "Which neutral label follows alpha? Choose one.", ["A. Alpha", "B. Beta", "C. Gamma", "D. Delta"]),
    questionRects: { "generic-static-question": { left: 80, top: 120, width: 820, height: 320 } },
    expectedQuestionCount: 1,
    expectedQuestions: [choiceQuestion("generic-static-question", ["Which neutral label follows alpha?", "D. Delta"])],
  },
  {
    fixtureId: "COMPAT-17", sourceKind: "synthetic-framework", platformFamily: "generic",
    scenario: "Generic judge question with semantic true and false controls", path: generic, category: "SUPPORTED",
    pageUrl: "https://example.test/generic/judge", viewport: { width: 1280, height: 900 }, rootMode: "top-document",
    html: `<section id="generic-judge-question" class="question-item" data-question-id="generic-judge-17"><h3 class="questionTit">判断题</h3><div class="stem">Classify this neutral statement and determine whether the statement is true or false. Choose one.</div><ul><li><button class="option" role="radio" aria-label="A. True" aria-checked="false">正确</button></li><li><button class="option" role="radio" aria-label="B. False" aria-checked="false">错误</button></li></ul></section>`,
    questionRects: { "generic-judge-question": { left: 80, top: 120, width: 820, height: 280 } },
    expectedQuestionCount: 1,
    expectedQuestions: [supportedJudgeQuestion("generic-judge-question", ["Classify this neutral statement"])],
  },
];

export const COMPATIBILITY_LIMITATIONS = [
  { scenario: "Closed shadow root", category: "UNSUPPORTED_BY_BROWSER_SECURITY" as const, fixture: "not-applicable", reason: "Page-owned closed roots are not exposed to extension DOM traversal." },
  { scenario: "Cross-origin iframe DOM", category: "KNOWN_ARCHITECTURE_LIMITATION" as const, fixture: "not-applicable", reason: "The current content runtime injects into the top frame only; host permissions do not add per-frame runtime injection or coordination." },
];
