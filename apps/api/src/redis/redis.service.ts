import { Redis } from "ioredis";
import { env } from "@/common/env.js";

export class RedisService {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async connect(): Promise<void> {
    if (this.redis.status !== "ready") {
      try {
        await this.redis.connect();
      } catch {
        // Redis is optional for MVP local mode.
      }
    }
  }

  async setNX(key: string, value: string, ttlSec: number): Promise<boolean> {
    try {
      const result = await this.redis.set(key, value, "EX", ttlSec, "NX");
      return result === "OK";
    } catch {
      return true;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    try {
      if (ttlSec) {
        await this.redis.set(key, value, "EX", ttlSec);
      } else {
        await this.redis.set(key, value);
      }
    } catch {
      // no-op for degraded mode
    }
  }

  async incr(key: string, ttlSec?: number): Promise<number> {
    try {
      const value = await this.redis.incr(key);
      if (value === 1 && ttlSec) {
        await this.redis.expire(key, ttlSec);
      }
      return value;
    } catch {
      return 1;
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      // no-op
    }
  }
}
