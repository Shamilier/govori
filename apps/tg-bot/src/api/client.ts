const DEFAULT_TIMEOUT_MS = 5000;

type ApiClientOptions = {
  resolvePath?: string;
  authLinkPath?: string;
  telegramClientStatePath?: string;
  telegramClientPromptPath?: string;
  telegramClientVoicePath?: string;
  telegramClientCampaignPath?: string;
  timeoutMs?: number;
  serviceSecret?: string;
};

export type TelegramAuthBinding = {
  tenantId: string;
  telegramUserId: number;
};

export type CreateAuthLinkInput = {
  telegramUserId: number;
  chatId: number;
};

export type CreateAuthLinkResult = {
  url: string;
  expiresAt?: string;
};

type ResolveAuthResponse = {
  tenantId?: string;
  telegramUserId?: number;
};

type CreateAuthLinkResponse = {
  url?: string;
  expiresAt?: string;
};

type TelegramClientStateResponse = {
  tenantId?: string;
  telegramUserId?: number;
  agent?: {
    id?: string;
    name?: string;
    systemPrompt?: string;
    ttsVoiceId?: string;
  };
  recentCalls?: Array<{
    id?: string;
    status?: string;
    direction?: string;
    callerPhone?: string;
    calleePhone?: string;
    startedAt?: string;
  }>;
};

type TelegramClientMutationResponse = {
  ok?: boolean;
  agent?: {
    id?: string;
    name?: string;
    systemPrompt?: string;
    ttsVoiceId?: string;
  };
};

type TelegramClientCampaignResponse = {
  ok?: boolean;
  total?: number;
  started?: number;
  failed?: number;
};

export type TelegramClientState = {
  tenantId: string;
  agentName: string;
  systemPrompt: string;
  ttsVoiceId: string;
  recentCalls: Array<{
    id: string;
    status: string;
    direction: string;
    callerPhone: string;
    calleePhone: string;
    startedAt: string;
  }>;
};

export type StartCampaignResult = {
  ok: boolean;
  total: number;
  started: number;
  failed: number;
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly resolvePath: string;
  private readonly authLinkPath: string;
  private readonly telegramClientStatePath: string;
  private readonly telegramClientPromptPath: string;
  private readonly telegramClientVoicePath: string;
  private readonly telegramClientCampaignPath: string;
  private readonly timeoutMs: number;
  private readonly serviceSecret?: string;

  constructor(baseUrl: string, options: ApiClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.resolvePath = options.resolvePath ?? "/api/telegram/auth/resolve";
    this.authLinkPath = options.authLinkPath ?? "/api/telegram/auth/link";
    this.telegramClientStatePath =
      options.telegramClientStatePath ?? "/api/telegram/client/state";
    this.telegramClientPromptPath =
      options.telegramClientPromptPath ?? "/api/telegram/client/agent/prompt";
    this.telegramClientVoicePath =
      options.telegramClientVoicePath ?? "/api/telegram/client/agent/voice";
    this.telegramClientCampaignPath =
      options.telegramClientCampaignPath ??
      "/api/telegram/client/campaign/start";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.serviceSecret = options.serviceSecret;
  }

  async resolveTelegramTenant(
    telegramUserId: number,
  ): Promise<TelegramAuthBinding | null> {
    const query = new URLSearchParams({
      telegram_user_id: String(telegramUserId),
    });

    const payload = await this.request<ResolveAuthResponse>(
      `${this.resolvePath}?${query.toString()}`,
      { method: "GET" },
    );

    if (!payload?.tenantId) {
      return null;
    }

    return {
      tenantId: payload.tenantId,
      telegramUserId: payload.telegramUserId ?? telegramUserId,
    };
  }

  async createAuthLink(
    input: CreateAuthLinkInput,
  ): Promise<CreateAuthLinkResult | null> {
    const payload = await this.request<CreateAuthLinkResponse>(
      this.authLinkPath,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );

    if (!payload?.url) {
      return null;
    }

    return {
      url: payload.url,
      expiresAt: payload.expiresAt,
    };
  }

  async getClientState(
    telegramUserId: number,
  ): Promise<TelegramClientState | null> {
    const query = new URLSearchParams({
      telegram_user_id: String(telegramUserId),
    });

    const payload = await this.request<TelegramClientStateResponse>(
      `${this.telegramClientStatePath}?${query.toString()}`,
      {
        method: "GET",
        headers: this.buildServiceHeaders(),
      },
    );

    if (!payload?.tenantId || !payload.agent) {
      return null;
    }

    return {
      tenantId: payload.tenantId,
      agentName: payload.agent.name ?? "Agent",
      systemPrompt: payload.agent.systemPrompt ?? "",
      ttsVoiceId: payload.agent.ttsVoiceId ?? "",
      recentCalls: (payload.recentCalls ?? []).map((item) => ({
        id: item.id ?? "",
        status: item.status ?? "",
        direction: item.direction ?? "",
        callerPhone: item.callerPhone ?? "",
        calleePhone: item.calleePhone ?? "",
        startedAt: item.startedAt ?? "",
      })),
    };
  }

  async updatePrompt(telegramUserId: number, prompt: string): Promise<boolean> {
    const payload = await this.request<TelegramClientMutationResponse>(
      this.telegramClientPromptPath,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.buildServiceHeaders(),
        },
        body: JSON.stringify({
          telegramUserId,
          prompt,
        }),
      },
    );

    return Boolean(payload?.ok);
  }

  async updateVoice(telegramUserId: number, voiceId: string): Promise<boolean> {
    const payload = await this.request<TelegramClientMutationResponse>(
      this.telegramClientVoicePath,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.buildServiceHeaders(),
        },
        body: JSON.stringify({
          telegramUserId,
          voiceId,
        }),
      },
    );

    return Boolean(payload?.ok);
  }

  async startCampaign(
    telegramUserId: number,
    numbers: string[],
  ): Promise<StartCampaignResult | null> {
    const payload = await this.request<TelegramClientCampaignResponse>(
      this.telegramClientCampaignPath,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.buildServiceHeaders(),
        },
        body: JSON.stringify({
          telegramUserId,
          numbers,
        }),
      },
    );

    if (typeof payload?.ok !== "boolean") {
      return null;
    }

    return {
      ok: payload.ok,
      total: payload.total ?? 0,
      started: payload.started ?? 0,
      failed: payload.failed ?? 0,
    };
  }

  private buildServiceHeaders(): Record<string, string> {
    if (!this.serviceSecret) {
      return {};
    }
    return {
      "x-telegram-service-secret": this.serviceSecret,
    };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        return null;
      }

      return (await response.json()) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
