CREATE TABLE IF NOT EXISTS "telegram_bindings" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "telegram_user_id" BIGINT NOT NULL,
  "linked_by_admin_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "telegram_bindings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "telegram_bindings_linked_by_admin_id_fkey"
    FOREIGN KEY ("linked_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_bindings_telegram_user_id_key" ON "telegram_bindings"("telegram_user_id");
CREATE INDEX IF NOT EXISTS "telegram_bindings_tenant_id_idx" ON "telegram_bindings"("tenant_id");

CREATE TABLE IF NOT EXISTS "telegram_auth_tokens" (
  "id" TEXT PRIMARY KEY,
  "token_hash" TEXT NOT NULL UNIQUE,
  "telegram_user_id" BIGINT NOT NULL,
  "chat_id" BIGINT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "consumed_by_admin_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_auth_tokens_consumed_by_admin_id_fkey"
    FOREIGN KEY ("consumed_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "telegram_auth_tokens_telegram_user_id_idx" ON "telegram_auth_tokens"("telegram_user_id");
CREATE INDEX IF NOT EXISTS "telegram_auth_tokens_expires_at_idx" ON "telegram_auth_tokens"("expires_at");
