import { describe, it, expect, beforeEach } from "vitest";
import {
  ENCRYPTED_VALUE_PREFIX,
  UnsupportedCredentialFormatError,
  decryptValue,
  encryptValue,
  isCredentialEnvelope,
  isEncrypted,
  tryDecryptLegacyValue,
} from "./encryption";

const TEST_EXTENSION_ID = "test-extension-id-12345";

// Mock chrome.runtime.id
beforeEach(() => {
  Object.defineProperty(chrome.runtime, "id", {
    value: TEST_EXTENSION_ID,
    writable: true,
  });
});

/** Flip one character inside the base64 payload, keeping the envelope prefix. */
function tamperEnvelopePayload(envelope: string): string {
  const payload = envelope.slice(ENCRYPTED_VALUE_PREFIX.length);
  const middle = Math.floor(payload.length / 2);
  const swapped = payload[middle] === "A" ? "B" : "A";
  return envelope.slice(0, ENCRYPTED_VALUE_PREFIX.length) + payload.slice(0, middle) + swapped + payload.slice(middle + 1);
}

describe("encryption", () => {
  describe("encryptValue and decryptValue", () => {
    it("KEY_01_ENCRYPT_DECRYPT_ROUNDTRIP wraps ciphertext in the qse:v1 envelope", async () => {
      const plaintext = "fake-key-do-not-use";
      const encrypted = await encryptValue(plaintext);

      expect(encrypted.startsWith(ENCRYPTED_VALUE_PREFIX)).toBe(true);
      expect(await decryptValue(encrypted)).toBe(plaintext);
      expect(encrypted).not.toContain(plaintext);
    });

    it("should handle empty string", async () => {
      expect(await encryptValue("")).toBe("");
      expect(await decryptValue("")).toBe("");
    });

    it("should handle unicode characters", async () => {
      const plaintext = "测试密钥🔐";
      expect(await decryptValue(await encryptValue(plaintext))).toBe(plaintext);
    });

    it("should throw when the envelope prefix is missing", async () => {
      await expect(decryptValue("dGVzdA==")).rejects.toThrow();
    });
  });

  describe("KEY_02_RANDOM_IV_PRODUCES_DISTINCT_CIPHERTEXT", () => {
    it("produces different envelopes for the same plaintext and decrypts both", async () => {
      const plaintext = "test-secret";
      const encrypted1 = await encryptValue(plaintext);
      const encrypted2 = await encryptValue(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
      expect(await decryptValue(encrypted1)).toBe(plaintext);
      expect(await decryptValue(encrypted2)).toBe(plaintext);
    });
  });

  describe("KEY_03_VERSIONED_TAMPERED_CIPHERTEXT_FAILS_CLOSED", () => {
    it("rejects a flipped payload byte", async () => {
      const encrypted = await encryptValue("fake-key-do-not-use");
      await expect(decryptValue(tamperEnvelopePayload(encrypted))).rejects.toThrow();
    });

    it("rejects a truncated payload", async () => {
      const encrypted = await encryptValue("fake-key-do-not-use");
      await expect(decryptValue(encrypted.slice(0, encrypted.length - 8))).rejects.toThrow();
    });

    it("rejects an envelope whose prefix was corrupted", async () => {
      const encrypted = await encryptValue("fake-key-do-not-use");
      const corrupted = encrypted.replace(ENCRYPTED_VALUE_PREFIX, "qse:vx:");
      expect(isEncrypted(corrupted)).toBe(false);
      await expect(decryptValue(corrupted)).rejects.toThrow();
    });
  });

  describe("KEY_04_CODE_PLUS_STORAGE_ATTACKER_CAN_DERIVE_KEY", () => {
    // This is an expected threat-model proof, not a security failure.
    // The key is derived from the public extension ID + a fixed salt, so an
    // attacker who can read the extension bundle and chrome.storage.local can
    // reproduce it offline with an independent implementation.
    it("an independent implementation recovers the plaintext from public inputs", async () => {
      const fakeSecret = "fake-key-attacker-proof";
      const envelope = await encryptValue(fakeSecret);

      // Attacker path: no production decryptValue, only public parameters.
      const payload = envelope.slice(ENCRYPTED_VALUE_PREFIX.length);
      const combined = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
      const iv = combined.slice(0, 12);
      const ciphertext = combined.slice(12);

      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(TEST_EXTENSION_ID),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
      );
      const key = await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: new TextEncoder().encode("quiz-solver-ext-v1"),
          iterations: 100000,
          hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
      );
      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);

      expect(new TextDecoder().decode(decrypted)).toBe(fakeSecret);
    });
  });

  describe("KEY_13_WRONG_EXTENSION_ID_FAILS_VERSIONED_DECRYPT", () => {
    it("rejects envelopes when derived from a different extension ID", async () => {
      const envelope = await encryptValue("fake-key-do-not-use");

      Object.defineProperty(chrome.runtime, "id", {
        value: "a-different-extension-id",
        writable: true,
      });
      await expect(decryptValue(envelope)).rejects.toThrow();
    });
  });

  describe("KEY_14_FORMAT_VERSIONING", () => {
    it("recognizes the qse:* namespace and the exact current version", () => {
      expect(isCredentialEnvelope("qse:v1:AAAA")).toBe(true);
      expect(isCredentialEnvelope("qse:v2:AAAA")).toBe(true);
      expect(isEncrypted("qse:v1:AAAA")).toBe(true);
      expect(isEncrypted("qse:v2:AAAA")).toBe(false);
    });

    it("fails closed on unknown qse versions instead of treating them as plaintext", async () => {
      const err = await decryptValue("qse:v2:AAAA").catch((caught: Error) => caught);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error & { cause?: unknown }).cause).toBeInstanceOf(
        UnsupportedCredentialFormatError
      );
    });

    it("no longer classifies base64-shaped strings as encrypted", () => {
      // The old heuristic (base64 charset + length > 40) misclassified plain
      // custom-provider keys; format detection must stay exact.
      expect(isEncrypted("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")).toBe(false);
      expect(isEncrypted("Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2Mm3NnOoPp")).toBe(false);
      expect(isEncrypted(btoa("a".repeat(50)))).toBe(false);
    });
  });

  describe("tryDecryptLegacyValue", () => {
    it("decodes unversioned legacy ciphertext", async () => {
      const envelope = await encryptValue("legacy-credential-value");
      const legacyCiphertext = envelope.slice(ENCRYPTED_VALUE_PREFIX.length);

      expect(isEncrypted(legacyCiphertext)).toBe(false);
      const decoded = await tryDecryptLegacyValue(legacyCiphertext);
      expect(decoded).toEqual({ kind: "legacy_ciphertext", plaintext: "legacy-credential-value" });
    });

    it("returns base64-like legacy plaintext unchanged instead of clearing it", async () => {
      const legacyPlaintext = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

      const decoded = await tryDecryptLegacyValue(legacyPlaintext);
      expect(decoded).toEqual({ kind: "legacy_plaintext", plaintext: legacyPlaintext });
    });

    it("returns a tampered legacy ciphertext unchanged (known legacy limitation)", async () => {
      // Without a format marker a tampered legacy ciphertext is
      // indistinguishable from an arbitrary plaintext credential; only the
      // versioned qse:v1 envelope guarantees tamper fail-closed behavior.
      const envelope = await encryptValue("legacy-credential-value");
      const tamperedLegacy = tamperEnvelopePayload(envelope).slice(ENCRYPTED_VALUE_PREFIX.length);

      const decoded = await tryDecryptLegacyValue(tamperedLegacy);
      expect(decoded).toEqual({ kind: "legacy_plaintext", plaintext: tamperedLegacy });
    });
  });
});
