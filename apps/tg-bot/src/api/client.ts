const DEFAULT_TIMEOUT_MS = 5000;

type ApiClientOptions = {
  resolvePath?: string;
  authLinkPath?: string;
  timeoutMs?: number;
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

export class ApiClient {
  private readonly baseUrl: string;
  private readonly resolvePath: string;
  private readonly authLinkPath: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, options: ApiClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.resolvePath = options.resolvePath ?? "/api/telegram/auth/resolve";
    this.authLinkPath = options.authLinkPath ?? "/api/telegram/auth/link";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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

  private async request<T>(
    path: string,
    init: RequestInit,
  ): Promise<T | null> {
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
