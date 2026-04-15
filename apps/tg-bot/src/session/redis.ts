import { Redis } from "ioredis";
import type { MiddlewareFn } from "grammy";
import {
  createInitialSession,
  type BotContext,
  type BotSession,
} from "../bot.js";

const SESSION_KEY_PREFIX = "tg:session:";
const DEFAULT_SESSION_TTL_SEC = 60 * 60 * 24 * 14;

export class RedisSessionStore {
  private readonly redis: Redis;

  constructor(
    redisUrl: string,
    private readonly sessionTtlSec = DEFAULT_SESSION_TTL_SEC,
  ) {
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async connect(): Promise<void> {
    if (this.redis.status === "ready" || this.redis.status === "connecting") {
      return;
    }

    await this.redis.connect();
  }

  async get(chatId: number): Promise<BotSession> {
    try {
      const payload = await this.redis.get(this.getKey(chatId));
      if (!payload) {
        return createInitialSession();
      }

      const parsed = JSON.parse(payload) as Partial<BotSession>;
      return this.normalizeSession(parsed);
    } catch {
      return createInitialSession();
    }
  }

  async set(chatId: number, session: BotSession): Promise<void> {
    try {
      await this.redis.set(
        this.getKey(chatId),
        JSON.stringify(session),
        "EX",
        this.sessionTtlSec,
      );
    } catch {
      // degraded mode: keep bot running even if redis is temporarily unavailable
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  private getKey(chatId: number): string {
    return `${SESSION_KEY_PREFIX}${chatId}`;
  }

  private normalizeSession(candidate: Partial<BotSession>): BotSession {
    let dialogState: BotSession["dialogState"] = "idle";
    if (candidate.dialogState === "awaiting_numbers") {
      dialogState = "awaiting_numbers";
    } else if (candidate.dialogState === "awaiting_access_code") {
      dialogState = "awaiting_access_code";
    } else if (candidate.dialogState === "awaiting_prompt") {
      dialogState = "awaiting_prompt";
    } else if (candidate.dialogState === "awaiting_voice") {
      dialogState = "awaiting_voice";
    }

    return {
      selectedAgentId:
        typeof candidate.selectedAgentId === "string"
          ? candidate.selectedAgentId
          : null,
      dialogState,
      tenantId:
        typeof candidate.tenantId === "string" ? candidate.tenantId : null,
      telegramUserId:
        typeof candidate.telegramUserId === "number"
          ? candidate.telegramUserId
          : null,
    };
  }
}

export function createRedisSessionMiddleware(
  sessionStore: RedisSessionStore,
): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      ctx.session = createInitialSession();
      ctx.auth = null;
      await next();
      return;
    }

    ctx.session = await sessionStore.get(chatId);
    ctx.auth = null;

    await next();

    await sessionStore.set(chatId, ctx.session);
  };
}
