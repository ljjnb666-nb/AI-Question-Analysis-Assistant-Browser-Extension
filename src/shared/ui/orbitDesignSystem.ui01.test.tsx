import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import {
  orbitTokens,
  orbitColors,
  orbitSpacing,
  orbitRadius,
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
} from "./orbitMotion";
import { userFeedback, mapKnownCodeFeedback, mapUserFacingError } from "./userFeedback";
import {
  isParseResultFillAuthoritative,
} from "../ai/parseResultAuthority";
import type { ParseResult } from "../types";

describe("Orbit Console Design System Foundation (UI-01)", () => {
  it("UI01-01: design token module exports required semantic groups", () => {
    expect(orbitTokens).toBeDefined();
    expect(orbitTokens.color).toBeDefined();
    expect(orbitTokens.spacing).toBeDefined();
    expect(orbitTokens.radius).toBeDefined();
    expect(orbitTokens.typography).toBeDefined();
    expect(orbitTokens.controlHeight).toBeDefined();
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
    expect(btn.style.color).toBe(orbitColors.text.muted);
  });

  it("UI01-04: Button keyboard focus mechanism exists", () => {
    render(<OrbitButton variant="primary">Focus Me</OrbitButton>);
    const btn = screen.getByRole("button", { name: "Focus Me" });
    expect(btn.style.outline).toContain("none");

    fireEvent.focus(btn);
    // Focus visible styling applied
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
    render(<OrbitInput label="Target URL" placeholder="https://" />);
    const input = screen.getByPlaceholderText("https://") as HTMLInputElement;

    // Default border
    expect(input.style.borderColor).toBe(orbitColors.border.default);

    // Focus triggers visible focus styling
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

    // Mock matchMedia for testing reduced motion branch
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

    // Known code mapping preserved
    const mapped = mapKnownCodeFeedback("STALE_QUESTION_REVISION", "zh");
    expect(mapped).not.toBeNull();
    expect(mapped?.tone).toBe("warning");

    // Raw exception never becomes primary user copy
    const errMapped = mapUserFacingError(new Error("Raw SQL connection timeout"), "zh");
    expect(errMapped.tone).toBe("error");
    expect(errMapped.message).not.toContain("Raw SQL connection timeout");
    expect(errMapped.technicalDetail).toContain("Raw SQL connection timeout");
  });

  it("UI01-12: NO_AUTOMATIC_SUBMISSION regression remains PASS", () => {
    // Form and button primitives do not cause automatic form submission or contain auto-submission text
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <OrbitButton>Manual Button</OrbitButton>
      </form>
    );

    const btn = screen.getByRole("button", { name: "Manual Button" });
    expect(btn.getAttribute("type")).toBe("button"); // Must not be type="submit"
    fireEvent.click(btn);
    expect(onSubmit).not.toHaveBeenCalled();

    // Verify copy does not imply automatic submission
    const primitivesFile = fs.readFileSync(
      path.resolve(__dirname, "orbitPrimitives.tsx"),
      "utf-8"
    );
    expect(primitivesFile).not.toContain("自动交卷");
    expect(primitivesFile).not.toContain("自动提交");
  });

  it("renders OrbitBadge, OrbitSelect, OrbitToggle, OrbitSectionHeader, and OrbitDisclosure", () => {
    const onToggle = vi.fn();
    render(
      <div>
        <OrbitBadge variant="ai" dot>AI Generated</OrbitBadge>
        <OrbitSelect label="Select Model" options={[{ value: "gpt", label: "GPT" }]} />
        <OrbitToggle checked={true} onChange={onToggle} label="Enable Cache" />
        <OrbitSectionHeader title="Configuration" description="Settings overview" />
        <OrbitDisclosure title="Technical Details">Error code 500</OrbitDisclosure>
      </div>
    );

    expect(screen.getByText("AI Generated")).toBeDefined();
    expect(screen.getByText("Select Model")).toBeDefined();
    expect(screen.getByText("Enable Cache")).toBeDefined();
    expect(screen.getByText("Configuration")).toBeDefined();
    expect(screen.getByText("Settings overview")).toBeDefined();

    const disclosureBtn = screen.getByText("Technical Details");
    fireEvent.click(disclosureBtn);
    expect(screen.getByText("Error code 500")).toBeDefined();
  });
});
