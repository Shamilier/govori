import type { Bot } from "grammy";
import type { ApiClient } from "../api/client.js";
import type { BotContext } from "../bot.js";

type RegisterAuthHandlersDeps = {
  apiClient: ApiClient;
};

export function registerAuthHandlers(
  bot: Bot<BotContext>,
  deps: RegisterAuthHandlersDeps,
): void {
  bot.command("start", async (ctx) => {
    if (!ctx.from) {
      return;
    }

    ctx.session.dialogState = "awaiting_access_code";

    await ctx.reply(
      "Введите код доступа клиента. Формат: `ABCD-EFGH-IJKL`.\nКод можно вводить повторно для перепривязки к другому аккаунту.",
      {
        parse_mode: "Markdown",
      },
    );
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.session.dialogState !== "awaiting_access_code") {
      await next();
      return;
    }

    if (!ctx.from) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) {
      await next();
      return;
    }

    const binding = await deps.apiClient.bindByAccessCode(ctx.from.id, text);
    if (!binding) {
      await ctx.reply(
        "Неверный код доступа. Проверьте код и попробуйте снова.",
      );
      return;
    }

    ctx.session.tenantId = binding.tenantId;
    ctx.session.telegramUserId = binding.telegramUserId;
    ctx.session.dialogState = "idle";

    await ctx.reply("Готово, Telegram привязан. Теперь откройте /menu.");
  });
}
