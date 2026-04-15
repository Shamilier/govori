import { createServer } from "node:http";
import dotenv from "dotenv";
import { webhookCallback } from "grammy";
import { z } from "zod";
import { ApiClient } from "./api/client.js";
import { createBot } from "./bot.js";
import { RedisSessionStore } from "./session/redis.js";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  BOT_TOKEN: z.string().min(1),
  API_BASE_URL: z.string().url().default("http://api:4000"),
  API_SERVICE_SECRET: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).default("redis://redis:6379"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8080),
  WEBHOOK_PATH: z.string().default("/telegram/webhook"),
  WEBHOOK_BASE_URL: z.string().url().optional(),
  WEB_ORIGIN: z.string().url().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1).optional(),
});

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  console.error(
    "Invalid tg-bot environment variables",
    parsedEnv.error.flatten().fieldErrors,
  );
  process.exit(1);
}

const env = parsedEnv.data;
const webhookPath = normalizeWebhookPath(env.WEBHOOK_PATH);

async function start(): Promise<void> {
  const sessionStore = new RedisSessionStore(env.REDIS_URL);
  await sessionStore.connect();

  const apiClient = new ApiClient(env.API_BASE_URL, {
    serviceSecret: env.API_SERVICE_SECRET ?? env.TELEGRAM_WEBHOOK_SECRET,
  });
  const bot = createBot({
    token: env.BOT_TOKEN,
    apiClient,
    sessionStore,
    authLinkBaseUrl: env.WEB_ORIGIN,
  });

  await registerWebhook(
    bot,
    env.WEBHOOK_BASE_URL ?? env.WEB_ORIGIN,
    webhookPath,
  );

  const webhookHandler = webhookCallback(bot, "http");

  const server = createServer(async (req, res) => {
    const requestUrl = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );

    if (req.method === "GET" && requestUrl.pathname === "/healthz") {
      res.statusCode = 200;
      res.end("ok");
      return;
    }

    if (req.method !== "POST" || requestUrl.pathname !== webhookPath) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    if (env.TELEGRAM_WEBHOOK_SECRET) {
      const header = req.headers["x-telegram-bot-api-secret-token"];
      const secretFromHeader = Array.isArray(header) ? header[0] : header;

      if (secretFromHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
        res.statusCode = 401;
        res.end("unauthorized");
        return;
      }
    }

    await webhookHandler(req, res);
  });

  await listen(server, env.HOST, env.PORT);
  console.info(
    `tg-bot webhook server listening on http://${env.HOST}:${env.PORT}${webhookPath}`,
  );

  const shutdown = async (): Promise<void> => {
    await closeServer(server);
    await sessionStore.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });

  process.once("SIGTERM", () => {
    void shutdown();
  });
}

async function registerWebhook(
  bot: ReturnType<typeof createBot>,
  webhookBaseUrl: string | undefined,
  path: string,
): Promise<void> {
  if (!webhookBaseUrl) {
    console.warn("WEBHOOK_BASE_URL/WEB_ORIGIN is not set. setWebhook skipped.");
    return;
  }

  if (!webhookBaseUrl.startsWith("https://")) {
    console.warn("Webhook base URL must be HTTPS. setWebhook skipped.");
    return;
  }

  const webhookUrl = `${webhookBaseUrl.replace(/\/+$/, "")}${path}`;

  try {
    await bot.api.setWebhook(webhookUrl, {
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"],
    });
    console.info(`Telegram webhook set to: ${webhookUrl}`);
  } catch (error) {
    console.error("Failed to register Telegram webhook", error);
  }
}

function normalizeWebhookPath(pathValue: string): string {
  const trimmed = pathValue.trim();

  if (trimmed.length === 0 || trimmed === "/") {
    return "/telegram/webhook";
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function listen(
  server: ReturnType<typeof createServer>,
  host: string,
  port: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

void start();
