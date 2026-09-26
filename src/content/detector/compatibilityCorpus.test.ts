import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParseResult } from "@/shared/types";
import { fillParsedAnswerInPage, verifyParsedAnswerInPage } from "../answerFiller";
import { buildControlMapping } from "../answer/controlMapping";
import { detectCandidatesAcrossRoots } from "./domDetector";
import { withQuestionCompleteness } from "./domDetectorPostprocess";
import { ownerOf, rootAttachmentOf } from "../roots/rootContext";
import { sharedRootRegistry } from "../roots/rootRegistry";
import { COMPATIBILITY_FIXTURES, COMPATIBILITY_LIMITATIONS, type CompatibilityFixture, type CompatibilityFixtureQuestion } from "./testFixtures/compatibilityFixtures";

type TestRect = { left: number; top: number; width: number; height: number };
type MountedFixture = {
  root: Document | ShadowRoot;
  iframe?: HTMLIFrameElement;
  host?: HTMLElement;
};
type MountedFixtureWithActions = MountedFixture & {
  actions: { submissions: number; advances: number };
  optionEvents: Array<{ text: string; type: string }>;
};
const CHOICE_EVENTS = ["pointerover", "pointerenter", "pointerdown", "mouseover", "mousedown", "mouseup", "pointerup", "click"] as const;

function setRect(element: Element, rect: TestRect): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }),
  });
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function setLocation(url: string): void {
  Object.defineProperty(window, "location", { configurable: true, value: new URL(url) });
}

function makeFrame(width: number, height: number): { iframe: HTMLIFrameElement; document: Document } {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  setRect(iframe, { left: 0, top: 0, width, height });
  Object.defineProperties(iframe, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
    offsetWidth: { configurable: true, value: width },
    offsetHeight: { configurable: true, value: height },
  });
  if (!iframe.contentDocument) throw new Error("The deterministic same-origin iframe document is unavailable");
  return { iframe, document: iframe.contentDocument };
}

function mountFixture(fixture: CompatibilityFixture): MountedFixtureWithActions {
  document.body.innerHTML = "";
  setViewport(fixture.viewport.width, fixture.viewport.height);
  setLocation(fixture.pageUrl);

  let mounted: MountedFixture;
  switch (fixture.rootMode) {
    case "top-document":
      document.body.innerHTML = fixture.html;
      mounted = { root: document };
      break;
    case "same-origin-frame": {
      const frame = makeFrame(fixture.viewport.width, fixture.viewport.height);
      frame.document.body.innerHTML = fixture.html;
      mounted = { root: frame.document, iframe: frame.iframe };
      break;
    }
    case "open-shadow-root": {
      const host = document.createElement("compat-question-host");
      document.body.append(host);
      setRect(host, { left: 0, top: 0, width: fixture.viewport.width, height: fixture.viewport.height });
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = fixture.html;
      mounted = { root: shadow, host };
      break;
    }
    case "iframe-open-shadow": {
      const frame = makeFrame(fixture.viewport.width, fixture.viewport.height);
      const host = frame.document.createElement("compat-question-host");
      frame.document.body.append(host);
      setRect(host, { left: 0, top: 0, width: fixture.viewport.width, height: fixture.viewport.height });
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = fixture.html;
      mounted = { root: shadow, iframe: frame.iframe, host };
      break;
    }
  }

  for (const [id, rect] of Object.entries(fixture.questionRects)) {
    const element = findById(mounted.root, id) ?? document.getElementById(id);
    if (element) setRect(element, rect);
  }
  for (const override of fixture.currentSrcOverrides ?? []) {
    const image = mounted.root.querySelector(override.selector);
    if (image) Object.defineProperty(image, "currentSrc", { configurable: true, value: override.value });
  }
  const optionEvents: MountedFixtureWithActions["optionEvents"] = [];
  installControlBehaviors(mounted.root, fixture, optionEvents);
  const actions = { submissions: 0, advances: 0 };
  const actionForm = document.createElement("form");
  actionForm.hidden = true;
  actionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    actions.submissions += 1;
  });
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Submit fixture";
  const advance = document.createElement("button");
  advance.type = "button";
  advance.dataset.action = "advance";
  advance.textContent = "Next fixture";
  advance.addEventListener("click", () => { actions.advances += 1; });
  actionForm.append(submit, advance);
  document.body.append(actionForm);
  const pageState = document.createElement("div");
  pageState.hidden = true;
  pageState.innerHTML = '<button id="user-page-state" role="radio" aria-checked="true">Unrelated page choice</button>';
  document.body.append(pageState);
  sharedRootRegistry().reconcile(document);
  return { ...mounted, actions, optionEvents };
}

