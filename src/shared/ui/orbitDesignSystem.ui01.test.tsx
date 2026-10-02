import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import {
  orbitTokens,
  orbitColors,
  orbitSpacing,
  orbitRadius,
  orbitComponent,
} from "./orbitTokens";
import {
  OrbitButton,
  OrbitSurface,
  OrbitBadge,
  OrbitStatus,
  OrbitInput,
  OrbitSelect,
  OrbitToggle,
  OrbitSectionHeader,
  OrbitDisclosure,
} from "./orbitPrimitives";
import {
  getPrefersReducedMotion,
  resolveMotionDuration,
  ORBIT_REDUCED_MOTION_CSS,
  ORBIT_MOTION_DURATIONS,
  ORBIT_EASINGS,
} from "./orbitMotion";
import {
  setKeyboardModalityForTesting,
  getIsKeyboardModality,
} from "./orbitFocus";
import { userFeedback, mapKnownCodeFeedback, mapUserFacingError } from "./userFeedback";
import { isParseResultFillAuthoritative } from "../ai/parseResultAuthority";
import type { ParseResult } from "../types";

describe("Orbit Console Design System Foundation (UI-01 & RF-01)", () => {
  beforeEach(() => {
    // Reset focus modality to default keyboard mode for standard tests
    setKeyboardModalityForTesting(true);
  });

  it("UI01-01: design token module exports required semantic groups", () => {
    expect(orbitTokens).toBeDefined();
    expect(orbitTokens.color).toBeDefined();
    expect(orbitTokens.spacing).toBeDefined();
    expect(orbitTokens.radius).toBeDefined();
    expect(orbitTokens.typography).toBeDefined();
    expect(orbitTokens.controlHeight).toBeDefined();
    expect(orbitTokens.component).toBeDefined();
    expect(orbitTokens.shadow).toBeDefined();
    expect(orbitTokens.focus).toBeDefined();
    expect(orbitTokens.motion).toBeDefined();
    expect(orbitTokens.cssVariables).toBeDefined();

    // Verify core semantic colors exist
    expect(orbitColors.bg.canvas).toBe("#0B0D11");
    expect(orbitColors.brand.primary).toBe("#2563EB"); // Electric blue
    expect(orbitColors.semantic.success).toBe("#10B981");
    expect(orbitColors.semantic.warning).toBe("#F59E0B");
    expect(orbitColors.semantic.error).toBe("#EF4444");
    expect(orbitColors.semantic.info).toBe("#3B82F6");
    expect(orbitColors.ai.accent).toBe("#8B5CF6"); // Subtle purple for AI only

    // Verify spacing scale
    expect(orbitSpacing[1]).toBe(4);
    expect(orbitSpacing[2]).toBe(8);
    expect(orbitSpacing[3]).toBe(12);
    expect(orbitSpacing[4]).toBe(16);
    expect(orbitSpacing[6]).toBe(24);
    expect(orbitSpacing[8]).toBe(32);

    // Verify radius scale
    expect(orbitRadius.sm).toBe(8);
    expect(orbitRadius.md).toBe(12);
    expect(orbitRadius.lg).toBe(16);
    expect(orbitRadius.xl).toBe(18);
    expect(orbitRadius.pill).toBe(999);
  });

  it("UI01-02: Button primary/secondary/danger/ghost render correct semantic variant", () => {
    const { rerender } = render(<OrbitButton variant="primary">Action</OrbitButton>);
    let btn = screen.getByRole("button", { name: "Action" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.style.backgroundColor).toBe(orbitColors.brand.primary);

    rerender(<OrbitButton variant="secondary">Action</OrbitButton>);
    btn = screen.getByRole("button", { name: "Action" });
    expect(btn.style.backgroundColor).toBe(orbitColors.bg.surfaceRaised);

    rerender(<OrbitButton variant="danger">Action</OrbitButton>);
    btn = screen.getByRole("button", { name: "Action" });
    expect(btn.style.backgroundColor).toBe(orbitColors.semantic.error);

    rerender(<OrbitButton variant="ghost">Action</OrbitButton>);
    btn = screen.getByRole("button", { name: "Action" });
    expect(btn.style.backgroundColor).toBe("transparent");
  });

  it("UI01-03: disabled Button disabled semantics preserved", () => {
    render(<OrbitButton disabled>Disabled Action</OrbitButton>);
    const btn = screen.getByRole("button", { name: "Disabled Action" });
    expect(btn).toBeDisabled();
    expect(btn.style.cursor).toBe("not-allowed");
    expect(btn.style.color).toBe(orbitColors.control.disabledText);
  });

  it("UI01-04: Button keyboard focus mechanism exists", () => {
    setKeyboardModalityForTesting(true);
    render(<OrbitButton variant="primary">Focus Me</OrbitButton>);
    const btn = screen.getByRole("button", { name: "Focus Me" });
    expect(btn.style.outline).toContain("none");

    fireEvent.focus(btn);
    // Focus visible styling applied under keyboard modality
    expect(btn.style.outline).toContain("solid");
    expect(btn.style.boxShadow).toContain(orbitColors.brand.primary);

    fireEvent.blur(btn);
    expect(btn.style.outline).toContain("none");
  });

  it("UI01-05: UserFeedback tones success/info/warning/error map to distinct semantic styles", () => {
    const { container, rerender } = render(
      <OrbitStatus tone="success" label="All systems nominal" />
    );
    const status = container.querySelector('[role="status"]') as HTMLElement;
    expect(status).not.toBeNull();
    let dot = status.querySelector("span") as HTMLElement;
    expect(dot.style.backgroundColor).toBe(orbitColors.semantic.success);

    rerender(<OrbitStatus tone="warning" label="Review required" />);
    dot = status.querySelector("span") as HTMLElement;
    expect(dot.style.backgroundColor).toBe(orbitColors.semantic.warning);

    rerender(<OrbitStatus tone="error" label="Operation halted" />);
    dot = status.querySelector("span") as HTMLElement;
    expect(dot.style.backgroundColor).toBe(orbitColors.semantic.error);
    expect(dot.style.backgroundColor).not.toBe(orbitColors.semantic.success); // Error must NEVER be green

    rerender(<OrbitStatus tone="info" label="Update ready" />);
    dot = status.querySelector("span") as HTMLElement;
    expect(dot.style.backgroundColor).toBe(orbitColors.semantic.info);

    rerender(<OrbitStatus tone="ai" label="AI processing" />);
    dot = status.querySelector("span") as HTMLElement;
    expect(dot.style.backgroundColor).toBe(orbitColors.ai.accent); // Purple strictly for AI
  });

  it("UI01-06: Input does not rely on outline:none without replacement focus styling", () => {
    setKeyboardModalityForTesting(true);
    render(<OrbitInput label="Target URL" placeholder="https://" />);
    const input = screen.getByPlaceholderText("https://") as HTMLInputElement;

    // Default border
    expect(input.style.borderColor).toBe(orbitColors.border.default);

    // Keyboard focus triggers visible focus styling
    fireEvent.focus(input);
    expect(input.style.borderColor).toBe(orbitColors.border.focus);
    expect(input.style.boxShadow).toContain(orbitColors.brand.subtle);

    fireEvent.blur(input);
    expect(input.style.borderColor).toBe(orbitColors.border.default);
  });

  it("UI01-07: Surface variants map to token values", () => {
    const { container, rerender } = render(
      <OrbitSurface variant="default">Content</OrbitSurface>
    );
    let surface = container.firstElementChild as HTMLElement;
    expect(surface.style.backgroundColor).toBe(orbitColors.bg.surface);
    expect(surface.style.borderRadius).toBe(`${orbitRadius.lg}px`);

    rerender(<OrbitSurface variant="raised">Content</OrbitSurface>);
    surface = container.firstElementChild as HTMLElement;
    expect(surface.style.backgroundColor).toBe(orbitColors.bg.surfaceRaised);
    expect(surface.style.boxShadow).toBe(orbitTokens.shadow.subtle);

    rerender(<OrbitSurface variant="interactive">Content</OrbitSurface>);
    surface = container.firstElementChild as HTMLElement;
    expect(surface.style.backgroundColor).toBe(orbitColors.bg.surface);
  });

  it("UI01-08: shared primitives contain no hardcoded legacy primary colors such as #6366f1 / #4f46e5 unless they exist only inside the authoritative token definition", () => {
    const primitivesFile = fs.readFileSync(
      path.resolve(__dirname, "orbitPrimitives.tsx"),
      "utf-8"
    );
    expect(primitivesFile).not.toContain("#6366f1");
    expect(primitivesFile).not.toContain("#4f46e5");

    const extensionUiFile = fs.readFileSync(
      path.resolve(__dirname, "extensionUi.tsx"),
      "utf-8"
    );
    expect(extensionUiFile).not.toContain("#6366f1");
    expect(extensionUiFile).not.toContain("#4f46e5");
  });

  it("UI01-09: reduced-motion support exists", () => {
    expect(ORBIT_REDUCED_MOTION_CSS).toContain("prefers-reduced-motion: reduce");
    expect(ORBIT_MOTION_DURATIONS.microMs).toBe(140);
    expect(ORBIT_MOTION_DURATIONS.panelMs).toBe(220);

    const originalMatchMedia = window.matchMedia;
    try {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      expect(getPrefersReducedMotion()).toBe(true);
      expect(resolveMotionDuration(200)).toBe(0);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("UI01-10: UI-00A provenance tests remain PASS", () => {
    const mockResult: ParseResult = {
      blockId: "b1",
      questionType: "single_choice",
      answer: "A",
      confidence: 1,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "Q",
      routeUsed: "text",
      resultSource: "mock",
    };
    expect(isParseResultFillAuthoritative(mockResult)).toBe(false);

    const legacyResult: ParseResult = {
      ...mockResult,
      resultSource: undefined as unknown as "mock",
    };
    delete (legacyResult as unknown as Record<string, unknown>).resultSource;
    expect(isParseResultFillAuthoritative(legacyResult)).toBe(false);

    const providerResult: ParseResult = {
      ...mockResult,
      resultSource: "provider",
    };
    expect(isParseResultFillAuthoritative(providerResult)).toBe(true);
  });

  it("UI01-11: UI-00B feedback tests remain PASS", () => {
    const feedback = userFeedback("error", "Failed to connect", {
      code: "CONNECTION_FAILED",
      technicalDetail: "Socket closed prematurely",
    });
    expect(feedback.tone).toBe("error");
    expect(feedback.message).toBe("Failed to connect");
    expect(feedback.code).toBe("CONNECTION_FAILED");
    expect(feedback.technicalDetail).toBe("Socket closed prematurely");

    const mapped = mapKnownCodeFeedback("STALE_QUESTION_REVISION", "zh");
    expect(mapped).not.toBeNull();
    expect(mapped?.tone).toBe("warning");

    const errMapped = mapUserFacingError(new Error("Raw SQL connection timeout"), "zh");
    expect(errMapped.tone).toBe("error");
    expect(errMapped.message).not.toContain("Raw SQL connection timeout");
    expect(errMapped.technicalDetail).toContain("Raw SQL connection timeout");
  });

  it("UI01-12: NO_AUTOMATIC_SUBMISSION regression remains PASS", () => {
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <OrbitButton>Manual Button</OrbitButton>
      </form>
    );

    const btn = screen.getByRole("button", { name: "Manual Button" });
    expect(btn.getAttribute("type")).toBe("button");
    fireEvent.click(btn);
    expect(onSubmit).not.toHaveBeenCalled();

    const primitivesFile = fs.readFileSync(
      path.resolve(__dirname, "orbitPrimitives.tsx"),
      "utf-8"
    );
    expect(primitivesFile).not.toContain("自动交卷");
    expect(primitivesFile).not.toContain("自动提交");
  });

  /* ==================================================
   * REVIEW FIX 01 TEST SUITE (RF01-01 through RF01-12)
   * ================================================== */

  it("RF01-01: reduced-motion=true actually disables transitions and animations across primitives", () => {
    const originalMatchMedia = window.matchMedia;
    try {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const { container } = render(
        <div>
          <OrbitButton>Button</OrbitButton>
          <OrbitSurface data-testid="orbit-surface">Surface</OrbitSurface>
          <OrbitInput label="Field" />
          <OrbitSelect label="Dropdown" options={[{ value: "1", label: "One" }]} />
          <OrbitToggle checked={false} onChange={() => {}} label="Toggle" />
          <OrbitDisclosure title="Details">Body</OrbitDisclosure>
        </div>
      );

      const btn = screen.getByRole("button", { name: "Button" });
      expect(btn.style.transition).toBe("none");

      const surface = screen.getByTestId("orbit-surface");
      expect(surface.style.transition).toBe("none");

      const input = screen.getByRole("textbox");
      expect(input.style.transition).toBe("none");

      const select = screen.getByRole("combobox");
      expect(select.style.transition).toBe("none");

      const toggleTrack = screen.getByRole("switch");
      expect(toggleTrack.style.transition).toBe("none");

      const toggleThumb = toggleTrack.querySelector("span") as HTMLElement;
      expect(toggleThumb.style.transition).toBe("none");

      const disclosureChevron = screen.getByText("▶");
      expect(disclosureChevron.style.transition).toBe("none");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("RF01-02: OrbitButton loading spinner operates in normal motion and halts infinite spin in reduced motion", () => {
    const originalMatchMedia = window.matchMedia;

    // Normal motion
    try {
      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const { unmount } = render(<OrbitButton isLoading>Loading Normal</OrbitButton>);
      const spinnerNormal = screen.getByTestId("orbit-loading-spinner");
      expect(spinnerNormal.style.animation).toContain("orbit-spin");
      expect(spinnerNormal.style.animation).toContain("infinite");

      // Verify that the keyframes style tag was actually injected
      expect(document.getElementById("orbit-system-keyframes")).not.toBeNull();
      unmount();
    } finally {
      window.matchMedia = originalMatchMedia;
    }

    // Reduced motion
    try {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      render(<OrbitButton isLoading>Loading Reduced</OrbitButton>);
      const spinnerReduced = screen.getByTestId("orbit-loading-spinner");
      // Under reduced motion: no infinite spin animation
      expect(spinnerReduced.style.animation).toBe("none");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("RF01-03: OrbitDisclosure keyboard focus exhibits visible focus treatment", () => {
    setKeyboardModalityForTesting(true);
    render(<OrbitDisclosure title="Telemetry Logs">System ok</OrbitDisclosure>);
    const trigger = screen.getByRole("button", { name: /Telemetry Logs/ });

    expect(trigger.style.outline).toContain("none");

    fireEvent.focus(trigger);
    expect(trigger.style.outline).toContain("solid");
    expect(trigger.style.boxShadow).toContain(orbitColors.brand.primary);

    fireEvent.blur(trigger);
    expect(trigger.style.outline).toContain("none");
  });

  it("RF01-04: mouse focus and keyboard focus adhere strictly to focus-visible contract", () => {
    render(
      <div>
        <OrbitButton variant="primary">Interactive Button</OrbitButton>
        <OrbitButton disabled>Disabled Button</OrbitButton>
      </div>
    );
    const activeBtn = screen.getByRole("button", { name: "Interactive Button" });
    const disabledBtn = screen.getByRole("button", { name: "Disabled Button" });

    // 1. Mouse focus: mousedown precedes focus -> No keyboard focus ring
    setKeyboardModalityForTesting(false);
    expect(getIsKeyboardModality()).toBe(false);
    fireEvent.focus(activeBtn);
    expect(activeBtn.style.outline).toContain("none");
    expect(activeBtn.style.boxShadow).toBe("");

    fireEvent.blur(activeBtn);

    // 2. Keyboard focus: Tab/Arrow precedes focus -> Visible focus ring applied
    setKeyboardModalityForTesting(true);
    expect(getIsKeyboardModality()).toBe(true);
    fireEvent.focus(activeBtn);
    expect(activeBtn.style.outline).toContain("solid");
    expect(activeBtn.style.boxShadow).toContain(orbitColors.brand.primary);

    fireEvent.blur(activeBtn);

    // 3. Disabled element: never shows focus ring under keyboard or mouse
    setKeyboardModalityForTesting(true);
    fireEvent.focus(disabledBtn);
    expect(disabledBtn.style.outline).toContain("none");
  });

  it("RF01-05: OrbitInput helper generates correct aria-describedby relationship", () => {
    render(<OrbitInput label="Port Number" helperText="Standard range 1024-65535" />);
    const input = screen.getByRole("textbox", { name: "Port Number" });
    const helper = screen.getByText("Standard range 1024-65535");

    expect(helper.id).toBeDefined();
    expect(helper.id.length).toBeGreaterThan(0);
    expect(input.getAttribute("aria-describedby")).toBe(helper.id);
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("RF01-06: OrbitInput error sets aria-invalid=true and points aria-describedby to error alert", () => {
    render(
      <OrbitInput
        label="Host URL"
        helperText="Include protocol"
        errorText="Invalid URL format"
      />
    );
    const input = screen.getByRole("textbox", { name: "Host URL" });
    const errorAlert = screen.getByRole("alert");
    const helper = screen.getByText("Include protocol");

    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby") || "";
    expect(describedBy).toContain(errorAlert.id);
    expect(describedBy).toContain(helper.id);
    expect(errorAlert.textContent).toBe("Invalid URL format");
  });

  it("RF01-07: OrbitSelect adheres to identical aria-describedby and error contracts", () => {
    render(
      <OrbitSelect
        label="Environment"
        helperText="Choose execution target"
        errorText="Target is currently unavailable"
        options={[
          { value: "prod", label: "Production" },
          { value: "staging", label: "Staging" },
        ]}
      />
    );
    const select = screen.getByRole("combobox", { name: "Environment" });
    const errorAlert = screen.getByRole("alert");
    const helper = screen.getByText("Choose execution target");

    expect(select.getAttribute("aria-invalid")).toBe("true");
    const describedBy = select.getAttribute("aria-describedby") || "";
    expect(describedBy).toContain(errorAlert.id);
    expect(describedBy).toContain(helper.id);
    expect(errorAlert.textContent).toBe("Target is currently unavailable");
  });

  it("RF01-08: multiple OrbitInput with duplicate label generate unique IDs and correct label associations", () => {
    render(
      <div>
        <OrbitInput label="Model" placeholder="First Model" />
        <OrbitInput label="Model" placeholder="Second Model" />
      </div>
    );

    const input1 = screen.getByPlaceholderText("First Model");
    const input2 = screen.getByPlaceholderText("Second Model");
    const labels = screen.getAllByText("Model");

    expect(labels.length).toBe(2);
    expect(input1.id).toBeDefined();
    expect(input2.id).toBeDefined();
    expect(input1.id).not.toBe(input2.id);

    expect(labels[0].getAttribute("for")).toBe(input1.id);
    expect(labels[1].getAttribute("for")).toBe(input2.id);
  });

  it("RF01-09: multiple OrbitSelect with duplicate label generate unique IDs and correct label associations", () => {
    render(
      <div>
        <OrbitSelect
          label="Model"
          options={[{ value: "a", label: "Model A" }]}
        />
        <OrbitSelect
          label="Model"
          options={[{ value: "b", label: "Model B" }]}
        />
      </div>
    );

    const selects = screen.getAllByRole("combobox");
    const labels = screen.getAllByText("Model");

    expect(selects.length).toBe(2);
    expect(labels.length).toBe(2);
    expect(selects[0].id).toBeDefined();
    expect(selects[1].id).toBeDefined();
    expect(selects[0].id).not.toBe(selects[1].id);

    expect(labels[0].getAttribute("for")).toBe(selects[0].id);
    expect(labels[1].getAttribute("for")).toBe(selects[1].id);
  });

  it("RF01-10: motion token values have exactly one authoritative source", () => {
    // orbitTokens is the authoritative source; orbitMotion directly derives from it
    expect(ORBIT_MOTION_DURATIONS.microMs).toBe(orbitTokens.motion.duration.fast);
    expect(ORBIT_MOTION_DURATIONS.normalMs).toBe(orbitTokens.motion.duration.normal);
    expect(ORBIT_MOTION_DURATIONS.panelMs).toBe(orbitTokens.motion.duration.panel);
    expect(ORBIT_EASINGS).toBe(orbitTokens.motion.easing);

    // Verify file content confirms no hardcoded duplicate numbers in orbitMotion.ts
    const motionFile = fs.readFileSync(path.resolve(__dirname, "orbitMotion.ts"), "utf-8");
    expect(motionFile).not.toMatch(/microMs:\s*140/);
    expect(motionFile).not.toMatch(/normalMs:\s*180/);
    expect(motionFile).not.toMatch(/panelMs:\s*220/);
  });

  it("RF01-11: new primitive semantic colors and component geometry originate from tokens", () => {
    const primitivesFile = fs.readFileSync(
      path.resolve(__dirname, "orbitPrimitives.tsx"),
      "utf-8"
    );

    // No hardcoded raw colors outside tokens
    expect(primitivesFile).not.toContain("#6366f1");
    expect(primitivesFile).not.toContain("#4f46e5");
    expect(primitivesFile).not.toContain("#10b981");
    expect(primitivesFile).not.toContain("#ef4444");
    expect(primitivesFile).not.toContain("#2563EB");
    expect(primitivesFile).not.toContain("#FFFFFF");

    // Geometry is derived from orbitComponent token
    expect(orbitComponent.toggle.trackWidth).toBe(38);
    expect(orbitComponent.toggle.trackHeight).toBe(22);
    expect(orbitComponent.toggle.thumbSize).toBe(16);
    expect(orbitComponent.toggle.thumbTranslateX).toBe(16);
    expect(orbitComponent.badge.dotSize).toBe(6);
    expect(orbitComponent.badge.gap).toBe(6);
    expect(orbitComponent.status.dotSize).toBe(8);
    expect(orbitComponent.disclosure.chevronSize).toBe(10);
    expect(orbitComponent.spinner.size).toBe(12);
  });

  it("RF01-12: UI-00A / UI-00B regressions and NO_AUTOMATIC_SUBMISSION remain PASS", () => {
    // Provenance
    const authoritativeResult: ParseResult = {
      blockId: "b1",
      questionType: "single_choice",
      answer: "A",
      confidence: 1,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "Q",
      routeUsed: "text",
      resultSource: "provider",
    };
    expect(isParseResultFillAuthoritative(authoritativeResult)).toBe(true);

    // Feedback
    const fb = userFeedback("info", "Processing candidate");
    expect(fb.tone).toBe("info");
    expect(fb.message).toBe("Processing candidate");

    // No auto submit
    const submitHandler = vi.fn();
    render(
      <form onSubmit={submitHandler}>
        <OrbitButton>Manual Trigger</OrbitButton>
      </form>
    );
    fireEvent.click(screen.getByRole("button", { name: "Manual Trigger" }));
    expect(submitHandler).not.toHaveBeenCalled();
  });
});
