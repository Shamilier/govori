import type { Bot } from "grammy";
import type { ApiClient } from "../api/client.js";
import type { BotContext } from "../bot.js";
import { parseAndValidatePhones } from "./validator.js";

export function registerCampaignHandlers(
  bot: Bot<BotContext>,
  apiClient: ApiClient,
): void {
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
    const text = ctx.message.text.trim();

    if (text.startsWith("/")) {
      await next();
      return;
    }

    if (!ctx.from || !ctx.auth) {
      await next();
      return;
    }

    if (ctx.session.dialogState === "awaiting_prompt") {
      const prompt = text.trim();
      if (prompt.length < 10) {
        await ctx.reply("Промпт слишком короткий. Минимум 10 символов.");
        return;
      }

      const ok = await apiClient.updatePrompt(ctx.from.id, prompt);
      ctx.session.dialogState = "idle";

      if (!ok) {
        await ctx.reply("Не удалось обновить промпт. Попробуйте позже.");
        return;
      }

      await ctx.reply("Промпт обновлен.");
      return;
    }

    if (ctx.session.dialogState === "awaiting_voice") {
      const voiceId = text.trim();
      if (!voiceId) {
        await ctx.reply("Укажите непустой voice ID.");
        return;
      }

      const ok = await apiClient.updateVoice(ctx.from.id, voiceId);
      ctx.session.dialogState = "idle";

      if (!ok) {
        await ctx.reply("Не удалось обновить голос. Попробуйте позже.");
        return;
      }

      await ctx.reply(`Голос обновлен: ${voiceId}`);
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

    const result = await apiClient.startCampaign(ctx.from.id, valid);
    if (!result) {
      await ctx.reply(
        "Не удалось запустить обзвон. Проверьте настройки и попробуйте снова.",
      );
      return;
    }

    const lines = [
      `Принято валидных номеров: ${valid.length}`,
      `Невалидных: ${invalid.length}`,
      `Запущено: ${result.started}`,
      `Ошибок запуска: ${result.failed}`,
    ];

    await ctx.reply(lines.join("\n"));
  });
}
