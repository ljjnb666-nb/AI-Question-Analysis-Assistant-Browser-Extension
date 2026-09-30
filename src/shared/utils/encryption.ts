/**
 * Local credential storage protection.
 *
 * This protects against accidental plaintext disclosure in extension storage.
 * The encryption key is deterministically derived from the public extension ID,
 * so it does not protect against an attacker who can read both the extension
 * code and its local storage.
 */

import { logError } from "./errorLogger";

/**
 * Format marker of the current ciphertext envelope: `qse:v1:<base64>`.
 * The prefix identifies the storage format and its version; it is not a
 * secret and adds no confidentiality by itself.
 */
export const ENCRYPTED_VALUE_PREFIX = "qse:v1:";

/** Namespace shared by every `qse:*` envelope version, current and future. */
const ENVELOPE_NAMESPACE = "qse:";

// Fixed derivation salt. Public by construction: it pins the scheme and does
// not add secrecy.
const SALT = new TextEncoder().encode("quiz-solver-ext-v1");

/**
 * Thrown when a stored credential claims a `qse:*` envelope this build cannot
 * decode. Callers must fail closed on it, never fall back to plaintext.
 */
export class UnsupportedCredentialFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedCredentialFormatError";
  }
}

function createErrorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

/**
 * Derive deterministic local-storage encryption key.
 *
 * The key is a pure function of public inputs (extension ID + fixed salt);
 * it is never a generated secret. The derived key is memoized per extension
 * ID so reads do not pay PBKDF2 on every load.
 */
let derivedKeyCache: { extensionId: string; promise: Promise<CryptoKey> } | null = null;

async function getEncryptionKey(): Promise<CryptoKey> {
  const extensionId = chrome.runtime.id;
  if (derivedKeyCache?.extensionId === extensionId) {
    return derivedKeyCache.promise;
  }
  const promise = deriveEncryptionKey(extensionId).catch((err) => {
    // Never cache a failed derivation: a transient environment error must
    // not poison later attempts.
    if (derivedKeyCache?.promise === promise) derivedKeyCache = null;
    throw err;
  });
  derivedKeyCache = { extensionId, promise };
  return promise;
}

async function deriveEncryptionKey(extensionId: string): Promise<CryptoKey> {
  try {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(extensionId),
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );

    return await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: SALT,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } catch (err) {
    logError("Failed to derive encryption key", err, "getEncryptionKey");
    throw createErrorWithCause("Encryption key derivation failed", err);
  }
}

/**
 * True when the value claims any `qse:*` envelope version, including versions
 * this build cannot decode.
 */
export function isCredentialEnvelope(value: string): boolean {
  return typeof value === "string" && value.startsWith(ENVELOPE_NAMESPACE);
}

/**
 * True only for the current `qse:v1:` envelope. This is an exact format
 * check, never a heuristic: length and character sets must not be used to
 * guess whether a credential is encrypted.
 */
export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(ENCRYPTED_VALUE_PREFIX);
}

/** Strip the versioned envelope and reject unknown `qse:*` versions. */
function envelopePayload(value: string): string {
  if (value.startsWith(ENCRYPTED_VALUE_PREFIX)) {
    return value.slice(ENCRYPTED_VALUE_PREFIX.length);
  }
  throw new UnsupportedCredentialFormatError(
    isCredentialEnvelope(value)
      ? "Credential uses an unsupported envelope version"
      : "Credential is not a versioned envelope",
  );
}

/**
 * Encrypt a string value.
 * Returns the `qse:v1:<base64>` envelope, where base64 is IV[12] || ciphertext+tag.
 */
export async function encryptValue(plaintext: string): Promise<string> {
  if (!plaintext) return "";

  try {
    const key = await getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );

    // Combine IV + ciphertext and encode as base64
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return ENCRYPTED_VALUE_PREFIX + btoa(String.fromCharCode(...combined));
  } catch (err) {
    logError("Encryption failed", err, "encryptValue");
    throw createErrorWithCause("Failed to encrypt value", err);
  }
}

/**
 * Decrypt a `qse:v1:` envelope value. Fails closed on tampering, wrong
 * extension ID, or unknown envelope versions.
 */
export async function decryptValue(encrypted: string): Promise<string> {
  if (!encrypted) return "";

  try {
    const payload = envelopePayload(encrypted);
    const key = await getEncryptionKey();

    // Decode base64
    const combined = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
    if (combined.length <= 12) throw new Error("ciphertext payload too short");

    // Extract IV and ciphertext
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch (err) {
    logError("Decryption failed", err, "decryptValue");
    throw createErrorWithCause("Failed to decrypt value", err);
  }
}

export type LegacyCredentialDecode =
  | { kind: "legacy_ciphertext"; plaintext: string }
  | { kind: "legacy_plaintext"; plaintext: string };

/**
 * Decode a stored credential written by a version that had no format marker.
 *
 * Legacy storage cannot distinguish an unversioned ciphertext from an
 * arbitrary base64-like plaintext credential, so this decoder never clears a
 * value: if the old-format decrypt fails, the original string is returned as
 * the plaintext it may be. Known consequence: a tampered legacy ciphertext is
 * indistinguishable from plaintext and cannot fail closed; only `qse:v1:`
 * envelopes guarantee tamper fail-closed behavior.
 */
export async function tryDecryptLegacyValue(
  value: string
): Promise<LegacyCredentialDecode> {
  try {
    const key = await getEncryptionKey();
    const combined = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    if (combined.length <= 12) throw new Error("legacy payload too short");

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return { kind: "legacy_ciphertext", plaintext: new TextDecoder().decode(decrypted) };
  } catch {
    return { kind: "legacy_plaintext", plaintext: value };
  }
}
