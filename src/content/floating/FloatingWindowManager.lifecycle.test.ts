import React from "react";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import { FloatingWindowManager } from "./FloatingWindowManager";

vi.mock("@/shared/utils/storage", () => ({
  loadFloatingState: vi.fn(async () => ({})),
  saveFloatingState: vi.fn(),
}));
vi.mock("./FloatingWindow", () => ({
  FloatingWindow: (props: { onRetake: () => void }) =>
    React.createElement("button", { id: "lifecycle-retake", onClick: props.onRetake }, "retake"),
}));
vi.mock("@/shared/utils/analytics", () => ({ logEvent: vi.fn() }));

const block: QuestionBlock = {
  id: "floating-lifecycle",
  bbox: { x: 0, y: 0, width: 240, height: 100 },
  previewText: "floating manager lifecycle test",
  questionTypeGuess: "short_answer",
  confidence: 1,
  hasImage: false,
  source: "manual_capture",
};

describe("FloatingWindowManager hard disposal", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.getElementById("qs-floating-host")?.remove();
  });

  it("P10B-FLOATING-DISPOSE-01 unmounts the root, removes the host, and cancels delayed retake", async () => {
    vi.useFakeTimers();
    const manager = new FloatingWindowManager();
    const startRetake = vi.fn();
    manager.setOnRetake(startRetake);
    await act(async () => { await manager.init(); });
    await act(async () => {
      manager.open(block);
      await Promise.resolve();
    });

    const host = document.getElementById("qs-floating-host")!;
    const retake = host.shadowRoot?.getElementById("lifecycle-retake") as HTMLButtonElement;
    expect(host).toBeTruthy();
    expect(manager.hasOwnedRoot).toBe(true);
    await act(async () => { retake.click(); });

    manager.destroy();
    manager.destroy();
    expect(document.getElementById("qs-floating-host")).toBeNull();
    expect(manager.hasOwnedRoot).toBe(false);
    vi.advanceTimersByTime(200);
    expect(startRetake).not.toHaveBeenCalled();
    manager.open(block);
    manager.setError("late result");
    expect(document.getElementById("qs-floating-host")).toBeNull();
  });
});
