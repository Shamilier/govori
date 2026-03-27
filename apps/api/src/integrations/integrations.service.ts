import type {
  IntegrationSettings,
  Prisma,
  PrismaClient,
  TenantIntegrationSettings,
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
  cartesia: {
    apiKey: string | null;
    voiceId: string | null;
    modelId: string;
  };
  llm: {
    apiKey: string | null;
    model: string;
  };
  stt: {
    apiKey: string | null;
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

export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

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
    const voximplant = jsonObject(settings.voximplantConfig);
    const cartesia = jsonObject(settings.cartesiaConfig);
    const llm = jsonObject(settings.llmConfig);
    const stt = jsonObject(settings.sttConfig);

    return {
      id: settings.id,
      telephonyProvider: settings.telephonyProvider,
      phoneNumberE164: settings.phoneNumberE164,
      voximplantApplicationId:
        readString(voximplant, "applicationId") ??
        env.VOXIMPLANT_APPLICATION_ID ??
        null,
      voximplantAccountId:
        readString(voximplant, "accountId") ??
        env.VOXIMPLANT_ACCOUNT_ID ??
        null,
      voximplantApiKey: maskValue(
        decryptNullable(readString(voximplant, "apiKeyEnc")) ??
          env.VOXIMPLANT_API_KEY ??
          null,
      ),
      voximplantApiSecret: maskValue(
        decryptNullable(readString(voximplant, "apiSecretEnc")) ??
          env.VOXIMPLANT_API_SECRET ??
          null,
      ),
      cartesiaApiKey: maskValue(
        decryptNullable(readString(cartesia, "apiKeyEnc")) ??
          env.CARTESIA_API_KEY ??
          null,
      ),
      cartesiaVoiceId:
        readString(cartesia, "voiceId") ?? env.CARTESIA_VOICE_ID ?? null,
      cartesiaModelId: readString(cartesia, "modelId") ?? env.CARTESIA_MODEL_ID,
      llmApiKey: maskValue(
        decryptNullable(readString(llm, "apiKeyEnc")) ??
          env.LLM_API_KEY ??
          null,
      ),
      llmModel: readString(llm, "model") ?? env.LLM_MODEL,
      sttApiKey: maskValue(
        decryptNullable(readString(stt, "apiKeyEnc")) ??
          env.STT_API_KEY ??
          null,
      ),
      updatedAt: settings.updatedAt,
    };
  }

  async getDecrypted(): Promise<DecryptedIntegrationSettings> {
    const settings = await this.getOrCreate();
    const voximplant = jsonObject(settings.voximplantConfig);
    const cartesia = jsonObject(settings.cartesiaConfig);
    const llm = jsonObject(settings.llmConfig);
    const stt = jsonObject(settings.sttConfig);

    return {
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
      cartesia: {
        apiKey:
          decryptNullable(readString(cartesia, "apiKeyEnc")) ??
          env.CARTESIA_API_KEY ??
          null,
        voiceId:
          readString(cartesia, "voiceId") ?? env.CARTESIA_VOICE_ID ?? null,
        modelId: readString(cartesia, "modelId") ?? env.CARTESIA_MODEL_ID,
      },
      llm: {
        apiKey:
          decryptNullable(readString(llm, "apiKeyEnc")) ??
          env.LLM_API_KEY ??
          null,
        model: readString(llm, "model") ?? env.LLM_MODEL,
      },
      stt: {
        apiKey:
          decryptNullable(readString(stt, "apiKeyEnc")) ??
          env.STT_API_KEY ??
          null,
      },
    };
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
    return {
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
      cartesia: {
        apiKey:
          decryptNullable(readString(params.cartesia, "apiKeyEnc")) ??
          params.fallback.cartesia.apiKey,
        voiceId:
          readString(params.cartesia, "voiceId") ??
          params.fallback.cartesia.voiceId,
        modelId:
          readString(params.cartesia, "modelId") ??
          params.fallback.cartesia.modelId,
      },
      llm: {
        apiKey:
          decryptNullable(readString(params.llm, "apiKeyEnc")) ??
          params.fallback.llm.apiKey,
        model: readString(params.llm, "model") ?? params.fallback.llm.model,
      },
      stt: {
        apiKey:
          decryptNullable(readString(params.stt, "apiKeyEnc")) ??
          params.fallback.stt.apiKey,
      },
    };
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
      cartesiaApiKey: maskValue(decrypted.cartesia.apiKey),
      cartesiaVoiceId: decrypted.cartesia.voiceId,
      cartesiaModelId: decrypted.cartesia.modelId,
      llmApiKey: maskValue(decrypted.llm.apiKey),
      llmModel: decrypted.llm.model,
      sttApiKey: maskValue(decrypted.stt.apiKey),
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

    const nextVox = {
      applicationId:
        input.voximplantApplicationId ??
        readString(prevVox, "applicationId") ??
        fallback.voximplant.applicationId,
      accountId:
        input.voximplantAccountId ??
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

    const nextCartesia = {
      apiKeyEnc: nextSecret(
        input.cartesiaApiKey,
        readString(prevCartesia, "apiKeyEnc"),
      ),
      voiceId:
        input.cartesiaVoiceId ??
        readString(prevCartesia, "voiceId") ??
        fallback.cartesia.voiceId,
      modelId:
        input.cartesiaModelId ??
        readString(prevCartesia, "modelId") ??
        fallback.cartesia.modelId,
    };

    const nextLlm = {
      apiKeyEnc: nextSecret(input.llmApiKey, readString(prevLlm, "apiKeyEnc")),
      model: input.llmModel ?? readString(prevLlm, "model") ?? fallback.llm.model,
    };

    const nextStt = {
      apiKeyEnc: nextSecret(input.sttApiKey, readString(prevStt, "apiKeyEnc")),
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
          input.cartesiaApiKey ? "cartesiaApiKey" : null,
          input.llmApiKey ? "llmApiKey" : null,
          input.sttApiKey ? "sttApiKey" : null,
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

    const nextVox = {
      applicationId:
        input.voximplantApplicationId ?? readString(prevVox, "applicationId"),
      accountId: input.voximplantAccountId ?? readString(prevVox, "accountId"),
      apiKeyEnc: nextSecret(
        input.voximplantApiKey,
        readString(prevVox, "apiKeyEnc"),
      ),
      apiSecretEnc: nextSecret(
        input.voximplantApiSecret,
        readString(prevVox, "apiSecretEnc"),
      ),
    };

    const nextCartesia = {
      apiKeyEnc: nextSecret(
        input.cartesiaApiKey,
        readString(prevCartesia, "apiKeyEnc"),
      ),
      voiceId:
        input.cartesiaVoiceId ??
        readString(prevCartesia, "voiceId") ??
        env.CARTESIA_VOICE_ID,
      modelId:
        input.cartesiaModelId ??
        readString(prevCartesia, "modelId") ??
        env.CARTESIA_MODEL_ID,
    };

    const nextLlm = {
      apiKeyEnc: nextSecret(input.llmApiKey, readString(prevLlm, "apiKeyEnc")),
      model: input.llmModel ?? readString(prevLlm, "model") ?? env.LLM_MODEL,
    };

    const nextStt = {
      apiKeyEnc: nextSecret(input.sttApiKey, readString(prevStt, "apiKeyEnc")),
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
          input.cartesiaApiKey ? "cartesiaApiKey" : null,
          input.llmApiKey ? "llmApiKey" : null,
          input.sttApiKey ? "sttApiKey" : null,
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
