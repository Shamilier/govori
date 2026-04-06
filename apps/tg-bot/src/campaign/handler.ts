import type { Bot } from "grammy";
import type { BotContext } from "../bot.js";
import { parseAndValidatePhones } from "./validator.js";

export function registerCampaignHandlers(bot: Bot<BotContext>): void {
  bot.command("campaign", async (ctx) => {
    if (!ctx.auth) {
      await ctx.reply("Сначала выполните /start для авторизации.");
      return;
    }

    ctx.session.dialogState = "awaiting_numbers";

    await ctx.reply(
      "Отправьте номера для обзвона в формате E.164 (например: +79991112233), через пробел или новую строку.",
    );
  });

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;

    if (text.startsWith("/")) {
      await next();
      return;
    }

    if (ctx.session.dialogState !== "awaiting_numbers") {
      await next();
      return;
    }

    const { valid, invalid } = parseAndValidatePhones(text);
    ctx.session.dialogState = "idle";

    if (valid.length === 0) {
      await ctx.reply(
        "Не найдено корректных E.164 номеров. Пример корректного номера: +79991112233",
      );
      return;
    }

    const lines = [
      `Принято валидных номеров: ${valid.length}`,
      `Невалидных: ${invalid.length}`,
      "Создание кампании и постановка в очередь будут добавлены на следующем шаге MVP.",
    ];

    await ctx.reply(lines.join("\n"));
  });
}
