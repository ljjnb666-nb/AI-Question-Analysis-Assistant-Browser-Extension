import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { UserFeedback } from "@/shared/ui/userFeedback";
import { CandidateFeedbackCard } from "./candidatesTabSections";

describe("CandidateFeedbackCard tone semantics (UI-00B PART C)", () => {
  it("UI00B-06: a success feedback renders the success semantic", () => {
    const feedback: UserFeedback = { tone: "success", message: "填写完成" };
    render(<CandidateFeedbackCard fillFeedback={feedback} />);
    const card = screen.getByRole("status");
    expect(card.getAttribute("data-feedback-tone")).toBe("success");
    expect(card.textContent).toBe("填写完成");
    // Success keeps the green family.
    expect(card.style.borderColor).toContain("16, 185, 129");
  });

  it("UI00B-07: an error feedback renders the error semantic, never the success visual", () => {
    const feedback: UserFeedback = { tone: "error", message: "操作失败，请稍后重试。" };
    render(<CandidateFeedbackCard fillFeedback={feedback} />);
    const card = screen.getByRole("status");
    expect(card.getAttribute("data-feedback-tone")).toBe("error");
    expect(card.style.borderColor).not.toContain("16, 185, 129");
    expect(card.style.borderColor).toContain("239, 68, 68");
  });

  it("warning and info feedback get their own semantics", () => {
    const { container: warningHost } = render(
      <CandidateFeedbackCard fillFeedback={{ tone: "warning", message: "w" }} />,
    );
    expect(warningHost.querySelector('[data-feedback-tone="warning"]')).not.toBeNull();

    const { container: infoHost, unmount } = render(
      <CandidateFeedbackCard fillFeedback={{ tone: "info", message: "i" }} />,
    );
    expect(infoHost.querySelector('[data-feedback-tone="info"]')).not.toBeNull();
    unmount();
  });

  it("renders nothing for empty feedback", () => {
    const { container } = render(<CandidateFeedbackCard fillFeedback={null} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
