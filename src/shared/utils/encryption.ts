/**
 * Encryption Utilities (P0 - Security)
 * Uses Web Crypto API to encrypt/decrypt sensitive data like API keys
 */

import { logError } from "./errorLogger";

// Derive a key from extension ID (stable across sessions)
const SALT = new TextEncoder().encode("quiz-solver-ext-v1");

/**
 * Get or generate encryption key
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  try {
    // Use extension ID as base for key derivation
    const extensionId = chrome.runtime.id;
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
    throw new Error("Encryption key derivation failed");
  }
}

/**
 * Encrypt a string value
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

    return btoa(String.fromCharCode(...combined));
  } catch (err) {
    logError("Encryption failed", err, "encryptValue");
    throw new Error("Failed to encrypt value");
  }
}

/**
 * Decrypt a string value
 */
export async function decryptValue(encrypted: string): Promise<string> {
  if (!encrypted) return "";

  try {
    const key = await getEncryptionKey();

    // Decode base64
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));

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
    throw new Error("Failed to decrypt value");
  }
}

/**
 * Check if a value is encrypted (base64 format check)
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false;
  // Simple heuristic: encrypted values are base64 and longer than typical plaintext
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return base64Regex.test(value) && value.length > 40;
}
