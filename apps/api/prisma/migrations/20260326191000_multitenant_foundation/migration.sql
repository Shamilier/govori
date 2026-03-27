CREATE TYPE "TenantUserRole" AS ENUM ('OWNER', 'ADMIN');

CREATE TABLE "tenants" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "tenant_users" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "admin_id" TEXT NOT NULL,
  "role" "TenantUserRole" NOT NULL DEFAULT 'OWNER',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tenant_users_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tenant_users_tenant_id_admin_id_key" UNIQUE ("tenant_id", "admin_id")
);

CREATE TABLE "tenant_integration_settings" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL UNIQUE,
  "telephony_provider" TEXT NOT NULL DEFAULT 'voximplant',
  "voximplant_config_json" JSONB NOT NULL DEFAULT '{}',
  "cartesia_config_json" JSONB NOT NULL DEFAULT '{}',
  "llm_config_json" JSONB NOT NULL DEFAULT '{}',
  "stt_config_json" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_integration_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "phone_numbers" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "agent_id" TEXT,
  "e164" TEXT NOT NULL UNIQUE,
  "label" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'voximplant',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "phone_numbers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "tenants" ("id", "name", "slug", "is_active", "created_at", "updated_at")
VALUES ('tenant_default', 'Default Tenant', 'default', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

ALTER TABLE "agents" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "calls" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "calls" ADD COLUMN "phone_number_id" TEXT;

UPDATE "agents"
SET "tenant_id" = 'tenant_default'
WHERE "tenant_id" IS NULL;

UPDATE "calls"
SET "tenant_id" = 'tenant_default'
WHERE "tenant_id" IS NULL;

INSERT INTO "tenant_users" ("id", "tenant_id", "admin_id", "role", "created_at", "updated_at")
SELECT
  'tenant_user_' || substr(md5(a."id" || ':tenant_default'), 1, 16),
  'tenant_default',
  a."id",
  'OWNER'::"TenantUserRole",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "admins" a
ON CONFLICT ("tenant_id", "admin_id") DO NOTHING;

INSERT INTO "tenant_integration_settings" (
  "id",
  "tenant_id",
  "telephony_provider",
  "voximplant_config_json",
  "cartesia_config_json",
  "llm_config_json",
  "stt_config_json",
  "created_at",
  "updated_at"
)
SELECT
  'tenant_int_default',
  'tenant_default',
  s."telephony_provider",
  s."voximplant_config_json",
  s."cartesia_config_json",
  s."llm_config_json",
  s."stt_config_json",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "integration_settings" s
ORDER BY s."created_at" ASC
LIMIT 1
ON CONFLICT ("tenant_id") DO NOTHING;

INSERT INTO "tenant_integration_settings" (
  "id",
  "tenant_id",
  "telephony_provider",
  "voximplant_config_json",
  "cartesia_config_json",
  "llm_config_json",
  "stt_config_json",
  "created_at",
  "updated_at"
)
VALUES (
  'tenant_int_default',
  'tenant_default',
  'voximplant',
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("tenant_id") DO NOTHING;

INSERT INTO "phone_numbers" (
  "id",
  "tenant_id",
  "agent_id",
  "e164",
  "label",
  "provider",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  'phone_' || substr(md5(s."phone_number_e164"), 1, 18),
  'tenant_default',
  (SELECT a."id" FROM "agents" a ORDER BY a."created_at" ASC LIMIT 1),
  s."phone_number_e164",
  'Primary number',
  COALESCE(NULLIF(s."telephony_provider", ''), 'voximplant'),
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "integration_settings" s
WHERE s."phone_number_e164" IS NOT NULL
  AND length(trim(s."phone_number_e164")) > 0
ON CONFLICT ("e164") DO NOTHING;

UPDATE "calls" c
SET "phone_number_id" = p."id"
FROM "phone_numbers" p
WHERE c."phone_number_id" IS NULL
  AND c."callee_phone" = p."e164";

ALTER TABLE "agents"
  ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "calls"
  ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "agents"
  ADD CONSTRAINT "agents_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calls"
  ADD CONSTRAINT "calls_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calls"
  ADD CONSTRAINT "calls_phone_number_id_fkey"
  FOREIGN KEY ("phone_number_id") REFERENCES "phone_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "phone_numbers"
  ADD CONSTRAINT "phone_numbers_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tenant_users_admin_id_idx" ON "tenant_users"("admin_id");
CREATE INDEX "agents_tenant_id_is_active_idx" ON "agents"("tenant_id", "is_active");
CREATE INDEX "phone_numbers_tenant_id_is_active_idx" ON "phone_numbers"("tenant_id", "is_active");
CREATE INDEX "phone_numbers_agent_id_idx" ON "phone_numbers"("agent_id");
CREATE INDEX "calls_tenant_id_started_at_idx" ON "calls"("tenant_id", "started_at");
CREATE INDEX "calls_phone_number_id_idx" ON "calls"("phone_number_id");
