import type { MiddlewareFn } from "grammy";
import type { ApiClient } from "../api/client.js";
import type { BotContext } from "../bot.js";

const PUBLIC_COMMANDS = new Set(["start", "help"]);

export function createAuthMiddleware(
  apiClient: ApiClient,
): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const command = extractCommand(ctx.message?.text);
    if (command && PUBLIC_COMMANDS.has(command)) {
      await next();
      return;
    }

    if (
      ctx.session.dialogState === "awaiting_access_code" &&
      ctx.message?.text &&
      !ctx.message.text.startsWith("/")
    ) {
      await next();
      return;
    }

    if (!ctx.from) {
      await next();
      return;
    }

    if (ctx.session.tenantId && ctx.session.telegramUserId === ctx.from.id) {
      ctx.auth = {
        tenantId: ctx.session.tenantId,
        telegramUserId: ctx.from.id,
      };
      await next();
      return;
    }

    const binding = await apiClient.resolveTelegramTenant(ctx.from.id);
    if (!binding) {
      if (ctx.chat) {
        await ctx.reply(
          "Telegram пока не привязан. Выполните /start и введите код доступа клиента.",
        );
      }
      return;
    }

    ctx.auth = binding;
    ctx.session.tenantId = binding.tenantId;
    ctx.session.telegramUserId = binding.telegramUserId;

    await next();
  };
}

function extractCommand(text: string | undefined): string | null {
  if (!text || !text.startsWith("/")) {
    return null;
  }

  const rawCommand = text.slice(1).split(/\s+/, 1)[0] ?? "";
  const command = rawCommand.split("@", 1)[0]?.trim().toLowerCase();

  return command ? command : null;
}
