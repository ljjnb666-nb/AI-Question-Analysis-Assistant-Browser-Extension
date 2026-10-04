import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types";


import {
  DEMO_RESULT_NOT_FILLABLE,
  UNVERIFIED_RESULT_SOURCE,
  getParseResultAuthority,
  getProviderNotConfiguredMessage,
  getUnfillableResultCode,
  isParseResultFillAuthoritative,
} from "./parseResultAuthority";

describe("parseResultAuthority (UI-00A)", () => {
  describe("getParseResultAuthority / isParseResultFillAuthoritative (UI00A-07)", () => {
    it("grants fill authority only to provable provider results", () => {
      expect(getParseResultAuthority({ resultSource: "provider" })).toBe("provider");
      expect(isParseResultFillAuthoritative({ resultSource: "provider" })).toBe(true);
    });

    it("never grants fill authority to mock results", () => {
      expect(getParseResultAuthority({ resultSource: "mock" })).toBe("mock");
      expect(isParseResultFillAuthoritative({ resultSource: "mock" })).toBe(false);
    });

    it("treats missing provenance as legacy-unknown without fill authority", () => {
      expect(getParseResultAuthority({})).toBe("legacy-unknown");
      expect(isParseResultFillAuthoritative({})).toBe(false);
      expect(getUnfillableResultCode({})).toBe(UNVERIFIED_RESULT_SOURCE);
    });

    it("maps mock rejections to the stable demo code", () => {
      expect(getUnfillableResultCode({ resultSource: "mock" })).toBe(DEMO_RESULT_NOT_FILLABLE);
    });
  });

  describe("provider not configured message", () => {
    it("produces a natural zh hint and an en hint", () => {
      expect(getProviderNotConfiguredMessage(DEFAULT_SETTINGS.language)).toContain("请先在设置");
      expect(getProviderNotConfiguredMessage("en")).toContain("Please select an AI provider");
    });
  });
});
