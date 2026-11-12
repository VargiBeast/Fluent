import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual, hkdfSync } from "node:crypto";
import { getEnv } from "./env.js";

const VERSION = "v1";

function masterKey(): Buffer {
  const raw = getEnv().TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (base64-encoded)");
  return key;
}

function deriveKey(purpose: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), salt, purpose, 32));
}

export function encrypt(plaintext: string, purpose: string, aad?: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(purpose, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, salt.toString("base64url"), iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(blob: string, purpose: string, aad?: string): string {
  const [ver, saltB64, ivB64, tagB64, ctB64] = blob.split(".");
  if (ver !== VERSION) throw new Error("unsupported ciphertext version");
  const salt = Buffer.from(saltB64, "base64url");
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ct = Buffer.from(ctB64, "base64url");
  const key = deriveKey(purpose, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function hashId(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** SHA-256 hex digest (64 chars). Used for session ids. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * RFC 7636 S256 code_challenge: BASE64URL(SHA256(code_verifier)).
 * Test vector: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" → "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
 */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
