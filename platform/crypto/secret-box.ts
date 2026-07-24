import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import type { Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";

// Authenticated symmetric encryption for secrets we must recover in plaintext later — OAuth
// refresh tokens, chiefly. This is deliberately NOT the api_keys model: that stores a one-way
// SHA-256 hash, which works for "is this the key you showed me once?" but not for "give me back
// the token so I can replay it to Intuit".
//
// Envelope: "v1.<iv>.<tag>.<ciphertext>", each part base64. The version prefix exists so a future
// key rotation can decrypt old values while writing new ones — open() refuses versions it doesn't
// implement rather than guessing.
//
// Failures are Results, never throws and never silent: a tampered or foreign-key ciphertext must
// surface as an error the caller handles (re-auth the tenant), not as an empty string that would
// silently send an unauthenticated request.

const VERSION = "v1";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;

export interface SecretBox {
  /** Encrypt + authenticate. Output is safe to store in a text column. */
  seal(plaintext: string): string;
  /** Decrypt + verify. Errors on a wrong key, tampering, or a malformed envelope. */
  open(sealed: string): Result<string, ValidationError>;
}

/** Mint a fresh base64 key suitable for QBO_TOKEN_ENCRYPTION_KEY. Not used at runtime. */
export const generateKey = (): string => randomBytes(KEY_BYTES).toString("base64");

// base64 round-trips loosely in Node (it ignores junk), so verify the decoded bytes re-encode to
// the input before trusting the length check.
const decodeKey = (keyBase64: string): Buffer | null => {
  const buf = Buffer.from(keyBase64, "base64");
  if (buf.length !== KEY_BYTES) return null;
  if (buf.toString("base64") !== keyBase64.trim()) return null;
  return buf;
};

export const createSecretBox = (keyBase64: string): Result<SecretBox, ValidationError> => {
  const key = decodeKey(keyBase64);
  if (!key) {
    // Never echo the supplied value — it is a key.
    return err(
      validation(`encryption key must be ${KEY_BYTES} base64-encoded bytes`, "encryptionKey"),
    );
  }

  const seal = (plaintext: string): string => {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString("base64"),
      tag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(".");
  };

  const open = (sealed: string): Result<string, ValidationError> => {
    const parts = sealed.split(".");
    if (parts.length !== 4) {
      return err(validation("malformed encrypted value", "sealed"));
    }
    const [version, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
    if (version !== VERSION) {
      return err(validation(`unsupported encryption version "${version}"`, "sealed"));
    }

    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ciphertext = Buffer.from(ctB64, "base64");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      return err(validation("malformed encrypted value", "sealed"));
    }

    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return ok(plaintext.toString("utf8"));
    } catch {
      // GCM auth failure — wrong key or tampered payload. The cause is deliberately not echoed:
      // it would be an oracle, and the caller's remedy is the same either way (re-authenticate).
      return err(validation("could not decrypt value", "sealed"));
    }
  };

  return ok({ seal, open });
};

/** Constant-time equality for secrets compared outside the box (e.g. OAuth `state`). */
export const secretEquals = (a: string, b: string): boolean => {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};
