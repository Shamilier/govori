import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "@/common/env.js";
import type { IntegrationsService } from "@/integrations/integrations.service.js";
import type {
  TelegramClientStartCampaignInput,
  TelegramClientUpdatePromptInput,
  TelegramClientUpdateVoiceInput,
} from "@/telegram-client/telegram-client.schemas.js";
import { CallCategory } from "@prisma/client";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { TelephonyProvider } from "@/providers/telephony.provider.js";
import type { CallClassificationService } from "@/calls/call-classification.service.js";

function normalizePhone(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/[^\d+]/g, "").trim();
  if (!cleaned) {
    return null;
  }

  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  if (/^\d+$/.test(cleaned)) {
    if (cleaned.length === 11 && cleaned.startsWith("8")) {
      return `+7${cleaned.slice(1)}`;
    }
    return `+${cleaned}`;
  }

  return null;
}

type TelegramBinding = {
  tenantId: string;
  telegramUserId: number;
  boundAgentId: string | null;
};

type VoximplantServiceAccount = {
  account_id?: string | number;
  key_id?: string;
  private_key?: string;
};

type RecordingDownloadResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
};

type ReportCall = Prisma.CallGetPayload<{
  include: {
    messages: true;
  };
}>;

type InterestScore = -1 | 0 | 1 | 2;

export type DashboardPeriod =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "all"
  | { from: Date; to?: Date };

function resolveDashboardRange(period: DashboardPeriod): {
  from: Date | null;
  to: Date | null;
  label: string;
} {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  if (typeof period === "object" && period.from instanceof Date) {
    return {
      from: period.from,
      to: period.to ?? null,
      label: "custom",
    };
  }

  switch (period) {
    case "today":
      return { from: startOfDay, to: null, label: "today" };
    case "yesterday": {
      const from = new Date(startOfDay);
      from.setDate(from.getDate() - 1);
      return { from, to: startOfDay, label: "yesterday" };
    }
    case "week": {
      const from = new Date(startOfDay);
      from.setDate(from.getDate() - 7);
      return { from, to: null, label: "week" };
    }
    case "month": {
      const from = new Date(startOfDay);
      from.setDate(from.getDate() - 30);
      return { from, to: null, label: "month" };
    }
    case "all":
    default:
      return { from: null, to: null, label: "all" };
  }
}

