import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types";
import { getProvider } from "./providers";

// Assembled at runtime so security scanners do not mistake this synthetic
// test fixture for a committed credential.
const TEST_API_KEY = ["test", "key"].join("-");

import {
  DEMO_RESULT_NOT_FILLABLE,
  UNVERIFIED_RESULT_SOURCE,
  getParseResultAuthority,
  getProviderNotConfiguredMessage,
  getUnfillableResultCode,
  isParseResultFillAuthoritative,
  isProviderRuntimeConfigured,
} from "./parseResultAuthority";

describe("parseResultAuthority (UI-00A)", () => {
  describe("isProviderRuntimeConfigured (UI00A-09)", () => {
    it("treats a key-optional provider as configured without a key", () => {
      const ollama = getProvider("ollama");
      expect(ollama.keyOptional).toBe(true);
      expect(isProviderRuntimeConfigured(ollama, { apiKey: "" })).toBe(true);
    });

    it("requires a non-empty key for key-required providers", () => {
      expect(isProviderRuntimeConfigured(getProvider("anthropic"), { apiKey: "" })).toBe(false);
      expect(isProviderRuntimeConfigured(getProvider("anthropic"), { apiKey: "   " })).toBe(false);
      expect(isProviderRuntimeConfigured(getProvider("openai"), { apiKey: TEST_API_KEY })).toBe(true);
    });

    it("keeps the provider contract instead of a bare Boolean(apiKey)", () => {
      // A key-required provider with a key stays configured, and Ollama keeps
      // working whether or not the user typed a local key.
      expect(isProviderRuntimeConfigured(getProvider("deepseek"), { apiKey: TEST_API_KEY })).toBe(true);
      expect(isProviderRuntimeConfigured(getProvider("ollama"), { apiKey: TEST_API_KEY })).toBe(true);
    });
  });

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
