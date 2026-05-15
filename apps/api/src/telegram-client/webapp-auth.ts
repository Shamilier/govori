import crypto from "node:crypto";
import { env } from "@/common/env.js";

const INIT_DATA_TTL_SEC = 24 * 3600; // 24h — TG-стандартный лимит

export type WebAppAuthResult =
  | { ok: true; telegramUserId: number }
  | { ok: false; code: number; error: string };

/**
 * Verify Telegram WebApp initData per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Expects raw initData string (the value of Telegram.WebApp.initData).
 * Returns telegramUserId on success.
 */
export function verifyWebAppInitData(initData: string): WebAppAuthResult {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    return {
      ok: false,
      code: 503,
      error: "TELEGRAM_BOT_TOKEN_NOT_CONFIGURED",
    };
  }

  if (!initData || typeof initData !== "string") {
    return { ok: false, code: 401, error: "INIT_DATA_REQUIRED" };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    return { ok: false, code: 401, error: "INIT_DATA_MISSING_HASH" };
  }
  params.delete("hash");

  // Sort entries alphabetically by key
  const entries: Array<[string, string]> = [];
  params.forEach((value, key) => {
    entries.push([key, value]);
  });
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const dataCheckString = entries
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  // secret_key = HMAC_SHA256(key="WebAppData", message=botToken)
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (
    expectedHash.length !== hash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(expectedHash, "hex"),
      Buffer.from(hash, "hex"),
    )
  ) {
    return { ok: false, code: 401, error: "INIT_DATA_INVALID_HASH" };
  }

  // Reject stale initData
  const authDateRaw = params.get("auth_date");
  if (authDateRaw) {
    const authDate = Number(authDateRaw);
    if (Number.isFinite(authDate)) {
      const ageSec = Math.floor(Date.now() / 1000) - authDate;
      if (ageSec > INIT_DATA_TTL_SEC) {
        return { ok: false, code: 401, error: "INIT_DATA_EXPIRED" };
      }
    }
  }

  // Extract user
  const userRaw = params.get("user");
  if (!userRaw) {
    return { ok: false, code: 401, error: "INIT_DATA_MISSING_USER" };
  }

  let parsedUser: unknown;
  try {
    parsedUser = JSON.parse(userRaw);
  } catch {
    return { ok: false, code: 401, error: "INIT_DATA_INVALID_USER_JSON" };
  }

  if (
    !parsedUser ||
    typeof parsedUser !== "object" ||
    !("id" in parsedUser) ||
    typeof (parsedUser as { id: unknown }).id !== "number"
  ) {
    return { ok: false, code: 401, error: "INIT_DATA_INVALID_USER" };
  }

  return { ok: true, telegramUserId: (parsedUser as { id: number }).id };
}

/**
 * Extract initData from request headers.
 * Supports both `Authorization: tma <data>` (TG standard) and `x-telegram-init-data: <data>`.
 */
export function extractInitDataFromHeaders(
  headers: Record<string, unknown>,
): string | null {
  const authHeader = headers["authorization"];
  const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (typeof authValue === "string") {
    const trimmed = authValue.trim();
    if (trimmed.toLowerCase().startsWith("tma ")) {
      return trimmed.slice(4).trim();
    }
  }

  const direct = headers["x-telegram-init-data"];
  const directValue = Array.isArray(direct) ? direct[0] : direct;
  if (typeof directValue === "string" && directValue.trim().length > 0) {
    return directValue.trim();
  }

  return null;
}
