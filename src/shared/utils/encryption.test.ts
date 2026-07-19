import { describe, it, expect, beforeEach } from "vitest";
import { encryptValue, decryptValue, isEncrypted } from "./encryption";

// Mock chrome.runtime.id
beforeEach(() => {
  Object.defineProperty(chrome.runtime, "id", {
    value: "test-extension-id-12345",
    writable: true,
  });
});

describe("encryption", () => {
  describe("encryptValue and decryptValue", () => {
    it("should encrypt and decrypt a string", async () => {
      const plaintext = "sk-test-api-key-12345";
      const encrypted = await encryptValue(plaintext);
      const decrypted = await decryptValue(encrypted);

      expect(decrypted).toBe(plaintext);
      expect(encrypted).not.toBe(plaintext);
    });

    it("should produce different ciphertext for same plaintext (due to random IV)", async () => {
      const plaintext = "test-secret";
      const encrypted1 = await encryptValue(plaintext);
      const encrypted2 = await encryptValue(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
      expect(await decryptValue(encrypted1)).toBe(plaintext);
      expect(await decryptValue(encrypted2)).toBe(plaintext);
    });

    it("should handle empty string", async () => {
      const encrypted = await encryptValue("");
      expect(encrypted).toBe("");

      const decrypted = await decryptValue("");
      expect(decrypted).toBe("");
    });

    it("should handle unicode characters", async () => {
      const plaintext = "测试密钥🔐";
      const encrypted = await encryptValue(plaintext);
      const decrypted = await decryptValue(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should throw on invalid encrypted data", async () => {
      await expect(decryptValue("invalid-base64!!!")).rejects.toThrow();
    });
  });

  describe("isEncrypted", () => {
    it("should detect encrypted values", async () => {
      const plaintext = "sk-test-key";
      const encrypted = await encryptValue(plaintext);

      expect(isEncrypted(encrypted)).toBe(true);
      expect(isEncrypted(plaintext)).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isEncrypted("")).toBe(false);
    });

    it("should return false for short base64 strings", () => {
      expect(isEncrypted("dGVzdA==")).toBe(false); // "test" in base64
    });

    it("should return true for long base64 strings", () => {
      const longBase64 = btoa("a".repeat(50));
      expect(isEncrypted(longBase64)).toBe(true);
    });
  });
});
