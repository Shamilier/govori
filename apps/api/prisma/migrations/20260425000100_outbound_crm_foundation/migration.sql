ALTER TYPE "CallDirection" ADD VALUE IF NOT EXISTS 'OUTBOUND';

CREATE TABLE IF NOT EXISTS "tenant_crm_integrations" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL UNIQUE,
  "provider" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "config_json" JSONB NOT NULL DEFAULT '{}',
  "mapping_json" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_crm_integrations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "tenant_crm_integrations_provider_idx"
  ON "tenant_crm_integrations"("provider");

CREATE INDEX IF NOT EXISTS "tenant_crm_integrations_is_active_idx"
  ON "tenant_crm_integrations"("is_active");
