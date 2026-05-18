/**
 * crypto.ts — AES-256-GCM credential encryption/decryption
 *
 * Usage:
 *   const cipher = encryptCredentials({ swid: "...", espnS2: "..." });
 *   // store `cipher` (string) in DB
 *
 *   const plain = decryptCredentials(cipher);
 *   // plain is the original object, or null on failure
 *
 * Key: ESPN_CRED_ENCRYPTION_KEY or CREDENTIAL_ENCRYPTION_KEY env var —
 * 32-byte hex string (64 hex chars).
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * If the key is missing the helpers fall back to base64 encoding so the app
 * still works during local development, but a warning is logged.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 12;  // 96-bit IV recommended for GCM
const TAG_LEN = 16; // 128-bit auth tag

function getKey(): Buffer | null {
  const raw = process.env.ESPN_CRED_ENCRYPTION_KEY || process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) {
    console.warn("[crypto] ESPN_CRED_ENCRYPTION_KEY/CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex chars). Falling back to base64.");
    return null;
  }
  return buf;
}

/**
 * Encrypt a credentials object to an opaque string for DB storage.
 * Format (when key present): `enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>`
 * Format (fallback):         `b64:<base64_json>`
 */
export function encryptCredentials(obj: Record<string, unknown>): string {
  const key = getKey();
  const json = JSON.stringify(obj);

  if (!key) {
    console.warn("[crypto] No ESPN_CRED_ENCRYPTION_KEY/CREDENTIAL_ENCRYPTION_KEY — storing credentials as base64 (not encrypted). Set the key in production.");
    return "b64:" + Buffer.from(json).toString("base64");
  }

  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a credentials string produced by encryptCredentials.
 * Returns the original object, or null if decryption fails.
 */
export function decryptCredentials(cipher: string): Record<string, unknown> | null {
  if (!cipher) return null;

  try {
    if (cipher.startsWith("b64:")) {
      const json = Buffer.from(cipher.slice(4), "base64").toString("utf8");
      return JSON.parse(json);
    }

    if (cipher.startsWith("enc:v1:")) {
      const key = getKey();
      if (!key) {
        console.warn("[crypto] Cannot decrypt enc:v1 credential — ESPN_CRED_ENCRYPTION_KEY/CREDENTIAL_ENCRYPTION_KEY is missing.");
        return null;
      }
      const parts = cipher.split(":");
      // parts: ["enc", "v1", iv_hex, tag_hex, ciphertext_hex]
      if (parts.length !== 5) return null;
      const iv = Buffer.from(parts[2], "hex");
      const tag = Buffer.from(parts[3], "hex");
      const encrypted = Buffer.from(parts[4], "hex");

      const decipher = createDecipheriv(ALG, key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return JSON.parse(decrypted.toString("utf8"));
    }

    // Legacy: raw JSON stored before encryption was added
    return JSON.parse(cipher);
  } catch (err) {
    console.error("[crypto] Failed to decrypt credentials:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Convenience: encrypt a credentials object and return it as a JSON-compatible
 * value suitable for storing in a Drizzle `json()` column.
 * We store it as `{ _enc: "<cipher_string>" }` so the column type stays JSON.
 */
export function encryptCredentialsForDb(obj: Record<string, unknown>): Record<string, string> {
  return { _enc: encryptCredentials(obj) };
}

/**
 * Convenience: decrypt credentials from a Drizzle `json()` column value.
 * Handles both the new `{ _enc: "..." }` format and legacy plain-object format.
 */
export function decryptCredentialsFromDb(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // New encrypted format
  if (typeof obj._enc === "string") {
    return decryptCredentials(obj._enc);
  }

  // Legacy: plain object (pre-encryption migration)
  return obj;
}
