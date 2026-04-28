import { InlineKeyboard, InputFile, type Bot } from "grammy";
import type {
  ApiClient,
  TelegramCallReport,
  TelegramClientState,
} from "../api/client.js";
import type { BotContext } from "../bot.js";

function buildMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Обновить", "menu:refresh")
    .row()
    .text("Изменить голос", "menu:set_voice")
    .row()
    .text("Запустить обзвон", "menu:campaign")
    .text("Отчет по звонкам", "menu:calls");
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreTitle(score: number): string {
  switch (score) {
    case -1:
      return "-1 нет контакта";
    case 0:
      return "0 не интересно";
    case 1:
      return "1 есть интерес";
    case 2:
      return "2 нужен менеджер";
    default:
      return `${score} нет оценки`;
  }
}

function buildReportSummaryText(report: TelegramCallReport): string {
  const scores = report.summary.byScore;
  return [
    "Отчет по звонкам готов.",
    `Всего: ${report.summary.total}`,
    `-1 нет контакта: ${scores["-1"] ?? 0}`,
    `0 не интересно: ${scores["0"] ?? 0}`,
    `1 есть интерес: ${scores["1"] ?? 0}`,
    `2 нужен менеджер: ${scores["2"] ?? 0}`,
    `С записью: ${report.summary.withRecording}`,
    `С расшифровкой: ${report.summary.withTranscript}`,
    "",
    "Подробный отчет прикреплен HTML-файлом.",
  ].join("\n");
}

function buildReportHtml(report: TelegramCallReport): string {
  const rows = report.calls
    .map((call, index) => {
      const transcript = call.messages.length
        ? call.messages
            .map(
              (message) =>
                `<p><strong>${escapeHtml(roleLabel(message.role))}:</strong> ${escapeHtml(
                  compactText(message.text, 1800),
                )}</p>`,
            )
            .join("")
        : "<p>Диалог пока пуст.</p>";

      const recording = call.recordingUrl
        ? `<a href="${escapeHtml(call.recordingUrl)}">Открыть запись</a>`
        : "нет записи";

      const actionItems = call.actionItems.length
        ? call.actionItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
        : `<li>${escapeHtml(call.interest.action || "Нет действия.")}</li>`;

      return `
        <section class="call score-${call.interest.score}">
          <div class="call-head">
            <div>
              <span class="index">#${index + 1}</span>
              <h2>${escapeHtml(call.calleePhone || call.callerPhone || "Без номера")}</h2>
              <p>${escapeHtml(directionLabel(call.direction))} · ${escapeHtml(formatDate(call.startedAt))} · ${escapeHtml(call.status || "UNKNOWN")}</p>
            </div>
            <div class="score">${escapeHtml(scoreTitle(call.interest.score))}</div>
          </div>
          <div class="grid">
            <div><span>Кто</span><strong>${escapeHtml(call.callerPhone || "-")}</strong></div>
            <div><span>Кому</span><strong>${escapeHtml(call.calleePhone || "-")}</strong></div>
            <div><span>Длительность</span><strong>${typeof call.durationSec === "number" ? `${call.durationSec} сек.` : "-"}</strong></div>
            <div><span>Запись</span><strong>${recording}</strong></div>
          </div>
          <div class="reason">
            <strong>${escapeHtml(call.interest.label)}</strong>
            <p>${escapeHtml(call.interest.reason || call.summary || "Нет причины.")}</p>
          </div>
          <div class="actions">
            <h3>Что делать</h3>
            <ul>${actionItems}</ul>
          </div>
          <details>
            <summary>Расшифровка разговора</summary>
            <div class="transcript">${transcript}</div>
          </details>
        </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GovorI отчет по звонкам</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f5f2ec; color: #1f2523; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 18px; }
    header { border-bottom: 2px solid #1f2523; padding-bottom: 18px; margin-bottom: 22px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 18px 0; }
    .stat, .call { background: #fffdf8; border: 1px solid #d8d0c3; border-radius: 8px; }
    .stat { padding: 14px; }
    .stat span, .grid span { display: block; color: #69716b; font-size: 12px; text-transform: uppercase; }
    .stat strong { font-size: 26px; }
    .call { margin: 14px 0; padding: 18px; }
    .call-head { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
    .call h2 { margin: 4px 0; font-size: 22px; }
    .call p { margin: 4px 0; }
    .index { color: #69716b; font-size: 12px; }
    .score { padding: 8px 10px; border-radius: 6px; color: white; font-weight: 700; white-space: nowrap; }
    .score--1 .score { background: #6b7280; }
    .score-0 .score { background: #b42318; }
    .score-1 .score { background: #b7791f; }
    .score-2 .score { background: #047857; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin: 14px 0; }
    .grid div { background: #f8f4ed; border-radius: 6px; padding: 10px; }
    .reason, .actions { border-top: 1px solid #e3dbcf; padding-top: 12px; margin-top: 12px; }
    details { margin-top: 14px; }
    summary { cursor: pointer; font-weight: 700; }
    .transcript p { background: #f8f4ed; padding: 10px; border-radius: 6px; }
    a { color: #075985; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>GovorI отчет по звонкам</h1>
      <p>Сформирован: ${escapeHtml(formatDate(report.generatedAt))}</p>
      <div class="stats">
        <div class="stat"><span>Всего</span><strong>${report.summary.total}</strong></div>
        <div class="stat"><span>-1 нет контакта</span><strong>${report.summary.byScore["-1"] ?? 0}</strong></div>
        <div class="stat"><span>0 не интересно</span><strong>${report.summary.byScore["0"] ?? 0}</strong></div>
        <div class="stat"><span>1 есть интерес</span><strong>${report.summary.byScore["1"] ?? 0}</strong></div>
        <div class="stat"><span>2 менеджеру</span><strong>${report.summary.byScore["2"] ?? 0}</strong></div>
      </div>
    </header>
    ${rows || "<p>Звонков пока нет.</p>"}
  </main>
</body>
</html>`;
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

    const report = await apiClient.getCallReport(ctx.from.id, 100);
    if (!report) {
      await ctx.reply("Не удалось сформировать отчет. Попробуйте позже.");
      return;
    }

    await ctx.reply(buildReportSummaryText(report));
    await ctx.replyWithDocument(
      new InputFile(
        Buffer.from(buildReportHtml(report), "utf8"),
        `govori-report-${new Date().toISOString().slice(0, 10)}.html`,
      ),
      {
        caption: "Подробный HTML-отчет: оценки, действия, записи и расшифровки.",
      },
    );
  });
}
