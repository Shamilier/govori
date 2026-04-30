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
    outboundRuleId: string | null;
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
    provider: string;
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

function normalizeGeminiModel(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || !/^gemini-/i.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeElevenLabsModel(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || !/^eleven_/i.test(normalized)) {
    return null;
  }
  return normalized;
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
  return input.geminiApiKey ?? input.llmApiKey ?? input.sttApiKey;
}

function pickSharedTtsSecret(input: IntegrationsUpdateInput): string | undefined {
  return input.elevenlabsApiKey ?? input.cartesiaApiKey;
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
      outboundRuleId: string | null;
    };
    gemini: {
      apiKey: string | null;
      llmModel: string;
      ttsModel: string;
      ttsVoice: string;
      sttModel: string;
    };
    tts: {
      provider: string;
      apiKey: string | null;
      modelId: string;
      voiceId: string;
    };
  }): DecryptedIntegrationSettings {
    return {
      ...base,
      llm: {
        apiKey: base.gemini.apiKey,
        model: base.gemini.llmModel,
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
    const useLegacyTtsSecret =
      env.TTS_PROVIDER.trim().toLowerCase() !== "elevenlabs";

    const apiKey =
      decryptNullable(readString(params.llm, "apiKeyEnc")) ??
      (useLegacyTtsSecret
        ? decryptNullable(readString(params.cartesia, "apiKeyEnc"))
        : null) ??
      decryptNullable(readString(params.stt, "apiKeyEnc")) ??
      fallback?.apiKey ??
      env.GEMINI_API_KEY ??
      env.LLM_API_KEY ??
      (useLegacyTtsSecret ? env.CARTESIA_API_KEY : null) ??
      env.STT_API_KEY ??
      null;

    const llmModel =
      readString(params.llm, "model") ??
      fallback?.llmModel ??
      env.GEMINI_LLM_MODEL ??
      env.LLM_MODEL;

    const ttsModel =
      (useLegacyTtsSecret
        ? normalizeGeminiModel(readString(params.cartesia, "modelId"))
        : null) ??
      normalizeGeminiModel(fallback?.ttsModel) ??
      env.GEMINI_TTS_MODEL;

    const ttsVoice =
      (useLegacyTtsSecret ? readString(params.cartesia, "voiceId") : null) ??
      fallback?.ttsVoice ??
      env.GEMINI_TTS_VOICE ??
      (useLegacyTtsSecret ? env.CARTESIA_VOICE_ID : null) ??
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

  private buildTtsConfig(params: {
    cartesia: Record<string, unknown>;
    fallback?: DecryptedIntegrationSettings["tts"];
  }): DecryptedIntegrationSettings["tts"] {
    const fallback = params.fallback;
    const provider = env.TTS_PROVIDER.trim().toLowerCase();

    if (provider === "elevenlabs") {
      return {
        provider,
        apiKey:
          decryptNullable(readString(params.cartesia, "apiKeyEnc")) ??
          fallback?.apiKey ??
          env.ELEVENLABS_API_KEY ??
          null,
        modelId:
          normalizeElevenLabsModel(readString(params.cartesia, "modelId")) ??
          normalizeElevenLabsModel(fallback?.modelId) ??
          env.ELEVENLABS_MODEL_ID,
        voiceId:
          readString(params.cartesia, "voiceId") ??
          fallback?.voiceId ??
          env.ELEVENLABS_VOICE_ID ??
          "JBFqnCBsd6RMkjVDRZzb",
      };
    }

    return {
      provider,
      apiKey:
        decryptNullable(readString(params.cartesia, "apiKeyEnc")) ??
        fallback?.apiKey ??
        env.GEMINI_API_KEY ??
        env.CARTESIA_API_KEY ??
        null,
      modelId:
        normalizeGeminiModel(readString(params.cartesia, "modelId")) ??
        normalizeGeminiModel(fallback?.modelId) ??
        env.GEMINI_TTS_MODEL,
      voiceId:
        readString(params.cartesia, "voiceId") ??
        fallback?.voiceId ??
        env.GEMINI_TTS_VOICE ??
        "Kore",
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
      voximplantOutboundRuleId: decrypted.voximplant.outboundRuleId,
      geminiApiKey: maskValue(decrypted.gemini.apiKey),
      geminiLlmModel: decrypted.gemini.llmModel,
      geminiTtsModel: decrypted.gemini.ttsModel,
      geminiTtsVoice: decrypted.gemini.ttsVoice,
      geminiSttModel: decrypted.gemini.sttModel,
      ttsProvider: decrypted.tts.provider,
      elevenlabsApiKey: maskValue(decrypted.tts.apiKey),
      elevenlabsVoiceId: decrypted.tts.voiceId,
      elevenlabsModelId: decrypted.tts.modelId,
      // Legacy aliases for old UI payloads.
      cartesiaApiKey: maskValue(decrypted.tts.apiKey),
      cartesiaVoiceId: decrypted.tts.voiceId,
      cartesiaModelId: decrypted.tts.modelId,
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
    const tts = this.buildTtsConfig({ cartesia });

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
        outboundRuleId:
          readString(voximplant, "outboundRuleId") ??
          env.VOXIMPLANT_OUTBOUND_RULE_ID ??
          null,
      },
      gemini,
      tts,
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
    const tts = this.buildTtsConfig({
      cartesia: params.cartesia,
      fallback: params.fallback.tts,
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
        outboundRuleId:
          readString(params.voximplant, "outboundRuleId") ??
          params.fallback.voximplant.outboundRuleId,
      },
      gemini,
      tts,
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
      voximplantOutboundRuleId: decrypted.voximplant.outboundRuleId,
      geminiApiKey: maskValue(decrypted.gemini.apiKey),
      geminiLlmModel: decrypted.gemini.llmModel,
      geminiTtsModel: decrypted.gemini.ttsModel,
      geminiTtsVoice: decrypted.gemini.ttsVoice,
      geminiSttModel: decrypted.gemini.sttModel,
      ttsProvider: decrypted.tts.provider,
      elevenlabsApiKey: maskValue(decrypted.tts.apiKey),
      elevenlabsVoiceId: decrypted.tts.voiceId,
      elevenlabsModelId: decrypted.tts.modelId,
      cartesiaApiKey: maskValue(decrypted.tts.apiKey),
      cartesiaVoiceId: decrypted.tts.voiceId,
      cartesiaModelId: decrypted.tts.modelId,
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
    const sharedTtsSecret = pickSharedTtsSecret(input);

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
      outboundRuleId:
        normalizeNonEmpty(input.voximplantOutboundRuleId) ??
        readString(prevVox, "outboundRuleId") ??
        fallback.voximplant.outboundRuleId,
    };

    const nextGeminiLlmModel =
      normalizeNonEmpty(input.geminiLlmModel ?? input.llmModel ?? undefined) ??
      readString(prevLlm, "model") ??
      fallback.gemini.llmModel;

    const nextTtsModel =
      normalizeNonEmpty(
        input.elevenlabsModelId ??
          input.geminiTtsModel ??
          input.cartesiaModelId ??
          undefined,
      ) ??
      readString(prevCartesia, "modelId") ??
      fallback.tts.modelId;

    const nextTtsVoice =
      normalizeNonEmpty(
        input.elevenlabsVoiceId ??
          input.geminiTtsVoice ??
          input.cartesiaVoiceId ??
          undefined,
      ) ??
      readString(prevCartesia, "voiceId") ??
      fallback.tts.voiceId;

    const nextGeminiSttModel =
      normalizeNonEmpty(input.geminiSttModel) ??
      readString(prevStt, "model") ??
      fallback.gemini.sttModel;

    const nextCartesia = {
      apiKeyEnc: nextSecret(
        sharedTtsSecret,
        readString(prevCartesia, "apiKeyEnc"),
      ),
      voiceId: nextTtsVoice,
      modelId: nextTtsModel,
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
          sharedTtsSecret ? "elevenlabsApiKey" : null,
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
    const sharedTtsSecret = pickSharedTtsSecret(input);

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
      outboundRuleId:
        normalizeNonEmpty(input.voximplantOutboundRuleId) ??
        readString(prevVox, "outboundRuleId") ??
        env.VOXIMPLANT_OUTBOUND_RULE_ID ??
        null,
    };

    const nextGeminiLlmModel =
      normalizeNonEmpty(input.geminiLlmModel ?? input.llmModel ?? undefined) ??
      readString(prevLlm, "model") ??
      env.GEMINI_LLM_MODEL ??
      env.LLM_MODEL;

    const nextTtsModel =
      normalizeNonEmpty(
        input.elevenlabsModelId ??
          input.geminiTtsModel ??
          input.cartesiaModelId ??
          undefined,
      ) ??
      readString(prevCartesia, "modelId") ??
      (env.TTS_PROVIDER.trim().toLowerCase() === "elevenlabs"
        ? env.ELEVENLABS_MODEL_ID
        : env.GEMINI_TTS_MODEL);

    const nextTtsVoice =
      normalizeNonEmpty(
        input.elevenlabsVoiceId ??
          input.geminiTtsVoice ??
          input.cartesiaVoiceId ??
          undefined,
      ) ??
      readString(prevCartesia, "voiceId") ??
      (env.TTS_PROVIDER.trim().toLowerCase() === "elevenlabs"
        ? env.ELEVENLABS_VOICE_ID
        : env.GEMINI_TTS_VOICE) ??
      "Kore";

    const nextGeminiSttModel =
      normalizeNonEmpty(input.geminiSttModel) ??
      readString(prevStt, "model") ??
      env.GEMINI_STT_MODEL;

    const nextCartesia = {
      apiKeyEnc: nextSecret(
        sharedTtsSecret,
        readString(prevCartesia, "apiKeyEnc"),
      ),
      voiceId: nextTtsVoice,
      modelId: nextTtsModel,
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
          sharedTtsSecret ? "elevenlabsApiKey" : null,
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
