import { Bot, type Context } from "grammy";
import type { ApiClient, TelegramAuthBinding } from "./api/client.js";
import { registerAuthHandlers } from "./auth/handler.js";
import { createAuthMiddleware } from "./auth/middleware.js";
import { registerCampaignHandlers } from "./campaign/handler.js";
import { registerMainMenuHandlers } from "./menu/main.js";
import {
  createRedisSessionMiddleware,
  type RedisSessionStore,
} from "./session/redis.js";

export type DialogState =
  | "idle"
  | "awaiting_access_code"
  | "awaiting_numbers"
  | "awaiting_prompt"
  | "awaiting_voice";

export type BotSession = {
  selectedAgentId: string | null;
  dialogState: DialogState;
  tenantId: string | null;
  telegramUserId: number | null;
};

export interface BotContext extends Context {
  session: BotSession;
  auth: TelegramAuthBinding | null;
}

type CreateBotDeps = {
  token: string;
  apiClient: ApiClient;
  sessionStore: RedisSessionStore;
};

export function createInitialSession(): BotSession {
  return {
    selectedAgentId: null,
    dialogState: "idle",
    tenantId: null,
    telegramUserId: null,
  };
}

export function createBot(deps: CreateBotDeps): Bot<BotContext> {
  const bot = new Bot<BotContext>(deps.token);

  bot.catch(({ error }) => {
    console.error("Telegram bot update failed", error);
  });

  bot.use(createRedisSessionMiddleware(deps.sessionStore));
  bot.use(createAuthMiddleware(deps.apiClient));

  registerAuthHandlers(bot, {
    apiClient: deps.apiClient,
  });
  registerMainMenuHandlers(bot, deps.apiClient);
  registerCampaignHandlers(bot, deps.apiClient);

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Доступные команды:",
        "/start - привязка по коду доступа",
        "/menu - главное меню",
        "/campaign - запуск обзвона списка номеров",
      ].join("\n"),
    );
  });

  return bot;
}
