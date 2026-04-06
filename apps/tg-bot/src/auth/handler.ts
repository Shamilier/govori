import { InlineKeyboard, type Bot } from "grammy";
import type { ApiClient } from "../api/client.js";
import type { BotContext } from "../bot.js";

type RegisterAuthHandlersDeps = {
  apiClient: ApiClient;
  authLinkBaseUrl?: string;
};

export function registerAuthHandlers(
  bot: Bot<BotContext>,
  deps: RegisterAuthHandlersDeps,
): void {
  bot.command("start", async (ctx) => {
    if (!ctx.from || !ctx.chat) {
      return;
    }

    const authLink = await deps.apiClient.createAuthLink({
      telegramUserId: ctx.from.id,
      chatId: ctx.chat.id,
    });

    const fallbackLink = deps.authLinkBaseUrl
      ? `${deps.authLinkBaseUrl.replace(/\/+$/, "")}/telegram/connect?telegram_user_id=${ctx.from.id}`
      : null;

    const finalLink = authLink?.url ?? fallbackLink;

    if (!finalLink) {
      await ctx.reply(
        "Не удалось сформировать ссылку авторизации. Попробуйте позже.",
      );
      return;
    }

    const keyboard = new InlineKeyboard().url("Привязать аккаунт", finalLink);

    await ctx.reply(
      "Чтобы продолжить работу, привяжите Telegram к аккаунту GovorI по кнопке ниже.",
      { reply_markup: keyboard },
    );
  });
}
