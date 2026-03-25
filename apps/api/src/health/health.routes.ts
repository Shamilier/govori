import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { RedisService } from "@/redis/redis.service.js";

type HealthRoutesDeps = {
  prisma: PrismaClient;
  redis: RedisService;
};

export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: HealthRoutesDeps,
): Promise<void> {
  app.get("/api/health", async (_request, reply) => {
    return reply.send({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  app.get("/api/health/deep", async (_request, reply) => {
    const result = {
      status: "ok",
      checks: {
        db: false,
        redis: false,
      },
      timestamp: new Date().toISOString(),
    };

    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      result.checks.db = true;
    } catch {
      result.status = "degraded";
    }

    try {
      await deps.redis.set("health:ping", "1", 5);
      const value = await deps.redis.get("health:ping");
      result.checks.redis = value === "1";
      if (!result.checks.redis) {
        result.status = "degraded";
      }
    } catch {
      result.status = "degraded";
    }

    return reply.send(result);
  });
}
