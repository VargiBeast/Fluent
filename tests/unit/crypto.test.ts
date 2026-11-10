import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { decrypt, encrypt, pkceChallenge, safeEqual, sha256 } from "../../server/crypto.js";
import { resetEnv } from "../../server/env.js";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  resetEnv();
});

describe("AES-256-GCM token encryption", () => {
  it("round-trips and produces a fresh IV each time", () => {
    const a = encrypt("1//refresh-token", "token", "user:sub");
    const b = encrypt("1//refresh-token", "token", "user:sub");
    expect(a).not.toEqual(b);
    expect(a).not.toContain("refresh");
    expect(decrypt(a, "token", "user:sub")).toBe("1//refresh-token");
  });
  it("rejects tampered ciphertext", () => {
    const a = encrypt("secret");
    const parts = a.split(".");
    const ct = Buffer.from(parts[3]!, "base64url");
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("binds associated data and purpose", () => {
    const a = encrypt("secret", "token", "user-a");
    expect(() => decrypt(a, "token", "user-b")).toThrow();
    expect(() => decrypt(a, "oauth", "user-a")).toThrow();
  });
  it("rejects a malformed key", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from("short").toString("base64");
    resetEnv();
    expect(() => encrypt("x")).toThrow(/32 bytes/);
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    resetEnv();
  });
});

describe("helpers", () => {
  it("computes RFC 7636 S256 challenges", () => {
    // Test vector from RFC 7636 Appendix B
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("compares in constant time and hashes", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(sha256("x")).toHaveLength(64);
  });
});
