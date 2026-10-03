import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { env } from "@scaas/common";

/** AES-256-GCM for secrets at rest (ThingsBoard tenant-admin passwords). Use a KMS/Vault key in production. */
const key = () => createHash("sha256").update(env("SECRET_KEY", "dev-secret-key-change-me")).digest();

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b: any) => b.toString("base64")).join(".");
}

export function decrypt(blob: string): string {
  const [iv, tag, data] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

export const randomSecret = (bytes = 24) => randomBytes(bytes).toString("base64url");
