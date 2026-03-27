import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function asInputJson(value: Prisma.JsonValue): Prisma.InputJsonValue {
  if (value === null) {
    return {};
  }
  return value as Prisma.InputJsonValue;
}

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.ADMIN_PASSWORD ?? "admin12345";
  const defaultTenantSlug = "default";
  const defaultTenantId = "tenant_default";
  const phoneNumberE164 = process.env.PHONE_NUMBER_E164?.trim() || null;

  const hash = await bcrypt.hash(password, 12);

  const admin = await prisma.admin.upsert({
    where: { email },
    update: { passwordHash: hash },
    create: {
      email,
      passwordHash: hash,
    },
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: defaultTenantSlug },
    update: {
      name: "Default Tenant",
      isActive: true,
    },
    create: {
      id: defaultTenantId,
      slug: defaultTenantSlug,
      name: "Default Tenant",
      isActive: true,
    },
  });

  await prisma.tenantUser.upsert({
    where: {
      tenantId_adminId: {
        tenantId: tenant.id,
        adminId: admin.id,
      },
    },
    update: {
      role: "OWNER",
    },
    create: {
      tenantId: tenant.id,
      adminId: admin.id,
      role: "OWNER",
    },
  });

  const existingAgent = await prisma.agent.findFirst({
    where: { tenantId: tenant.id },
  });
  if (!existingAgent) {
    await prisma.agent.create({
      data: {
        tenantId: tenant.id,
        name: "Main Voice Agent",
        systemPrompt:
          "Ты голосовой AI-агент. Отвечай кратко, вежливо и по делу. Если не уверен, задавай уточняющий вопрос.",
        greetingText: "Здравствуйте! Вы позвонили в сервис. Чем могу помочь?",
        fallbackText: "Извините, я не расслышал. Повторите, пожалуйста.",
        goodbyeText: "Спасибо за звонок. Хорошего дня!",
        language: "ru-RU",
        ttsVoiceId: process.env.CARTESIA_VOICE_ID ?? "default",
      },
    });
  }

  const settings = await prisma.integrationSettings.findFirst();
  if (!settings) {
    await prisma.integrationSettings.create({
      data: {
        telephonyProvider: process.env.TELEPHONY_PROVIDER ?? "voximplant",
        phoneNumberE164: process.env.PHONE_NUMBER_E164,
      },
    });
  }

  const currentSettings =
    settings ?? (await prisma.integrationSettings.findFirst());
  if (currentSettings) {
    await prisma.tenantIntegrationSettings.upsert({
      where: { tenantId: tenant.id },
      update: {
        telephonyProvider: currentSettings.telephonyProvider,
        voximplantConfig: asInputJson(currentSettings.voximplantConfig),
        cartesiaConfig: asInputJson(currentSettings.cartesiaConfig),
        llmConfig: asInputJson(currentSettings.llmConfig),
        sttConfig: asInputJson(currentSettings.sttConfig),
      },
      create: {
        tenantId: tenant.id,
        telephonyProvider: currentSettings.telephonyProvider,
        voximplantConfig: asInputJson(currentSettings.voximplantConfig),
        cartesiaConfig: asInputJson(currentSettings.cartesiaConfig),
        llmConfig: asInputJson(currentSettings.llmConfig),
        sttConfig: asInputJson(currentSettings.sttConfig),
      },
    });
  }

  if (phoneNumberE164) {
    const tenantAgent =
      existingAgent ??
      (await prisma.agent.findFirst({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "asc" },
      }));

    await prisma.phoneNumber.upsert({
      where: { e164: phoneNumberE164 },
      update: {
        tenantId: tenant.id,
        agentId: tenantAgent?.id ?? null,
        provider: process.env.TELEPHONY_PROVIDER ?? "voximplant",
        isActive: true,
      },
      create: {
        tenantId: tenant.id,
        agentId: tenantAgent?.id ?? null,
        e164: phoneNumberE164,
        label: "Primary number",
        provider: process.env.TELEPHONY_PROVIDER ?? "voximplant",
        isActive: true,
      },
    });
  }

  console.log(`Seed done. Admin: ${admin.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
