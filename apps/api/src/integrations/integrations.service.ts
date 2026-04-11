import type {
  IntegrationSettings,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { env } from "@/common/env.js";
import { decryptSecret, encryptSecret } from "@/common/crypto.js";
import { maskValue, SECRET_MASK_PLACEHOLDER } from "@/common/mask.js";
import type { AuditService } from "@/audit/audit.service.js";
import type { IntegrationsUpdateInput } from "@/integrations/integrations.schemas.js";

export type DecryptedIntegrationSettings = {
  id: string;
  telephonyProvider: string;
  phoneNumberE164: string | null;
  voximplant: {
    applicationId: string | null;
    accountId: string | null;
    apiKey: string | null;
    apiSecret: string | null;
  };
  gemini: {
    apiKey: string | null;
    llmModel: string;
    ttsModel: string;
    ttsVoice: string;
    sttModel: string;
  };
  // Aliases kept for compatibility with existing callers.
  llm: {
    apiKey: string | null;
    model: string;
  };
  tts: {
    apiKey: string | null;
    modelId: string;
    voiceId: string;
  };
  stt: {
    apiKey: string | null;
    modelId: string;
  };
};

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

function normalizeNonEmpty(value: string | undefined): string | null {
  if (typeof value === "undefined") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function nextSecret(
  input: string | undefined,
  previousEncrypted: string | null,
): string | null {
  if (typeof input === "undefined") {
    return previousEncrypted;
  }

  const value = input.trim();
  if (value.length === 0) {
    return null;
  }

  // UI sends masked placeholders for unchanged secrets.
  if (value === SECRET_MASK_PLACEHOLDER) {
    return previousEncrypted;
  }
  if (previousEncrypted && value.includes("*")) {
    return previousEncrypted;
  }

  return encryptSecret(value, env.ENCRYPTION_KEY);
}

function pickSharedGeminiSecret(input: IntegrationsUpdateInput): string | undefined {
  return (
    input.geminiApiKey ??
    input.llmApiKey ??
    input.cartesiaApiKey ??
    input.sttApiKey
  );
}

export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  private withAliases(base: {
    id: string;
    telephonyProvider: string;
    phoneNumberE164: string | null;
    voximplant: {
      applicationId: string | null;
      accountId: string | null;
      apiKey: string | null;
      apiSecret: string | null;
    };
    gemini: {
      apiKey: string | null;
      llmModel: string;
      ttsModel: string;
      ttsVoice: string;
      sttModel: string;
    };
  }): DecryptedIntegrationSettings {
    return {
      ...base,
      llm: {
        apiKey: base.gemini.apiKey,
        model: base.gemini.llmModel,
      },
      tts: {
        apiKey: base.gemini.apiKey,
        modelId: base.gemini.ttsModel,
        voiceId: base.gemini.ttsVoice,
      },
      stt: {
        apiKey: base.gemini.apiKey,
        modelId: base.gemini.sttModel,
      },
    };
  }

  private buildGeminiConfig(params: {
    llm: Record<string, unknown>;
    cartesia: Record<string, unknown>;
    stt: Record<string, unknown>;
    fallback?: DecryptedIntegrationSettings["gemini"];
  }): DecryptedIntegrationSettings["gemini"] {
    const fallback = params.fallback;

    const apiKey =
      decryptNullable(readString(params.llm, "apiKeyEnc")) ??
      decryptNullable(readString(params.cartesia, "apiKeyEnc")) ??
      decryptNullable(readString(params.stt, "apiKeyEnc")) ??
      fallback?.apiKey ??
      env.GEMINI_API_KEY ??
      env.LLM_API_KEY ??
      env.CARTESIA_API_KEY ??
      env.STT_API_KEY ??
      null;

    const llmModel =
      readString(params.llm, "model") ??
      fallback?.llmModel ??
      env.GEMINI_LLM_MODEL ??
      env.LLM_MODEL;

    const ttsModel =
      readString(params.cartesia, "modelId") ??
      fallback?.ttsModel ??
      env.GEMINI_TTS_MODEL ??
      env.CARTESIA_MODEL_ID;

    const ttsVoice =
      readString(params.cartesia, "voiceId") ??
      fallback?.ttsVoice ??
      env.GEMINI_TTS_VOICE ??
      env.CARTESIA_VOICE_ID ??
      "Kore";

    const sttModel =
      readString(params.stt, "model") ??
      fallback?.sttModel ??
      env.GEMINI_STT_MODEL;

    return {
      apiKey,
      llmModel,
      ttsModel,
      ttsVoice,
      sttModel,
    };
  }

  async getOrCreate(): Promise<IntegrationSettings> {
    const existing = await this.prisma.integrationSettings.findFirst();
    if (existing) {
      return existing;
    }

    return this.prisma.integrationSettings.create({
      data: {
        telephonyProvider: env.TELEPHONY_PROVIDER,
        phoneNumberE164: env.PHONE_NUMBER_E164,
      },
    });
  }

  async getMasked(): Promise<Record<string, unknown>> {
    const settings = await this.getOrCreate();
    const decrypted = await this.getDecrypted();

    return {
      id: settings.id,
      telephonyProvider: decrypted.telephonyProvider,
      phoneNumberE164: decrypted.phoneNumberE164,
      voximplantApplicationId: decrypted.voximplant.applicationId,
      voximplantAccountId: decrypted.voximplant.accountId,
      voximplantApiKey: maskValue(decrypted.voximplant.apiKey),
      voximplantApiSecret: maskValue(decrypted.voximplant.apiSecret),
      geminiApiKey: maskValue(decrypted.gemini.apiKey),
      geminiLlmModel: decrypted.gemini.llmModel,
      geminiTtsModel: decrypted.gemini.ttsModel,
      geminiTtsVoice: decrypted.gemini.ttsVoice,
      geminiSttModel: decrypted.gemini.sttModel,
      // Legacy aliases for old UI payloads.
      cartesiaApiKey: maskValue(decrypted.gemini.apiKey),
      cartesiaVoiceId: decrypted.gemini.ttsVoice,
      cartesiaModelId: decrypted.gemini.ttsModel,
      llmApiKey: maskValue(decrypted.gemini.apiKey),
      llmModel: decrypted.gemini.llmModel,
      sttApiKey: maskValue(decrypted.gemini.apiKey),
      sttModel: decrypted.gemini.sttModel,
      updatedAt: settings.updatedAt,
    };
  }

  async getDecrypted(): Promise<DecryptedIntegrationSettings> {
    const settings = await this.getOrCreate();
    const voximplant = jsonObject(settings.voximplantConfig);
    const cartesia = jsonObject(settings.cartesiaConfig);
    const llm = jsonObject(settings.llmConfig);
    const stt = jsonObject(settings.sttConfig);

    const gemini = this.buildGeminiConfig({
      llm,
      cartesia,
      stt,
    });

    return this.withAliases({
      id: settings.id,
      telephonyProvider: settings.telephonyProvider,
      phoneNumberE164: settings.phoneNumberE164,
      voximplant: {
        applicationId:
          readString(voximplant, "applicationId") ??
          env.VOXIMPLANT_APPLICATION_ID ??
          null,
        accountId:
          readString(voximplant, "accountId") ??
          env.VOXIMPLANT_ACCOUNT_ID ??
          null,
        apiKey:
          decryptNullable(readString(voximplant, "apiKeyEnc")) ??
          env.VOXIMPLANT_API_KEY ??
          null,
        apiSecret:
          decryptNullable(readString(voximplant, "apiSecretEnc")) ??
          env.VOXIMPLANT_API_SECRET ??
          null,
      },
      gemini,
    });
  }

  private async getPhoneNumberForTenant(tenantId: string): Promise<string | null> {
    const phoneNumber = await this.prisma.phoneNumber.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: "asc" },
    });

    return phoneNumber?.e164 ?? null;
  }

  private toDecryptedWithFallback(params: {
    id: string;
    telephonyProvider: string;
    phoneNumberE164: string | null;
    voximplant: Record<string, unknown>;
    cartesia: Record<string, unknown>;
    llm: Record<string, unknown>;
    stt: Record<string, unknown>;
    fallback: DecryptedIntegrationSettings;
  }): DecryptedIntegrationSettings {
    const gemini = this.buildGeminiConfig({
      llm: params.llm,
      cartesia: params.cartesia,
      stt: params.stt,
      fallback: params.fallback.gemini,
    });

    return this.withAliases({
      id: params.id,
      telephonyProvider:
        params.telephonyProvider || params.fallback.telephonyProvider,
      phoneNumberE164: params.phoneNumberE164 ?? params.fallback.phoneNumberE164,
      voximplant: {
        applicationId:
          readString(params.voximplant, "applicationId") ??
          params.fallback.voximplant.applicationId,
        accountId:
          readString(params.voximplant, "accountId") ??
          params.fallback.voximplant.accountId,
        apiKey:
          decryptNullable(readString(params.voximplant, "apiKeyEnc")) ??
          params.fallback.voximplant.apiKey,
        apiSecret:
          decryptNullable(readString(params.voximplant, "apiSecretEnc")) ??
          params.fallback.voximplant.apiSecret,
      },
      gemini,
    });
  }

  async getDecryptedForTenant(
    tenantId?: string | null,
  ): Promise<DecryptedIntegrationSettings> {
    const global = await this.getDecrypted();

    if (!tenantId) {
      return global;
    }

    const tenantSettings = await this.prisma.tenantIntegrationSettings.findUnique({
      where: { tenantId },
    });
    const tenantPhoneNumber = await this.getPhoneNumberForTenant(tenantId);

    if (!tenantSettings) {
      return {
        ...global,
        phoneNumberE164: tenantPhoneNumber ?? global.phoneNumberE164,
      };
    }

    return this.toDecryptedWithFallback({
      id: tenantSettings.id,
      telephonyProvider: tenantSettings.telephonyProvider,
      phoneNumberE164: tenantPhoneNumber ?? global.phoneNumberE164,
      voximplant: jsonObject(tenantSettings.voximplantConfig),
      cartesia: jsonObject(tenantSettings.cartesiaConfig),
      llm: jsonObject(tenantSettings.llmConfig),
      stt: jsonObject(tenantSettings.sttConfig),
      fallback: global,
    });
  }

  async getMaskedForTenant(tenantId: string): Promise<Record<string, unknown>> {
    const tenantSettings = await this.prisma.tenantIntegrationSettings.findUnique({
      where: { tenantId },
    });
    const decrypted = await this.getDecryptedForTenant(tenantId);

    return {
      id: decrypted.id,
      telephonyProvider: decrypted.telephonyProvider,
      phoneNumberE164: decrypted.phoneNumberE164,
      voximplantApplicationId: decrypted.voximplant.applicationId,
      voximplantAccountId: decrypted.voximplant.accountId,
      voximplantApiKey: maskValue(decrypted.voximplant.apiKey),
      voximplantApiSecret: maskValue(decrypted.voximplant.apiSecret),
      geminiApiKey: maskValue(decrypted.gemini.apiKey),
      geminiLlmModel: decrypted.gemini.llmModel,
      geminiTtsModel: decrypted.gemini.ttsModel,
      geminiTtsVoice: decrypted.gemini.ttsVoice,
      geminiSttModel: decrypted.gemini.sttModel,
      cartesiaApiKey: maskValue(decrypted.gemini.apiKey),
      cartesiaVoiceId: decrypted.gemini.ttsVoice,
      cartesiaModelId: decrypted.gemini.ttsModel,
      llmApiKey: maskValue(decrypted.gemini.apiKey),
      llmModel: decrypted.gemini.llmModel,
      sttApiKey: maskValue(decrypted.gemini.apiKey),
      sttModel: decrypted.gemini.sttModel,
      updatedAt: tenantSettings?.updatedAt ?? null,
      tenantId,
    };
  }

  async updateTenant(
    adminId: string,
    tenantId: string,
    input: IntegrationsUpdateInput,
  ): Promise<Record<string, unknown>> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new Error("TENANT_NOT_FOUND");
    }

    const existing = await this.prisma.tenantIntegrationSettings.findUnique({
      where: { tenantId },
    });
    const fallback = await this.getDecrypted();

    const prevVox = jsonObject(existing?.voximplantConfig ?? {});
    const prevCartesia = jsonObject(existing?.cartesiaConfig ?? {});
    const prevLlm = jsonObject(existing?.llmConfig ?? {});
    const prevStt = jsonObject(existing?.sttConfig ?? {});

    const sharedGeminiSecret = pickSharedGeminiSecret(input);

    const nextVox = {
      applicationId:
        normalizeNonEmpty(input.voximplantApplicationId) ??
        readString(prevVox, "applicationId") ??
        fallback.voximplant.applicationId,
      accountId:
        normalizeNonEmpty(input.voximplantAccountId) ??
        readString(prevVox, "accountId") ??
        fallback.voximplant.accountId,
      apiKeyEnc: nextSecret(
        input.voximplantApiKey,
        readString(prevVox, "apiKeyEnc"),
      ),
      apiSecretEnc: nextSecret(
        input.voximplantApiSecret,
        readString(prevVox, "apiSecretEnc"),
      ),
    };

    const nextGeminiLlmModel =
      normalizeNonEmpty(input.geminiLlmModel ?? input.llmModel ?? undefined) ??
      readString(prevLlm, "model") ??
      fallback.gemini.llmModel;

    const nextGeminiTtsModel =
      normalizeNonEmpty(input.geminiTtsModel ?? input.cartesiaModelId ?? undefined) ??
      readString(prevCartesia, "modelId") ??
      fallback.gemini.ttsModel;

    const nextGeminiTtsVoice =
      normalizeNonEmpty(input.geminiTtsVoice ?? input.cartesiaVoiceId ?? undefined) ??
      readString(prevCartesia, "voiceId") ??
      fallback.gemini.ttsVoice;

    const nextGeminiSttModel =
      normalizeNonEmpty(input.geminiSttModel) ??
      readString(prevStt, "model") ??
      fallback.gemini.sttModel;

    const nextCartesia = {
      apiKeyEnc: nextSecret(
        sharedGeminiSecret,
        readString(prevCartesia, "apiKeyEnc"),
      ),
      voiceId: nextGeminiTtsVoice,
      modelId: nextGeminiTtsModel,
    };

    const nextLlm = {
      apiKeyEnc: nextSecret(sharedGeminiSecret, readString(prevLlm, "apiKeyEnc")),
      model: nextGeminiLlmModel,
    };

    const nextStt = {
      apiKeyEnc: nextSecret(sharedGeminiSecret, readString(prevStt, "apiKeyEnc")),
      model: nextGeminiSttModel,
    };

    await this.prisma.tenantIntegrationSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        telephonyProvider: input.telephonyProvider || fallback.telephonyProvider,
        voximplantConfig: nextVox,
        cartesiaConfig: nextCartesia,
        llmConfig: nextLlm,
        sttConfig: nextStt,
      },
      update: {
        telephonyProvider: input.telephonyProvider || fallback.telephonyProvider,
        voximplantConfig: nextVox,
        cartesiaConfig: nextCartesia,
        llmConfig: nextLlm,
        sttConfig: nextStt,
      },
    });

    await this.auditService.log({
      adminId,
      action: "TENANT_INTEGRATIONS_UPDATED",
      entityType: "tenant_integration_settings",
      entityId: tenantId,
      payload: {
        changedSecrets: [
          input.voximplantApiKey ? "voximplantApiKey" : null,
          input.voximplantApiSecret ? "voximplantApiSecret" : null,
          sharedGeminiSecret ? "geminiApiKey" : null,
        ].filter(Boolean),
      },
    });

    return this.getMaskedForTenant(tenantId);
  }

  async update(
    adminId: string,
    input: IntegrationsUpdateInput,
  ): Promise<Record<string, unknown>> {
    const existing = await this.getOrCreate();
    const prevVox = jsonObject(existing.voximplantConfig);
    const prevCartesia = jsonObject(existing.cartesiaConfig);
    const prevLlm = jsonObject(existing.llmConfig);
    const prevStt = jsonObject(existing.sttConfig);

    const sharedGeminiSecret = pickSharedGeminiSecret(input);

    const nextVox = {
      applicationId:
        normalizeNonEmpty(input.voximplantApplicationId) ??
        readString(prevVox, "applicationId"),
      accountId:
        normalizeNonEmpty(input.voximplantAccountId) ??
        readString(prevVox, "accountId"),
      apiKeyEnc: nextSecret(
        input.voximplantApiKey,
        readString(prevVox, "apiKeyEnc"),
      ),
      apiSecretEnc: nextSecret(
        input.voximplantApiSecret,
        readString(prevVox, "apiSecretEnc"),
      ),
    };

    const nextGeminiLlmModel =
      normalizeNonEmpty(input.geminiLlmModel ?? input.llmModel ?? undefined) ??
      readString(prevLlm, "model") ??
      env.GEMINI_LLM_MODEL ??
      env.LLM_MODEL;

    const nextGeminiTtsModel =
      normalizeNonEmpty(input.geminiTtsModel ?? input.cartesiaModelId ?? undefined) ??
      readString(prevCartesia, "modelId") ??
      env.GEMINI_TTS_MODEL ??
      env.CARTESIA_MODEL_ID;

    const nextGeminiTtsVoice =
      normalizeNonEmpty(input.geminiTtsVoice ?? input.cartesiaVoiceId ?? undefined) ??
      readString(prevCartesia, "voiceId") ??
      env.GEMINI_TTS_VOICE ??
      env.CARTESIA_VOICE_ID ??
      "Kore";

    const nextGeminiSttModel =
      normalizeNonEmpty(input.geminiSttModel) ??
      readString(prevStt, "model") ??
      env.GEMINI_STT_MODEL;

    const nextCartesia = {
      apiKeyEnc: nextSecret(
        sharedGeminiSecret,
        readString(prevCartesia, "apiKeyEnc"),
      ),
      voiceId: nextGeminiTtsVoice,
      modelId: nextGeminiTtsModel,
    };

    const nextLlm = {
      apiKeyEnc: nextSecret(sharedGeminiSecret, readString(prevLlm, "apiKeyEnc")),
      model: nextGeminiLlmModel,
    };

    const nextStt = {
      apiKeyEnc: nextSecret(sharedGeminiSecret, readString(prevStt, "apiKeyEnc")),
      model: nextGeminiSttModel,
    };

    await this.prisma.integrationSettings.update({
      where: { id: existing.id },
      data: {
        telephonyProvider: input.telephonyProvider,
        phoneNumberE164: input.phoneNumberE164 ?? existing.phoneNumberE164,
        voximplantConfig: nextVox,
        cartesiaConfig: nextCartesia,
        llmConfig: nextLlm,
        sttConfig: nextStt,
      },
    });

    await this.auditService.log({
      adminId,
      action: "INTEGRATIONS_UPDATED",
      entityType: "integration_settings",
      entityId: existing.id,
      payload: {
        changedSecrets: [
          input.voximplantApiKey ? "voximplantApiKey" : null,
          input.voximplantApiSecret ? "voximplantApiSecret" : null,
          sharedGeminiSecret ? "geminiApiKey" : null,
        ].filter(Boolean),
      },
    });

    console.info("[integrations] secret fields updated where provided");

    return this.getMasked();
  }
}

function decryptNullable(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return decryptSecret(value, env.ENCRYPTION_KEY);
}