function categoryFromString(
  value: "hot" | "warm" | "cold" | "no_answer",
): CallCategory {
  switch (value) {
    case "hot":
      return CallCategory.HOT;
    case "warm":
      return CallCategory.WARM;
    case "cold":
      return CallCategory.COLD;
    case "no_answer":
      return CallCategory.NO_ANSWER;
  }
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function asObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readBoolean(
  source: Record<string, unknown>,
  key: string,
): boolean {
  return source[key] === true;
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function getUserText(call: ReportCall): string {
  return call.messages
    .filter((message) => message.role === "USER")
    .map((message) => message.text)
    .join(" ")
    .toLowerCase();
}

function scoreInterest(call: ReportCall): {
  score: InterestScore;
  label: string;
  reason: string;
  action: string;
} {
  const outcome = asObject(call.outcomeJson);
  const userText = getUserText(call);
  const userMessagesCount = call.messages.filter(
    (message) => message.role === "USER",
  ).length;
  const durationSec = call.durationSec ?? 0;

  if (
    call.status === "FAILED" ||
    durationSec < 10 ||
    (call.endedAt && userMessagesCount === 0)
  ) {
    return {
      score: -1,
      label: "нет контакта",
      reason: "Не взял трубку или разговор короче 10 секунд.",
      action: "Можно повторить позже.",
    };
  }

  if (
    readBoolean(outcome, "do_not_call") ||
    /(не\s+звон|не\s+интерес|не\s+нужно|отказ|удалите|не\s+актуально|do not call)/i.test(
      userText,
    )
  ) {
    return {
      score: 0,
      label: "не интересно",
      reason: "В разговоре есть отказ или просьба не звонить.",
      action: "Не передавать менеджеру.",
    };
  }

  if (
    readBoolean(outcome, "callback_requested") ||
    /(перезвон|позвоните|свяжитесь|менеджер|оставьте\s+заяв|хочу\s+обсуд|давайте\s+созвон|callback)/i.test(
      userText,
    )
  ) {
    return {
      score: 2,
      label: "нужен менеджер",
      reason: "Клиент просит контакт, звонок или менеджера.",
      action: "Передать менеджеру в работу.",
    };
  }

  if (
    readBoolean(outcome, "appointment_requested") ||
    /(интерес|расскаж|условия|цена|стоим|подроб|скинь|пришл|можно|актуально|запис)/i.test(
      userText,
    )
  ) {
    return {
      score: 1,
      label: "есть интерес",
      reason: "Клиент задавал вопросы или проявил базовый интерес.",
      action: "Прогреть: отправить информацию или вернуться позже.",
    };
  }

  if (userMessagesCount > 0) {
    return {
      score: 1,
      label: "есть контакт",
      reason: "Разговор состоялся без явного отказа.",
      action: "Посмотреть расшифровку.",
    };
  }

  return {
    score: -1,
    label: "нет контакта",
    reason: "Нет реплик клиента.",
    action: "Можно повторить позже.",
  };
}

export class TelegramClientService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly integrationsService: IntegrationsService,
    private readonly telephonyProvider: TelephonyProvider,
    private readonly classificationService: CallClassificationService,
  ) {}

  async getState(telegramUserId: number): Promise<Record<string, unknown>> {
    const binding = await this.resolveBinding(telegramUserId);
    const agent = await this.getOrCreateTenantAgent(
      binding.tenantId,
      binding.boundAgentId,
    );

    const calls = await this.prisma.call.findMany({
      where: { tenantId: binding.tenantId },
      orderBy: { startedAt: "desc" },
      take: 10,
      include: {
        messages: {
          orderBy: { sequenceNo: "asc" },
          take: 40,
        },
      },
    });

    return {
      tenantId: binding.tenantId,
      telegramUserId: binding.telegramUserId,
      boundAgentId: binding.boundAgentId,
      agent: {
        id: agent.id,
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        ttsVoiceId: agent.ttsVoiceId,
        language: agent.language,
        isActive: agent.isActive,
        updatedAt: agent.updatedAt,
      },
      recentCalls: calls.map((call) => {
        const recordingUrl = call.recordingUrl
          ? this.buildRecordingProxyUrl(call.id)
          : null;

        return {
          id: call.id,
          externalCallId: call.externalCallId,
          status: call.status,
          direction: call.direction,
          callerPhone: call.callerPhone,
          calleePhone: call.calleePhone,
          startedAt: call.startedAt,
          endedAt: call.endedAt,
          durationSec: call.durationSec,
          recordingUrl,
          transcriptText: call.transcriptText,
          messages: call.messages.map((message) => ({
            id: message.id,
            role: message.role,
            text: message.text,
            sequenceNo: message.sequenceNo,
            createdAt: message.createdAt,
          })),
        };
      }),
    };
  }

  async getReport(
    telegramUserId: number,
    limit = 100,
  ): Promise<Record<string, unknown>> {
    const binding = await this.resolveBinding(telegramUserId);
    const calls = await this.prisma.call.findMany({
      where: { tenantId: binding.tenantId },
      orderBy: { startedAt: "desc" },
      take: limit,
      include: {
        messages: {
          orderBy: { sequenceNo: "asc" },
        },
      },
    });

    const items = calls.map((call) => {
      const interest = scoreInterest(call);
      const outcome = asObject(call.outcomeJson);
      const recordingUrl = call.recordingUrl
        ? this.buildRecordingProxyUrl(call.id)
        : null;

      return {
        id: call.id,
        externalCallId: call.externalCallId,
        status: call.status,
        direction: call.direction,
        callerPhone: call.callerPhone,
        calleePhone: call.calleePhone,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        durationSec: call.durationSec,
        recordingUrl,
        interest,
        summary:
          readString(outcome, "summary") ||
          call.transcriptText?.split("\n").slice(-1)[0] ||
          "Нет краткого итога.",
        actionItems: Array.isArray(outcome.action_items)
          ? outcome.action_items.filter((item): item is string => typeof item === "string")
          : [],
        messages: call.messages.map((message) => ({
          id: message.id,
          role: message.role,
          text: message.text,
          sequenceNo: message.sequenceNo,
          createdAt: message.createdAt,
        })),
      };
    });

    const byScore = {
      "-1": items.filter((item) => item.interest.score === -1).length,
      "0": items.filter((item) => item.interest.score === 0).length,
      "1": items.filter((item) => item.interest.score === 1).length,
      "2": items.filter((item) => item.interest.score === 2).length,
    };

    return {
      tenantId: binding.tenantId,
      telegramUserId: binding.telegramUserId,
      generatedAt: new Date(),
      scale: [
        { score: -1, label: "не дозвонились / короткий звонок" },
        { score: 0, label: "не интересно" },
        { score: 1, label: "есть интерес" },
        { score: 2, label: "нужен звонок менеджера" },
      ],
      summary: {
        total: items.length,
        byScore,
        withRecording: items.filter((item) => item.recordingUrl).length,
        withTranscript: items.filter((item) => item.messages.length > 0).length,
        managerQueue: byScore["2"],
      },
      calls: items,
    };
  }

  async getDashboard(
    telegramUserId: number,
    period: DashboardPeriod,
  ): Promise<Record<string, unknown>> {
    const binding = await this.resolveBinding(telegramUserId);
    const range = resolveDashboardRange(period);

    const calls = await this.prisma.call.findMany({
      where: {
        tenantId: binding.tenantId,
        startedAt: range.from ? { gte: range.from } : undefined,
      },
      select: {
        id: true,
        category: true,
        durationSec: true,
        status: true,
        endedAt: true,
      },
    });

    const total = calls.length;
    const answered = calls.filter(
      (c) => c.category !== CallCategory.NO_ANSWER,
    ).length;
    const longTalk = calls.filter((c) => (c.durationSec ?? 0) >= 30).length;
    const hot = calls.filter((c) => c.category === CallCategory.HOT).length;
    const warm = calls.filter((c) => c.category === CallCategory.WARM).length;
    const cold = calls.filter((c) => c.category === CallCategory.COLD).length;
    const noAnswer = calls.filter(
      (c) => c.category === CallCategory.NO_ANSWER,
    ).length;

    return {
      tenantId: binding.tenantId,
      period: range.label,
      periodFrom: range.from,
      periodTo: range.to,
      funnel: {
        dialed: total,
        answered,
        longTalk,
        hot,
        warm,
        cold,
        noAnswer,
      },
      counts: { all: total, hot, warm, cold, noAnswer },
    };
  }

  async getLeads(
    telegramUserId: number,
    options: {
      period: DashboardPeriod;
      category: "all" | "hot" | "warm" | "cold" | "no_answer";
      limit: number;
      offset?: number;
    },
  ): Promise<Record<string, unknown>> {
    const binding = await this.resolveBinding(telegramUserId);
    const range = resolveDashboardRange(options.period);

    const where: Prisma.CallWhereInput = {
      tenantId: binding.tenantId,
      startedAt: range.from ? { gte: range.from } : undefined,
    };

    if (options.category !== "all") {
      where.category = categoryFromString(options.category);
    }

    const calls = await this.prisma.call.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: Math.min(options.limit, 200),
      skip: options.offset ?? 0,
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
        direction: true,
        callerPhone: true,
        calleePhone: true,
        category: true,
        summaryText: true,
        nextStep: true,
        leadName: true,
        recordingUrl: true,
      },
    });

    const leads = calls.map((call) => {
      const counterpartPhone =
        call.direction === "OUTBOUND" ? call.calleePhone : call.callerPhone;
      return {
        id: call.id,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        durationSec: call.durationSec,
        direction: call.direction,
        phone: counterpartPhone,
        leadName: call.leadName,
        displayName: call.leadName ?? counterpartPhone ?? "Без номера",
        category: call.category,
        summary: call.summaryText,
        nextStep: call.nextStep,
        hasRecording: Boolean(call.recordingUrl),
      };
    });

    return {
      period: range.label,
      category: options.category,
      total: leads.length,
      leads,
    };
  }

  async getLeadDetail(
    telegramUserId: number,
    callId: string,
  ): Promise<Record<string, unknown> | null> {
    const binding = await this.resolveBinding(telegramUserId);

    const call = await this.prisma.call.findFirst({
      where: { id: callId, tenantId: binding.tenantId },
      include: {
        messages: { orderBy: { sequenceNo: "asc" } },
      },
    });

    if (!call) {
      return null;
    }

    // Lazy classification: if not yet classified (e.g. legacy call),
    // schedule it now but return what we have.
    if (!call.classifiedAt) {
      void this.classificationService
        .classifyCall(call.id)
        .catch(() => undefined);
    }

    const counterpartPhone =
      call.direction === "OUTBOUND" ? call.calleePhone : call.callerPhone;

    return {
      id: call.id,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      durationSec: call.durationSec,
      direction: call.direction,
      status: call.status,
      phone: counterpartPhone,
      leadName: call.leadName,
      displayName: call.leadName ?? counterpartPhone ?? "Без номера",
      category: call.category,
      summary: call.summaryText,
      nextStep: call.nextStep,
      recordingUrl: call.recordingUrl
        ? this.buildRecordingProxyUrl(call.id)
        : null,
      messages: call.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        sequenceNo: message.sequenceNo,
      })),
    };
  }

  async updatePrompt(
    input: TelegramClientUpdatePromptInput,
  ): Promise<Record<string, unknown>> {
    const binding = await this.resolveBinding(input.telegramUserId);
    const agent = await this.getOrCreateTenantAgent(
      binding.tenantId,
      binding.boundAgentId,
    );

    const updated = await this.prisma.agent.update({
      where: { id: agent.id },
      data: {
        systemPrompt: input.prompt,
      },
    });

    return {
      ok: true,
      tenantId: binding.tenantId,
      agent: {
        id: updated.id,
        name: updated.name,
        systemPrompt: updated.systemPrompt,
        updatedAt: updated.updatedAt,
      },
    };
  }

  async updateVoice(
    input: TelegramClientUpdateVoiceInput,
  ): Promise<Record<string, unknown>> {
    const binding = await this.resolveBinding(input.telegramUserId);
    const agent = await this.getOrCreateTenantAgent(
      binding.tenantId,
      binding.boundAgentId,
    );

    const updated = await this.prisma.agent.update({
      where: { id: agent.id },
      data: {
        ttsVoiceId: input.voiceId,
      },
    });

    return {
      ok: true,
      tenantId: binding.tenantId,
      agent: {
        id: updated.id,
        name: updated.name,
        ttsVoiceId: updated.ttsVoiceId,
        updatedAt: updated.updatedAt,
      },
    };
  }

  async startCampaign(
    input: TelegramClientStartCampaignInput,
  ): Promise<Record<string, unknown>> {
    const binding = await this.resolveBinding(input.telegramUserId);
    const agent = await this.getOrCreateTenantAgent(
      binding.tenantId,
      binding.boundAgentId,
    );
    const integrations = await this.integrationsService.getDecryptedForTenant(
      binding.tenantId,
    );

    const tenantNumber = await this.prisma.phoneNumber.findFirst({
      where: { tenantId: binding.tenantId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { e164: true },
    });

    const from =
      normalizePhone(input.from) ??
      normalizePhone(tenantNumber?.e164) ??
      normalizePhone(integrations.phoneNumberE164) ??
      normalizePhone(env.PHONE_NUMBER_E164) ??
      null;

    const ruleId =
      input.ruleId?.trim() ||
      integrations.voximplant.outboundRuleId?.trim() ||
      env.VOXIMPLANT_OUTBOUND_RULE_ID?.trim();
    if (!ruleId) {
      throw new Error("OUTBOUND_RULE_NOT_CONFIGURED");
    }

    const assistantId = from ?? "default";
    const started: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];

    const uniqueNumbers = Array.from(new Set(input.numbers));

    for (const number of uniqueNumbers) {
      try {
        const result = await this.telephonyProvider.startOutboundCall({
          to: number,
          from,
          assistantId,
          ruleId,
          metadata: {
            source: "telegram",
            tenantId: binding.tenantId,
            telegramUserId: input.telegramUserId,
          },
          credentials: {
            accountId: integrations.voximplant.accountId,
            apiKey: integrations.voximplant.apiKey,
            apiSecret: integrations.voximplant.apiSecret,
          },
        });

        started.push({
          to: number,
          provider: result.provider,
          requestId: result.requestId ?? null,
          raw: result.raw ?? null,
        });
      } catch (error) {
        failed.push({
          to: number,
          error: error instanceof Error ? error.message : "START_FAILED",
        });
      }
    }

    return {
      ok: true,
      tenantId: binding.tenantId,
      agentId: agent.id,
      total: uniqueNumbers.length,
      started: started.length,
      failed: failed.length,
      from,
      ruleId,
      items: {
        started,
        failed,
      },
    };
  }

  async downloadRecording(
    callId: string,
    token: string,
    range?: string,
  ): Promise<RecordingDownloadResult> {
    if (!this.verifyRecordingToken(callId, token)) {
      throw new Error("INVALID_RECORDING_TOKEN");
    }

    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      select: {
        recordingUrl: true,
        externalCallId: true,
      },
    });

    if (!call?.recordingUrl) {
      throw new Error("RECORDING_NOT_FOUND");
    }

    const authHeader = this.buildVoximplantRecordingAuthHeader();
    if (!authHeader) {
      throw new Error("VOXIMPLANT_RECORDING_AUTH_NOT_CONFIGURED");
    }

    const headers: Record<string, string> = {
      authorization: authHeader,
    };
    if (range?.trim()) {
      headers.range = range.trim();
    }

    const response = await fetch(call.recordingUrl, { headers });
    const body = Buffer.from(await response.arrayBuffer());

    if (!response.ok) {
      throw new Error(`VOXIMPLANT_RECORDING_FETCH_FAILED_${response.status}`);
    }

    const responseHeaders: Record<string, string> = {
      "content-type":
        response.headers.get("content-type") ?? "audio/mpeg",
      "content-disposition": `inline; filename="${call.externalCallId}.mp3"`,
    };

    for (const header of ["content-length", "content-range", "accept-ranges"]) {
      const value = response.headers.get(header);
      if (value) {
        responseHeaders[header] = value;
      }
    }

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body,
    };
  }

  private async resolveBinding(
    telegramUserId: number,
  ): Promise<TelegramBinding> {
    const binding = await this.prisma.telegramBinding.findUnique({
      where: { telegramUserId: BigInt(telegramUserId) },
      select: {
        tenantId: true,
        boundAgentId: true,
      },
    });

    if (!binding) {
      throw new Error("TELEGRAM_BINDING_NOT_FOUND");
    }

    return {
      tenantId: binding.tenantId,
      telegramUserId,
      boundAgentId: binding.boundAgentId,
    };
  }

  private async getOrCreateTenantAgent(
    tenantId: string,
    boundAgentId?: string | null,
  ) {
    if (boundAgentId) {
      const boundAgent = await this.prisma.agent.findFirst({
        where: { id: boundAgentId, tenantId },
      });

      if (!boundAgent) {
        throw new Error("BOUND_AGENT_NOT_FOUND");
      }

      return boundAgent;
    }

    const existing =
      (await this.prisma.agent.findFirst({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: "asc" },
      })) ??
      (await this.prisma.agent.findFirst({
        where: { tenantId },
        orderBy: { createdAt: "asc" },
      }));

    if (existing) {
      return existing;
    }

    return this.prisma.agent.create({
      data: {
        tenantId,
        name: "Main Voice Agent",
        systemPrompt: "Ты голосовой AI-агент. Отвечай кратко и вежливо.",
        greetingText: "Здравствуйте! Чем могу помочь?",
        fallbackText: "Извините, повторите, пожалуйста.",
        goodbyeText: "Спасибо за звонок. До свидания!",
        language: "ru-RU",
        ttsProvider: env.TTS_PROVIDER.trim().toLowerCase(),
        ttsVoiceId:
          env.ELEVENLABS_VOICE_ID ?? env.GEMINI_TTS_VOICE ?? "Kore",
      },
    });
  }

  private buildRecordingProxyUrl(callId: string): string {
    const publicBaseUrl = (
      env.PUBLIC_API_BASE_URL ||
      env.WEB_ORIGIN ||
      ""
    ).replace(/\/+$/, "");
    const token = this.createRecordingToken(callId);

    return `${publicBaseUrl}/api/telegram/client/calls/${encodeURIComponent(
      callId,
    )}/recording?token=${encodeURIComponent(token)}`;
  }

  private createRecordingToken(callId: string): string {
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const signature = crypto
      .createHmac("sha256", env.JWT_SECRET)
      .update(`${callId}.${expiresAt}`)
      .digest("base64url");

    return `${expiresAt}.${signature}`;
  }

  private verifyRecordingToken(callId: string, token: string): boolean {
    const [expiresAtRaw, signature] = token.split(".");
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || !signature) {
      return false;
    }

    if (expiresAt <= Math.floor(Date.now() / 1000)) {
      return false;
    }

    const expected = crypto
      .createHmac("sha256", env.JWT_SECRET)
      .update(`${callId}.${expiresAt}`)
      .digest("base64url");
    if (signature.length !== expected.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  }

  private buildVoximplantRecordingAuthHeader(): string | null {
    const explicitHeader = env.VOXIMPLANT_RECORDING_AUTH_HEADER?.trim();
    if (explicitHeader) {
      return explicitHeader;
    }

    const serviceAccount = this.readVoximplantServiceAccount();
    if (!serviceAccount) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(
      JSON.stringify({
        alg: "RS256",
        typ: "JWT",
        kid: serviceAccount.key_id,
      }),
    );
    const payload = base64Url(
      JSON.stringify({
        iss: String(serviceAccount.account_id),
        iat: now,
        exp: now + 64,
      }),
    );
    const signingInput = `${header}.${payload}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = base64Url(signer.sign(serviceAccount.private_key));

    return `Bearer ${signingInput}.${signature}`;
  }

  private readVoximplantServiceAccount(): Required<VoximplantServiceAccount> | null {
    const raw =
      env.VOXIMPLANT_SERVICE_ACCOUNT_JSON?.trim() ||
      (env.VOXIMPLANT_SERVICE_ACCOUNT_KEY_PATH
        ? readFileSync(env.VOXIMPLANT_SERVICE_ACCOUNT_KEY_PATH, "utf8")
        : "");

    if (!raw) {
      return null;
    }

    const parsed = this.parseServiceAccountJson(raw);
    if (!parsed?.account_id || !parsed.key_id || !parsed.private_key) {
      return null;
    }

    return {
      account_id: parsed.account_id,
      key_id: parsed.key_id,
      private_key: parsed.private_key,
    };
  }

  private parseServiceAccountJson(
    raw: string,
  ): VoximplantServiceAccount | null {
    for (const candidate of [
      raw,
      Buffer.from(raw, "base64").toString("utf8"),
    ]) {
      try {
        const parsed = JSON.parse(candidate) as VoximplantServiceAccount;
        return parsed;
      } catch {
        // Try the next representation.
      }
    }

    return null;
  }
}
