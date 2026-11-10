import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual, hkdfSync } from "node:crypto";
import { getEnv } from "./env.js";

const VERSION = "v1";

function masterKey(): Buffer {
  const raw = getEnv().TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

/** Derive a purpose-specific key so token encryption and cookie sealing never share a key. */
function subKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), `fluent:${purpose}`, 32));
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). Associated data binds context. */
export function encrypt(plaintext: string, purpose = "token", aad = ""): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subKey(purpose), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(sealed: string, purpose = "token", aad = ""): string {
  const [v, ivB, tagB, ctB] = sealed.split(".");
  if (v !== VERSION || !ivB || !tagB || ctB === undefined) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", subKey(purpose), Buffer.from(ivB, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
