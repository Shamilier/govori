import { InlineKeyboard, type Bot } from "grammy";
import type { ApiClient, TelegramClientState } from "../api/client.js";
import type { BotContext } from "../bot.js";

function buildMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Обновить", "menu:refresh")
    .row()
    .text("Изменить промпт", "menu:set_prompt")
    .text("Изменить голос", "menu:set_voice")
    .row()
    .text("Запустить обзвон", "menu:campaign")
    .text("Последние звонки", "menu:calls");
}

function buildStateText(state: TelegramClientState): string {
  const promptPreview =
    state.systemPrompt.length > 300
      ? `${state.systemPrompt.slice(0, 300)}...`
      : state.systemPrompt;

  return [
    "Личный кабинет GovorI",
    `Агент: ${state.agentName}`,
    `Голос: ${state.ttsVoiceId || "-"}`,
    "",
    "Промпт (фрагмент):",
    promptPreview || "-",
  ].join("\n");
}

function buildRecentCallsText(state: TelegramClientState): string {
  if (state.recentCalls.length === 0) {
    return "Пока нет звонков по вашему аккаунту.";
  }

  const lines = ["Последние звонки:"];
  for (const call of state.recentCalls.slice(0, 8)) {
    lines.push(
      `• ${call.status || "UNKNOWN"} | ${call.callerPhone || "-"} -> ${call.calleePhone || "-"}`,
    );
  }
  return lines.join("\n");
}

async function sendMainMenu(
  ctx: BotContext,
  apiClient: ApiClient,
): Promise<void> {
  if (!ctx.from || !ctx.auth) {
    await ctx.reply("Сначала выполните /start для авторизации.");
    return;
  }

  const state = await apiClient.getClientState(ctx.from.id);
  if (!state) {
    await ctx.reply("Не удалось загрузить данные аккаунта. Попробуйте позже.");
    return;
  }

  await ctx.reply(buildStateText(state), {
    reply_markup: buildMainKeyboard(),
  });
}

export function registerMainMenuHandlers(
  bot: Bot<BotContext>,
  apiClient: ApiClient,
): void {
  bot.command("menu", async (ctx) => {
    await sendMainMenu(ctx, apiClient);
  });

  bot.callbackQuery("menu:refresh", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendMainMenu(ctx, apiClient);
  });

  bot.callbackQuery("menu:set_prompt", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.dialogState = "awaiting_prompt";
    await ctx.reply(
      "Отправьте новый промпт одним сообщением. Минимум 10 символов. Для отмены: /menu",
    );
  });

  bot.callbackQuery("menu:set_voice", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.dialogState = "awaiting_voice";
    await ctx.reply(
      "Отправьте ID голоса Gemini (например: Kore). Для отмены: /menu",
    );
  });

  bot.callbackQuery("menu:campaign", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.dialogState = "awaiting_numbers";
    await ctx.reply(
      "Отправьте номера для обзвона в формате E.164 (+79991112233), через пробел или новую строку.",
    );
  });

  bot.callbackQuery("menu:calls", async (ctx) => {
    await ctx.answerCallbackQuery();

    if (!ctx.from) {
      await ctx.reply("Не удалось определить пользователя Telegram.");
      return;
    }

    const state = await apiClient.getClientState(ctx.from.id);
    if (!state) {
      await ctx.reply("Не удалось загрузить звонки. Попробуйте позже.");
      return;
    }

    await ctx.reply(buildRecentCallsText(state));
  });
}
