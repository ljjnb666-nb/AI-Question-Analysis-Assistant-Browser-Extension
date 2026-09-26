import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildControlMapping } from "../answer/controlMapping";
import { detectCandidatesAcrossRoots } from "./domDetector";
import { withQuestionCompleteness } from "./domDetectorPostprocess";
import { ownerOf, rootAttachmentOf } from "../roots/rootContext";
import { sharedRootRegistry } from "../roots/rootRegistry";
import { BROWSER_SECURITY_LIMITATIONS, COMPATIBILITY_FIXTURES, type CompatibilityFixture, type CompatibilityFixtureQuestion } from "./testFixtures/compatibilityFixtures";

type TestRect = { left: number; top: number; width: number; height: number };
type MountedFixture = { root: Document | ShadowRoot; iframe?: HTMLIFrameElement; host?: HTMLElement };

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

function mountFixture(fixture: CompatibilityFixture): MountedFixture {
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
  if (fixture.interactionTrigger === "pointerdown") {
    for (const control of Array.from(mounted.root.querySelectorAll<HTMLElement>("[role=radio]"))) {
      control.addEventListener("pointerdown", () => {
        for (const peer of Array.from(control.parentElement?.parentElement?.querySelectorAll<HTMLElement>("[role=radio]") ?? [])) {
          peer.setAttribute("aria-checked", String(peer === control));
        }
      });
    }
  }
  sharedRootRegistry().reconcile(document);
  return mounted;
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
    it(`${fixture.fixtureId} ${fixture.scenario}`, () => {
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
      for (const expected of fixture.expectedQuestions) {
        const block = matchingBlock(blocks, expected);
        expect(block, `detected block for ${expected.ownerId}`).toBeTruthy();
        assertQuestionExpectation(block!, expected);
        if (fixture.interactionTrigger === "pointerdown") {
          const owner = ownerOf(block!)!;
          const firstControl = owner.querySelector<HTMLElement>("[role=radio]")!;
          firstControl.dispatchEvent(new (firstControl.ownerDocument.defaultView!.PointerEvent)("pointerdown", { bubbles: true, pointerId: 1, isPrimary: true }));
          expect(firstControl.getAttribute("aria-checked")).toBe("true");
        }
        before.set(expected.ownerId, block!);
      }

      if (!fixture.transition) return;
      const expected = fixture.expectedQuestions[0]!;
      const previous = before.get(expected.ownerId)!;
      const previousOwner = ownerOf(previous)!;
      const previousIdentity = previous.identity!;
      applyTransition(fixture);
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
    });
  }

  it("enforces the fixture contract and keeps the corpus sanitized and offline", () => {
    const fixtureIds = COMPATIBILITY_FIXTURES.map((fixture) => fixture.fixtureId);
    expect(fixtureIds).toHaveLength(15);
    expect(new Set(fixtureIds).size).toBe(15);
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
        expect(expected.fillSupport).toBeTruthy();
      }
    }
  });

  it("keeps every support category explicit, including browser security limits", () => {
    const categories = new Set(COMPATIBILITY_FIXTURES.map((fixture) => fixture.category));
    for (const limitation of BROWSER_SECURITY_LIMITATIONS) categories.add(limitation.category);
    expect(categories).toEqual(new Set(["SUPPORTED", "KNOWN_SAFE_LIMITATION", "UNSUPPORTED_BY_BROWSER_SECURITY"]));
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
      expect(matrix, fixture.fixtureId).toContain(fixture.path.kind);
      if (fixture.path.kind === "site-specialized-path") expect(matrix, fixture.fixtureId).toContain(fixture.path.siteBranch);
      if (fixture.validationReference) {
        for (const validation of fixture.validationReference.split("; ")) expect(matrix).toContain(validation.split(" ").slice(-1)[0]);
      }
    }
    for (const limitation of BROWSER_SECURITY_LIMITATIONS) {
      expect(matrix).toContain(limitation.scenario);
      expect(matrix).toContain(limitation.category);
      expect(matrix).toContain(limitation.reason);
    }
    expect(matrix).toContain("Control Mapping");
    expect(matrix).toContain("Fill Support");
    expect(matrix).toContain("EVENT-CHOICE-POINTERDOWN-RERENDER-1");
    expect(matrix).toContain("PROD-USR1");
  });
});
