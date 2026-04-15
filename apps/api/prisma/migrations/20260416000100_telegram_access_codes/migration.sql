ALTER TABLE "telegram_bindings"
  ADD COLUMN IF NOT EXISTS "bound_agent_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'telegram_bindings_bound_agent_id_fkey'
  ) THEN
    ALTER TABLE "telegram_bindings"
      ADD CONSTRAINT "telegram_bindings_bound_agent_id_fkey"
      FOREIGN KEY ("bound_agent_id") REFERENCES "agents"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "telegram_bindings_bound_agent_id_idx"
  ON "telegram_bindings"("bound_agent_id");

CREATE TABLE IF NOT EXISTS "tenant_access_codes" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "agent_id" TEXT,
  "label" TEXT,
  "code_hash" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "expires_at" TIMESTAMP(3),
  "max_uses" INTEGER,
  "used_count" INTEGER NOT NULL DEFAULT 0,
  "last_used_at" TIMESTAMP(3),
  "created_by_admin_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_access_codes_code_hash_key" UNIQUE ("code_hash"),
  CONSTRAINT "tenant_access_codes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tenant_access_codes_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "tenant_access_codes_created_by_admin_id_fkey"
    FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "tenant_access_codes_tenant_id_is_active_idx"
  ON "tenant_access_codes"("tenant_id", "is_active");

CREATE INDEX IF NOT EXISTS "tenant_access_codes_agent_id_idx"
  ON "tenant_access_codes"("agent_id");

CREATE INDEX IF NOT EXISTS "tenant_access_codes_expires_at_idx"
  ON "tenant_access_codes"("expires_at");
