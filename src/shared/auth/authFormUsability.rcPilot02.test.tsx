import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AuthVerificationCodeInput } from "./AuthFields";
import { classifyAuthError } from "./authErrorContract";
import { getAuthText } from "./authText";
import { orbitColors } from "@/shared/ui/orbitTokens";

function VerificationFixture() {
  const [value, setValue] = useState("");
  return <AuthVerificationCodeInput value={value} onChange={setValue} lang="zh" />;
}

describe("RC-PILOT-02 registration usability", () => {
  it("moves focus forward while entering six digits, without a mouse", () => {
    render(<VerificationFixture />);
    const slots = Array.from({ length: 6 }, (_, n) => screen.getByRole("textbox", { name: `验证码第 ${n + 1} 位` }));
    slots[0].focus();
    for (let i = 0; i < 6; i += 1) {
      fireEvent.change(slots[i], { target: { value: String(i + 1) } });
      expect((slots[i] as HTMLInputElement).value).toBe(String(i + 1));
      if (i < 5) expect(slots[i + 1]).toHaveFocus();
    }
    expect(slots[5]).toHaveFocus();
  });

  it("pastes all six digits into six inputs and supports backspace navigation", () => {
    render(<VerificationFixture />);
    const slots = Array.from({ length: 6 }, (_, n) => screen.getByRole("textbox", { name: `验证码第 ${n + 1} 位` }));
    fireEvent.change(slots[0], { target: { value: "123456" } });
    expect(slots.map((slot) => (slot as HTMLInputElement).value).join("")).toBe("123456");
    fireEvent.change(slots[5], { target: { value: "" } });
    fireEvent.keyDown(slots[5], { key: "Backspace" });
    expect(slots[4]).toHaveFocus();
    fireEvent.keyDown(slots[4], { key: "ArrowLeft" });
    expect(slots[3]).toHaveFocus();
  });

  it("maps actual server password/code errors to specific safe Chinese text", () => {
    expect(classifyAuthError(new Error("password must be at least 6 characters"))).toBe("password_too_short");
    expect(classifyAuthError(new Error("invalid or expired verification code"))).toBe("invalid_verification_code");
    expect(getAuthText("zh", "popup").authFailureMessage("password_too_short")).toContain("至少需要 6 位");
    expect(getAuthText("zh", "settings").authFailureMessage("invalid_verification_code")).toContain("验证码");
    expect(classifyAuthError(new Error("internal stack password secret"))).toBe("generic");
  });

  it("separates low-contrast primary button blue from readable dark-surface link text", () => {
    expect(orbitColors.brand.primary).toBe("#2563EB");
    expect(orbitColors.brand.linkText).toBe("#93C5FD");
  });
});
