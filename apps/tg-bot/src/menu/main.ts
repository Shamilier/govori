import { InlineKeyboard, type Bot } from "grammy";
import type { BotContext } from "../bot.js";
import { buildAgentMenuText } from "./agent.js";
import { buildInboundLogText } from "./inbound.js";
import { buildOutboundLogText } from "./outbound.js";

export function registerMainMenuHandlers(bot: Bot<BotContext>): void {
  bot.command("menu", async (ctx) => {
    if (!ctx.auth) {
      await ctx.reply("Сначала выполните /start для авторизации.");
      return;
    }

    const keyboard = new InlineKeyboard()
      .text("Агенты", "menu:agents")
      .row()
      .text("Входящие", "menu:inbound")
      .text("Исходящие", "menu:outbound");

    await ctx.reply("Главное меню GovorI:", {
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery("menu:agents", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(buildAgentMenuText(ctx.session.selectedAgentId));
  });

  bot.callbackQuery("menu:inbound", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(buildInboundLogText());
  });

  bot.callbackQuery("menu:outbound", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(buildOutboundLogText());
  });
}
