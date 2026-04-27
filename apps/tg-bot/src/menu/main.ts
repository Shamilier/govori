import { InlineKeyboard, type Bot } from "grammy";
import type { ApiClient, TelegramClientState } from "../api/client.js";
import type { BotContext } from "../bot.js";

function buildMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Обновить", "menu:refresh")
    .row()
    .text("Изменить голос", "menu:set_voice")
    .row()
    .text("Запустить обзвон", "menu:campaign")
    .text("История звонков", "menu:calls");
}

function buildStateText(state: TelegramClientState): string {
  return [
    "Личный кабинет GovorI",
    `Агент: ${state.agentName}`,
    `Голос: ${state.ttsVoiceId || "-"}`,
    "Выберите действие кнопками ниже.",
  ].join("\n");
}

function formatDate(value: string): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  });
}

function roleLabel(role: string): string {
  switch (role.toUpperCase()) {
    case "USER":
      return "Человек";
    case "ASSISTANT":
      return "Бот";
    case "SYSTEM":
      return "Система";
    case "TOOL":
      return "Инструмент";
    default:
      return role || "Сообщение";
  }
}

function directionLabel(direction: string): string {
  switch (direction.toUpperCase()) {
    case "OUTBOUND":
      return "исходящий";
    case "INBOUND":
      return "входящий";
    default:
      return direction || "-";
  }
}

function compactText(value: string, maxLength = 900): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function pushChunk(chunks: string[], current: string, nextLine: string): string {
  const candidate = current ? `${current}\n${nextLine}` : nextLine;
  if (candidate.length <= 3500) {
    return candidate;
  }

  if (current) {
    chunks.push(current);
  }
  return nextLine;
}

function buildCallHistoryMessages(state: TelegramClientState): string[] {
  if (state.recentCalls.length === 0) {
    return ["Пока нет звонков по вашему аккаунту."];
  }

  const chunks: string[] = [];
  let current = "История звонков:";

  for (const [index, call] of state.recentCalls.slice(0, 5).entries()) {
    const header = [
      "",
      `Звонок ${index + 1}`,
      `Дата: ${formatDate(call.startedAt)}`,
      `Статус: ${call.status || "UNKNOWN"}`,
      `Тип: ${directionLabel(call.direction)}`,
      `Номера: ${call.callerPhone || "-"} -> ${call.calleePhone || "-"}`,
      `Длительность: ${
        typeof call.durationSec === "number" ? `${call.durationSec} сек.` : "-"
      }`,
      `Запись: ${call.recordingUrl || "запись пока не пришла от Voximplant"}`,
      "Диалог:",
    ];

    for (const line of header) {
      current = pushChunk(chunks, current, line);
    }

    if (call.messages.length === 0) {
      current = pushChunk(chunks, current, "Диалог пока пуст.");
      continue;
    }

    for (const message of call.messages) {
      const line = `${roleLabel(message.role)}: ${compactText(message.text)}`;
      current = pushChunk(chunks, current, line);
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
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

    for (const message of buildCallHistoryMessages(state)) {
      await ctx.reply(message);
    }
  });
}
