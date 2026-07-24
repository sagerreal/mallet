import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { createSecretBox, generateKey } from "./secret-box";

const key = () => randomBytes(32).toString("base64");

describe("createSecretBox", () => {
  it("rejects a key that is not 32 bytes", () => {
    const res = createSecretBox(randomBytes(16).toString("base64"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("validation");
  });

  it("rejects a key that is not valid base64", () => {
    const res = createSecretBox("not base64 !!!");
    expect(res.ok).toBe(false);
  });

  it("accepts a 32-byte base64 key", () => {
    expect(createSecretBox(key()).ok).toBe(true);
  });

  it("generateKey produces a key the box accepts", () => {
    expect(createSecretBox(generateKey()).ok).toBe(true);
  });
});

describe("seal / open", () => {
  const box = () => {
    const res = createSecretBox(key());
    if (!res.ok) throw new Error("fixture key rejected");
    return res.value;
  };

  it("round-trips a token", () => {
    const b = box();
    const plaintext = "AB11695800000000000000000000000000000000000000000000";
    const opened = b.open(b.seal(plaintext));
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.value).toBe(plaintext);
  });

  it("round-trips unicode and empty strings", () => {
    const b = box();
    for (const plaintext of ["", "réfresh–tøken✓", "a".repeat(4096)]) {
      const opened = b.open(b.seal(plaintext));
      expect(opened.ok).toBe(true);
      if (opened.ok) expect(opened.value).toBe(plaintext);
    }
  });

  it("never emits the plaintext in the sealed form", () => {
    const b = box();
    const plaintext = "super-secret-refresh-token";
    expect(b.seal(plaintext)).not.toContain(plaintext);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const b = box();
    expect(b.seal("same")).not.toBe(b.seal("same"));
  });

  it("stamps a version prefix so keys can be rotated later", () => {
    expect(box().seal("x").startsWith("v1.")).toBe(true);
  });
});

describe("open — tamper and misuse are errors, never silent", () => {
  const sealedWith = (k: string, plaintext: string) => {
    const res = createSecretBox(k);
    if (!res.ok) throw new Error("fixture key rejected");
    return res.value.seal(plaintext);
  };
  const openWith = (k: string, sealed: string) => {
    const res = createSecretBox(k);
    if (!res.ok) throw new Error("fixture key rejected");
    return res.value.open(sealed);
  };

  it("fails to open with a different key", () => {
    const sealed = sealedWith(key(), "secret");
    const opened = openWith(key(), sealed);
    expect(opened.ok).toBe(false);
  });

  it("fails on a flipped ciphertext byte (GCM auth tag catches it)", () => {
    const k = key();
    const sealed = sealedWith(k, "secret");
    const parts = sealed.split(".");
    const ct = Buffer.from(parts[3] as string, "base64");
    ct[0] = (ct[0] as number) ^ 0xff;
    parts[3] = ct.toString("base64");
    expect(openWith(k, parts.join(".")).ok).toBe(false);
  });

  it("fails on a truncated or malformed envelope", () => {
    const k = key();
    for (const bad of ["", "v1.", "v1.a.b", "garbage", "v1.a.b.c.d"]) {
      expect(openWith(k, bad).ok).toBe(false);
    }
  });

  it("fails on an unknown version prefix", () => {
    const k = key();
    const sealed = sealedWith(k, "secret");
    const bumped = `v2.${sealed.split(".").slice(1).join(".")}`;
    const opened = openWith(k, bumped);
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.error.message).toMatch(/version/i);
  });

  it("does not leak the plaintext or the key in the error message", () => {
    const k = key();
    const sealed = sealedWith(k, "the-secret-value");
    const opened = openWith(key(), sealed);
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.error.message).not.toContain("the-secret-value");
      expect(opened.error.message).not.toContain(k);
    }
  });
});