function installControlBehaviors(root: Document | ShadowRoot, fixture: CompatibilityFixture, optionEvents: MountedFixtureWithActions["optionEvents"]): void {
  for (const control of Array.from(root.querySelectorAll<HTMLElement>("[role=radio]"))) {
    for (const type of CHOICE_EVENTS) {
      control.addEventListener(type, () => optionEvents.push({ text: (control.textContent ?? "").trim(), type }), true);
    }
    if (fixture.interactionTrigger === "pointerdown") {
      control.addEventListener("pointerdown", () => {
        for (const peer of Array.from(control.parentElement?.parentElement?.querySelectorAll<HTMLElement>("[role=radio]") ?? [])) {
          peer.setAttribute("aria-checked", String(peer === control));
        }
      });
    }
    control.addEventListener("click", () => {
      for (const peer of Array.from(control.parentElement?.parentElement?.querySelectorAll<HTMLElement>("[role=radio]") ?? [])) {
        peer.setAttribute("aria-checked", String(peer === control));
      }
    });
  }
}

function findById(root: Document | ShadowRoot, id: string): Element | null {
  return Array.from(root.querySelectorAll("[id]")).find((element) => element.id === id) ?? null;
}

function matchingBlock(blocks: ReturnType<typeof detectCandidatesAcrossRoots>, expected: CompatibilityFixtureQuestion) {
  return blocks.find((block) => {
    const owner = ownerOf(block);
    return owner?.id === expected.ownerId
      && (expected.previewContains === "not-applicable" || expected.previewContains.every((signal) => block.previewText.includes(signal)));
  });
}

