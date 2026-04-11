import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const envPaths = [
  resolve(process.cwd(), ".env.local"),
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../.env.local"),
  resolve(process.cwd(), "../.env"),
  resolve(process.cwd(), "../../.env.local"),
  resolve(process.cwd(), "../../.env"),
  resolve(moduleDir, "../../../../.env.local"),
  resolve(moduleDir, "../../../../.env"),
];

for (const path of envPaths) {
  dotenv.config({ path, override: false });
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  TELEGRAM_AUTH_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(1440).default(15),
  JWT_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z.string().min(16),
  ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  ADMIN_PASSWORD: z.string().min(8).default("admin12345"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_TIME_WINDOW: z.string().default("1 minute"),
  TELEPHONY_PROVIDER: z.string().default("voximplant"),
  VOXIMPLANT_APPLICATION_ID: z.string().optional(),
  VOXIMPLANT_ACCOUNT_ID: z.string().optional(),
  VOXIMPLANT_API_KEY: z.string().optional(),
  VOXIMPLANT_API_SECRET: z.string().optional(),
  VOXIMPLANT_WEBHOOK_SECRET: z.string().optional(),
  PHONE_NUMBER_E164: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_LLM_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_TTS_MODEL: z.string().default("gemini-2.5-flash-preview-tts"),
  GEMINI_TTS_VOICE: z.string().default("Kore"),
  GEMINI_STT_MODEL: z.string().default("gemini-2.5-flash"),
  CARTESIA_API_KEY: z.string().optional(),
  CARTESIA_VOICE_ID: z.string().optional(),
  CARTESIA_MODEL_ID: z.string().default("sonic-2"),
  LLM_PROVIDER: z.string().default("gemini"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("gemini-2.5-flash"),
  STT_PROVIDER: z.string().default("gemini"),
  STT_API_KEY: z.string().optional(),
  PUBLIC_API_BASE_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    "Invalid environment variables",
    parsed.error.flatten().fieldErrors,
  );
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
