CREATE TYPE "CallDirection" AS ENUM ('INBOUND');
CREATE TYPE "CallStatus" AS ENUM ('CREATED', 'RINGING', 'ANSWERED', 'GREETING', 'LISTENING', 'TRANSCRIBING', 'THINKING', 'SYNTHESIZING', 'SPEAKING', 'COMPLETED', 'FAILED');
CREATE TYPE "MessageRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL');

CREATE TABLE "admins" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "agents" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "system_prompt" TEXT NOT NULL,
  "greeting_text" TEXT NOT NULL,
  "fallback_text" TEXT NOT NULL,
  "goodbye_text" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "interruption_enabled" BOOLEAN NOT NULL DEFAULT true,
  "silence_timeout_ms" INTEGER NOT NULL DEFAULT 7000,
  "max_call_duration_sec" INTEGER NOT NULL DEFAULT 300,
  "max_turns" INTEGER NOT NULL DEFAULT 20,
  "response_temperature" DECIMAL(3,2) NOT NULL DEFAULT 0.30,
  "response_max_tokens" INTEGER NOT NULL DEFAULT 250,
  "tts_provider" TEXT NOT NULL DEFAULT 'cartesia',
  "tts_voice_id" TEXT NOT NULL,
  "tts_speed" DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  "tts_sample_rate" INTEGER NOT NULL DEFAULT 8000,
  "stt_provider" TEXT NOT NULL DEFAULT 'mock',
  "llm_provider" TEXT NOT NULL DEFAULT 'openai',
  "record_calls" BOOLEAN NOT NULL DEFAULT true,
  "tts_test_phrase" TEXT NOT NULL DEFAULT 'Это тест голоса агента',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "integration_settings" (
  "id" TEXT PRIMARY KEY,
  "telephony_provider" TEXT NOT NULL DEFAULT 'voximplant',
  "phone_number_e164" TEXT,
  "voximplant_config_json" JSONB NOT NULL DEFAULT '{}',
  "cartesia_config_json" JSONB NOT NULL DEFAULT '{}',
  "llm_config_json" JSONB NOT NULL DEFAULT '{}',
  "stt_config_json" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "calls" (
  "id" TEXT PRIMARY KEY,
  "external_call_id" TEXT NOT NULL UNIQUE,
  "agent_id" TEXT NOT NULL,
  "direction" "CallDirection" NOT NULL DEFAULT 'INBOUND',
  "caller_phone" TEXT,
  "callee_phone" TEXT,
  "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answered_at" TIMESTAMP(3),
  "ended_at" TIMESTAMP(3),
  "duration_sec" INTEGER,
  "recording_url" TEXT,
  "transcript_text" TEXT,
  "outcome_json" JSONB,
  "error_message" TEXT,
  "system_prompt_snapshot" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "calls_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "call_messages" (
  "id" TEXT PRIMARY KEY,
  "call_id" TEXT NOT NULL,
  "role" "MessageRole" NOT NULL,
  "text" TEXT NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "started_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "meta_json" JSONB,
  CONSTRAINT "call_messages_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "call_messages_call_id_sequence_no_key" UNIQUE ("call_id", "sequence_no")
);

CREATE TABLE "call_events" (
  "id" TEXT PRIMARY KEY,
  "call_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "call_events_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "admin_audit_logs" (
  "id" TEXT PRIMARY KEY,
  "admin_id" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "payload_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "calls_status_idx" ON "calls"("status");
CREATE INDEX "calls_caller_phone_idx" ON "calls"("caller_phone");
CREATE INDEX "calls_started_at_idx" ON "calls"("started_at");
CREATE INDEX "call_messages_call_id_sequence_no_idx" ON "call_messages"("call_id", "sequence_no");
CREATE INDEX "call_events_call_id_created_at_idx" ON "call_events"("call_id", "created_at");
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");