function assertQuestionExpectation(
  block: ReturnType<typeof detectCandidatesAcrossRoots>[number],
  expected: CompatibilityFixtureQuestion,
): void {
  const owner = ownerOf(block);
  expect(owner, `runtime owner for ${expected.ownerId}`).toBeTruthy();
  expect(block.identity?.stableId).toBeTruthy();
  expect(block.identity?.contentFingerprint).toBeTruthy();
  expect(block.questionTypeGuess).toBe(expected.type);
  if (expected.previewContains !== "not-applicable") {
    for (const signal of expected.previewContains) expect(block.previewText).toContain(signal);
  }
  if (expected.previewExcludes !== "not-applicable") {
    for (const signal of expected.previewExcludes) expect(block.previewText).not.toContain(signal);
  }
  expect(block.boundary).toMatchObject(expected.boundary);
  expect(block.completeness).toMatchObject(expected.completeness);

  const assets = block.mediaAssets ?? [];
  if (expected.mediaOwnership.length === 1 && expected.mediaOwnership[0]?.role === "not-applicable") {
    expect(assets).toHaveLength(0);
  } else {
    const expectedAssetCount = expected.mediaOwnership.reduce((sum, item) => sum + item.count, 0);
    expect(assets).toHaveLength(expectedAssetCount);
    for (const item of expected.mediaOwnership) {
      const owned = assets.filter((asset) => asset.ownership.role === item.role
        && (item.optionKey === undefined || item.optionKey === "not-applicable" || asset.ownership.optionKey === item.optionKey));
      expect(owned).toHaveLength(item.count);
      if (item.sourceKinds && item.sourceKinds !== "not-applicable") {
        expect(owned.map((asset) => asset.sourceKind).sort()).toEqual([...item.sourceKinds].sort());
      }
    }
  }
  expect(block.hasImage).toBe(assets.length > 0);
  if (expected.identityBehavior === "media-sensitive") expect(block.identity?.signals.media).toBe(true);

  if (expected.optionKeys === "not-applicable") {
    expect(expected.controlMapping.capability).toBe("not-applicable");
  } else {
    const mapping = buildControlMapping(block, owner!);
    if (expected.controlMapping.capability === "supported" || expected.controlMapping.capability === "known-limitation") {
      expect(mapping.ok).toBe(true);
      if (mapping.ok) expect([...mapping.options.keys()].sort()).toEqual([...expected.controlMapping.optionKeys as string[]].sort());
    } else {
      expect(expected.controlMapping.capability).toBe("safe-rejection");
      expect(mapping.ok).toBe(true);
      if (mapping.ok) expect([...mapping.options.keys()]).toEqual([]);
    }
  }

  const attachment = rootAttachmentOf(block);
  if (expected.rootKind === "top-document") expect(attachment.kind).toBe("top-document");
  if (expected.rootKind === "same-origin-frame") {
    expect(attachment.kind).toBe("same-origin-frame");
    expect(owner!.ownerDocument).not.toBe(document);
  }
  if (expected.rootKind === "open-shadow-root") {
    expect(attachment.kind).toBe("open-shadow-root");
    expect(owner!.getRootNode()).toHaveProperty("host");
    expect(owner!.ownerDocument).toBe(document);
  }
  if (expected.rootKind === "open-shadow-root-in-same-origin-frame") {
    expect(attachment.kind).toBe("open-shadow-root");
    expect(owner!.getRootNode()).toHaveProperty("host");
    expect(owner!.ownerDocument).not.toBe(document);
  }
  if (expected.displaySegmentRoles !== "not-applicable") {
    expect((block.displaySegments ?? []).filter((segment) => segment.type === "text").map((segment) => segment.role ?? "text"))
      .toEqual(expect.arrayContaining(expected.displaySegmentRoles));
  }
}

function parseResultFor(block: ReturnType<typeof detectCandidatesAcrossRoots>[number], answer: string): ParseResult {
  return {
    blockId: block.id,
    questionType: block.questionTypeGuess,
    answer,
    confidence: 1,
    briefExplanation: "",
    detailedExplanation: "",
    recognizedText: block.previewText,
    routeUsed: "text",
  };
}

function readOptionState(owner: Element): Array<{ text: string; checked: boolean }> {
  return Array.from(owner.querySelectorAll<HTMLElement>("[role=radio]"), (control) => ({
    text: (control.textContent ?? "").trim(),
    checked: control.getAttribute("aria-checked") === "true" || (control as HTMLInputElement).checked === true,
  }));
}

function optionMatchesAnswer(text: string, questionType: string, answer: string): boolean {
  if (questionType === "judge") {
    return /^(?:对|正确|true|yes)$/i.test(answer.trim())
      ? /(?:正确|对|true|yes)/i.test(text)
      : /(?:错误|错|false|no)/i.test(text);
  }
  const key = answer.trim().toUpperCase();
  return new RegExp(`^${key}\\s*[.、):：]`).test(text);
}

function fillSupportMatrixText(fixture: CompatibilityFixture): string {
  if (fixture.expectedQuestions.length === 0) return "not-applicable";
  return fixture.expectedQuestions.map((question) => {
    const contract = question.fillSupport;
    if (contract.capability === "supported") {
      return `${question.type}: supported (answer=${contract.answer}; filled=${contract.expectedFilledCount}; readback=verified)`;
    }
    if (contract.capability === "withheld") return `${question.type}: withheld (${contract.expectedFailure})`;
    if (contract.capability === "known-safe-limitation") return `${question.type}: known-safe-limitation (${contract.expectedFailure}; state=${contract.stateAfterFailure})`;
    return `${question.type}: not-applicable`;
  }).join("; ");
}

