import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.ADMIN_PASSWORD ?? "admin12345";

  const hash = await bcrypt.hash(password, 12);
  const tenant = await prisma.tenant.upsert({
    where: { name: "Default Tenant" },
    update: {},
    create: {
      name: "Default Tenant",
    },
  });

  const admin = await prisma.admin.upsert({
    where: { email },
    update: {
      passwordHash: hash,
      tenantId: tenant.id,
    },
    create: {
      email,
      passwordHash: hash,
      tenantId: tenant.id,
    },
  });

  await prisma.admin.updateMany({
    where: { tenantId: null },
    data: { tenantId: tenant.id },
  });

  const existingAgent = await prisma.agent.findFirst();
  if (!existingAgent) {
    await prisma.agent.create({
      data: {
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

  console.log(`Seed done. Admin: ${admin.email}, tenant: ${tenant.name}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
