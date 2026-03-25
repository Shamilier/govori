import crypto from "node:crypto";

const ENC_PREFIX = "enc:v1";

function normalizeKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX + ":");
}

export function encryptSecret(plainText: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const key = normalizeKey(secret);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(encoded: string, secret: string): string {
  if (!isEncrypted(encoded)) {
    return encoded;
  }

  const parts = encoded.split(":");
  if (parts.length !== 5) {
    throw new Error("Malformed encrypted secret");
  }

  const iv = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");
  const encrypted = Buffer.from(parts[4], "base64");
  const key = normalizeKey(secret);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