async function assertFillExpectation(
  fixture: CompatibilityFixture,
  expected: CompatibilityFixtureQuestion,
  block: ReturnType<typeof detectCandidatesAcrossRoots>[number],
  mounted: MountedFixtureWithActions,
): Promise<void> {
  const owner = ownerOf(block)!;
  const contract = expected.fillSupport;
  if (contract.capability === "not-applicable") return;

  const result = parseResultFor(block, contract.answer);
  const before = readOptionState(owner);
  const outsideOwner = Array.from(document.querySelectorAll<HTMLElement>("[role=radio]"))
    .filter((control) => !owner.contains(control))
    .map((control) => ({ control, checked: control.getAttribute("aria-checked") === "true" || (control as HTMLInputElement).checked === true }));
  mounted.optionEvents.length = 0;
  const filled = await fillParsedAnswerInPage(block, result, { mode: "manual", expectedUrl: fixture.pageUrl });

  if (contract.capability === "supported") {
    expect(filled.ok, `${fixture.fixtureId}: code=${filled.code ?? "none"}; message=${filled.message}`).toBe(true);
    expect(filled.filledCount, fixture.fixtureId).toBe(contract.expectedFilledCount);
    expect(verifyParsedAnswerInPage(block, result, fixture.pageUrl).ok, fixture.fixtureId).toBe(true);
    const after = readOptionState(owner);
    expect(after.filter(({ checked }) => checked)).toHaveLength(1);
    const selected = after.filter(({ checked }) => checked);
    expect(selected.every(({ text }) => optionMatchesAnswer(text, result.questionType, contract.answer))).toBe(true);
    for (let index = 0; index < before.length; index += 1) {
      if (!optionMatchesAnswer(before[index]!.text, result.questionType, contract.answer)) {
        expect(after[index]!.checked, `${fixture.fixtureId} changed unrelated option ${before[index]!.text}`).toBe(before[index]!.checked);
      }
    }
  } else {
    expect(filled.ok, fixture.fixtureId).toBe(false);
    expect(filled.filledCount, fixture.fixtureId).toBe(0);
    expect(filled.code, fixture.fixtureId).toBe(contract.expectedFailure);
    const after = readOptionState(owner);
    const verified = verifyParsedAnswerInPage(block, result, fixture.pageUrl).ok;
    if (contract.capability === "withheld" || contract.stateAfterFailure === "unchanged") {
      expect(after, fixture.fixtureId).toEqual(before);
      expect(verified, fixture.fixtureId).toBe(false);
    } else {
      expect(after.filter(({ checked }) => checked)).toHaveLength(1);
      expect(after.filter(({ checked }) => checked).every(({ text }) => optionMatchesAnswer(text, result.questionType, contract.answer))).toBe(true);
      expect(verified, fixture.fixtureId).toBe(true);
      const targetEvents = mounted.optionEvents.filter(({ text }) => optionMatchesAnswer(text, result.questionType, contract.answer));
      expect(targetEvents.map(({ type }) => type), fixture.fixtureId).toEqual(["pointerover", "pointerenter", "pointerdown"]);
    }
  }

  for (const { control, checked } of outsideOwner) {
    expect(control.getAttribute("aria-checked") === "true" || (control as HTMLInputElement).checked === true, fixture.fixtureId).toBe(checked);
  }
  expect(mounted.actions.submissions, fixture.fixtureId).toBe(0);
  expect(mounted.actions.advances, fixture.fixtureId).toBe(0);
}

function applyTransition(fixture: CompatibilityFixture): void {
  const transition = fixture.transition;
  if (!transition) return;
  const beforeOwner = document.getElementById(transition.ownerId)
    ?? Array.from(document.querySelectorAll("iframe")).flatMap((frame) => frame.contentDocument ? [frame.contentDocument.getElementById(transition.ownerId)] : []).find(Boolean)
    ?? null;
  if (!beforeOwner) throw new Error(`Transition owner not found: ${transition.ownerId}`);
  const rect = fixture.questionRects[transition.ownerId];
  if (transition.kind === "replace-owner") {
    const template = document.createElement("template");
    template.innerHTML = transition.replacementHtml;
    const replacement = template.content.firstElementChild;
    if (!replacement) throw new Error("Equivalent rerender fixture did not provide a replacement owner");
    beforeOwner.replaceWith(replacement);
    if (rect) setRect(replacement, rect);
    return;
  }
  beforeOwner.setAttribute("data-question-id", transition.nativeQuestionId);
  beforeOwner.innerHTML = transition.innerHtml;
  if (rect) setRect(beforeOwner, rect);
}

