import { InlineKeyboard, type Bot } from "grammy";
import type {
  ApiClient,
  TelegramClientState,
} from "../api/client.js";
import type { BotContext } from "../bot.js";

type MainMenuDeps = {
  webAppBaseUrl?: string;
};

function buildMainKeyboard(webAppUrl: string | null): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("Обновить", "menu:refresh")
    .row()
    .text("Изменить голос", "menu:set_voice")
    .row()
    .text("Запустить обзвон", "menu:campaign");

  if (webAppUrl) {
    kb.webApp("📊 Отчёт по звонкам", webAppUrl);
  } else {
    kb.text("Отчёт по звонкам", "menu:calls");
  }

  return kb;
}

function buildStateText(state: TelegramClientState): string {
  return [
    "Личный кабинет GovorI",
    `Агент: ${state.agentName}`,
    `Голос: ${state.ttsVoiceId || "-"}`,
    "Выберите действие кнопками ниже.",
  ].join("\n");
}

function buildDashboardUrl(webAppBaseUrl: string | undefined): string | null {
  if (!webAppBaseUrl) return null;
  const trimmed = webAppBaseUrl.trim().replace(/\/+$/, "");
  if (!trimmed.startsWith("https://")) return null; // TG WebApp requires HTTPS
  return `${trimmed}/tg/dashboard`;
}

async function sendMainMenu(
  ctx: BotContext,
  apiClient: ApiClient,
  deps: MainMenuDeps,
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

  const dashboardUrl = buildDashboardUrl(deps.webAppBaseUrl);
  await ctx.reply(buildStateText(state), {
    reply_markup: buildMainKeyboard(dashboardUrl),
  });
}

export function registerMainMenuHandlers(
  bot: Bot<BotContext>,
  apiClient: ApiClient,
  deps: MainMenuDeps = {},
): void {
  bot.command("menu", async (ctx) => {
    await sendMainMenu(ctx, apiClient, deps);
  });

  bot.callbackQuery("menu:refresh", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendMainMenu(ctx, apiClient, deps);
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
    await ctx.reply(
      "Дашборд звонков доступен только при настроенном WEBAPP_BASE_URL (HTTPS). Обратитесь к администратору.",
    );
  });
}