describe("Phase 9A deterministic compatibility corpus", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    sharedRootRegistry().reset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    sharedRootRegistry().reset();
  });

  for (const fixture of COMPATIBILITY_FIXTURES) {
    it(`${fixture.fixtureId} ${fixture.scenario}`, async () => {
      const mounted = mountFixture(fixture);
      const blocks = detectCandidatesAcrossRoots();
      expect(blocks).toHaveLength(fixture.expectedQuestionCount);
      expect(fixture.expectedQuestions).toHaveLength(fixture.expectedQuestionCount);

      if (fixture.expectedWithheld) {
        const mountedText = mounted.root.nodeType === 9 ? (mounted.root as Document).body.textContent : mounted.root.textContent;
        expect(mountedText).toContain(fixture.expectedWithheld.previewSignal);
        expect(fixture.expectedWithheld.reason).toMatch(/clipped|viewport|mounted DOM/i);
        expect(fixture.expectedQuestionCount).toBe(0);
        const rect = fixture.questionRects[fixture.expectedWithheld.ownerId]!;
        const classified = withQuestionCompleteness({
          id: fixture.expectedWithheld.previewSignal,
          bbox: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          previewText: mountedText ?? "",
          hasImage: false,
          questionTypeGuess: "single_choice",
          confidence: 1,
          source: "auto_dom",
        });
        expect(classified.boundary?.state).toBe(fixture.expectedWithheld.boundaryState);
        expect(classified.completeness?.state).toBe(fixture.expectedWithheld.completenessState);
      }

      const before = new Map<string, ReturnType<typeof detectCandidatesAcrossRoots>[number]>();
      let fillCandidates = blocks;
      const transitionedFillBlocks = new Map<string, ReturnType<typeof detectCandidatesAcrossRoots>[number]>();
      for (const expected of fixture.expectedQuestions) {
        const block = matchingBlock(blocks, expected);
        expect(block, `detected block for ${expected.ownerId}; candidates=${blocks.map((candidate) => `${ownerOf(candidate)?.id}:${candidate.questionTypeGuess}:${candidate.previewText}`).join(" | ")}`).toBeTruthy();
        assertQuestionExpectation(block!, expected);
        if (fixture.interactionTrigger === "pointerdown") {
          const owner = ownerOf(block!)!;
          const firstControl = owner.querySelector<HTMLElement>("[role=radio]")!;
          firstControl.dispatchEvent(new (firstControl.ownerDocument.defaultView!.PointerEvent)("pointerdown", { bubbles: true, pointerId: 1, isPrimary: true }));
          expect(firstControl.getAttribute("aria-checked")).toBe("true");
        }
        before.set(expected.ownerId, block!);
      }

      if (fixture.transition) {
        const expected = fixture.expectedQuestions[0]!;
        const previous = before.get(expected.ownerId)!;
        const previousOwner = ownerOf(previous)!;
        const previousIdentity = previous.identity!;
        applyTransition(fixture);
        installControlBehaviors(document, fixture, mounted.optionEvents);
        const after = detectCandidatesAcrossRoots();
        expect(after).toHaveLength(fixture.expectedQuestionCount);
        const transition = fixture.transition;
        const afterOwnerId = transition.kind === "replace-owner" ? transition.afterOwnerId : transition.ownerId;
        const current = after.find((block) => ownerOf(block)?.id === afterOwnerId
          && transition.afterPreviewContains.every((signal) => block.previewText.includes(signal)));
        expect(current, `post-transition question for ${afterOwnerId}`).toBeTruthy();
        const currentOwner = ownerOf(current!)!;
        if (transition.kind === "replace-owner") {
          expect(currentOwner).not.toBe(previousOwner);
          expect(currentOwner.isConnected).toBe(true);
          expect(current!.identity?.stableId).toBe(previousIdentity.stableId);
          expect(current!.identity?.contentFingerprint).toBe(previousIdentity.contentFingerprint);
        } else {
          expect(currentOwner).toBe(previousOwner);
          expect(current!.identity?.stableId).not.toBe(previousIdentity.stableId);
          expect(current!.identity?.contentFingerprint).not.toBe(previousIdentity.contentFingerprint);
        }
        transitionedFillBlocks.set(expected.ownerId, current!);
        fillCandidates = after;
      }

      for (const expected of fixture.expectedQuestions) {
        if (expected.fillSupport.capability === "not-applicable") continue;
        const block = transitionedFillBlocks.get(expected.ownerId) ?? matchingBlock(fillCandidates, expected);
        expect(block, `fill contract block for ${expected.ownerId}`).toBeTruthy();
        await assertFillExpectation(fixture, expected, block!, mounted);
      }
    });
  }

  it("enforces the fixture contract and keeps the corpus sanitized and offline", () => {
    const fixtureIds = COMPATIBILITY_FIXTURES.map((fixture) => fixture.fixtureId);
    expect(fixtureIds.length).toBeGreaterThanOrEqual(15);
    expect(new Set(fixtureIds).size).toBe(fixtureIds.length);
    expect(fixtureIds).toEqual(expect.arrayContaining(Array.from({ length: 15 }, (_, index) => `COMPAT-${String(index + 1).padStart(2, "0")}`)));
    expect(new Set(COMPATIBILITY_FIXTURES.map((fixture) => fixture.sourceKind))).toEqual(new Set([
      "real-platform-derived", "synthetic-framework", "historical-regression",
    ]));

    for (const fixture of COMPATIBILITY_FIXTURES) {
      expect(fixture.viewport.width).toBeGreaterThan(0);
      expect(fixture.viewport.height).toBeGreaterThan(0);
      expect(fixture.expectedQuestions).toHaveLength(fixture.expectedQuestionCount);
      expect(fixture.html).not.toMatch(/student|学号|cookie|authorization|bearer|api[ _-]?key|token|session[ _-]?id/i);
      expect(fixture.html).not.toMatch(/\b\d{10,}\b/);
      const externalAssetHosts = Array.from(fixture.html.matchAll(/https?:\/\/([^/"'\s>]+)/g), (match) => match[1]);
      expect(externalAssetHosts.every((host) => host === "assets.example.test")).toBe(true);
      for (const expected of fixture.expectedQuestions) {
        expect(expected.previewContains).toBeDefined();
        expect(expected.previewExcludes).toBeDefined();
        expect(expected.identityBehavior).toBeTruthy();
        expect(expected.completeness).toBeDefined();
        expect(expected.boundary).toBeDefined();
        expect(expected.mediaOwnership).toBeDefined();
        expect(expected.optionKeys).toBeDefined();
        expect(expected.controlMapping).toBeDefined();
        expect(expected.fillSupport).toBeDefined();
        if (expected.fillSupport.capability === "supported") {
          expect(expected.fillSupport.answer.trim()).not.toBe("");
          expect(expected.fillSupport.expectedFilledCount).toBeGreaterThan(0);
        } else if (expected.fillSupport.capability !== "not-applicable") {
          expect(expected.fillSupport.expectedFailure.trim()).not.toBe("");
        }
      }
    }
    const polymasRegression = COMPATIBILITY_FIXTURES.find((fixture) => fixture.fixtureId === "COMPAT-01")!;
    expect(polymasRegression.path).toMatchObject({ kind: "site-specialized-path", siteBranch: "polymas-zhihuishu-right-cut" });
    const genericBaseline = COMPATIBILITY_FIXTURES.find((fixture) => fixture.fixtureId === "COMPAT-16")!;
    expect(genericBaseline.path).toEqual({ kind: "generic-path", siteBranch: "not-applicable" });
  });

  it("keeps supported, safety, architecture, and browser-security categories explicit", () => {
    const categories = new Set(COMPATIBILITY_FIXTURES.map((fixture) => fixture.category));
    for (const limitation of COMPATIBILITY_LIMITATIONS) categories.add(limitation.category);
    expect(categories).toEqual(new Set(["SUPPORTED", "KNOWN_SAFE_LIMITATION", "KNOWN_ARCHITECTURE_LIMITATION", "UNSUPPORTED_BY_BROWSER_SECURITY"]));
    expect(COMPATIBILITY_LIMITATIONS.find(({ scenario }) => scenario === "Closed shadow root")?.category).toBe("UNSUPPORTED_BY_BROWSER_SECURITY");
    expect(COMPATIBILITY_LIMITATIONS.find(({ scenario }) => scenario === "Cross-origin iframe DOM")?.category).toBe("KNOWN_ARCHITECTURE_LIMITATION");
    const specializedBranches = new Set<string>();
    const specializedHosts = new Set<string>();
    for (const fixture of COMPATIBILITY_FIXTURES) {
      expect(fixture.expectedQuestions).toHaveLength(fixture.expectedQuestionCount);
      if (fixture.path.kind === "generic-path") expect(fixture.path.siteBranch).toBe("not-applicable");
      else {
        const url = new URL(fixture.pageUrl);
        specializedBranches.add(fixture.path.siteBranch);
        specializedHosts.add(url.hostname);
        if (fixture.path.siteBranch === "polymas-zhihuishu-right-cut") expect(url.hostname).toMatch(/polymas\.com|zhihuishu\.com/);
        if (fixture.path.siteBranch.startsWith("pintia-")) expect(url.hostname).toMatch(/pintia\.cn$/);
      }
    }
    expect(specializedBranches).toEqual(new Set(["polymas-zhihuishu-right-cut", "pintia-programming", "pintia-question-list"]));
    expect([...specializedHosts].some((host) => host.endsWith("polymas.com"))).toBe(true);
    expect([...specializedHosts].some((host) => host.endsWith("zhihuishu.com"))).toBe(true);
  });

  it("documents each fixture, detector path, and unsupported browser boundary in the compatibility matrix", () => {
    const matrix = readFileSync("docs/COMPATIBILITY-MATRIX.md", "utf8");
    for (const fixture of COMPATIBILITY_FIXTURES) {
      expect(matrix, fixture.fixtureId).toContain(fixture.fixtureId);
      expect(matrix, fixture.fixtureId).toContain(fixture.category);
      const row = matrix.split(/\r?\n/).find((line) => line.includes(fixture.fixtureId));
      expect(row, `matrix row for ${fixture.fixtureId}`).toContain(fillSupportMatrixText(fixture));
      expect(matrix, fixture.fixtureId).toContain(fixture.path.kind);
      if (fixture.path.kind === "site-specialized-path") expect(matrix, fixture.fixtureId).toContain(fixture.path.siteBranch);
      if (fixture.validationReference) {
        for (const validation of fixture.validationReference.split("; ")) expect(matrix).toContain(validation.split(" ").slice(-1)[0]);
      }
    }
    for (const limitation of COMPATIBILITY_LIMITATIONS) {
      expect(matrix).toContain(limitation.scenario);
      expect(matrix).toContain(limitation.category);
      expect(matrix).toContain(limitation.reason);
    }
    expect(matrix).toContain("Control Mapping");
    expect(matrix).toContain("Fill Support");
    expect(matrix).toContain("EVENT-CHOICE-POINTERDOWN-RERENDER-1");
    expect(matrix).toContain("PROD-USR1");
    expect(matrix).toContain("with matching host permissions an extension can execute in a matching frame");
    expect(matrix).toContain("per-frame content runtime, explicit frame identity, and message authority");
    expect(matrix).toContain("A parent content script must not directly read or infer a cross-origin child document.");
  });
});
