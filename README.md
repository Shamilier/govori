# GovorI MVP - Voice AI Agent Admin

MVP веб-сервис для настройки и тестирования **одного голосового AI-агента** на **одном входящем номере**.

В поставку включены:

- backend API (Fastify + TypeScript + Prisma + PostgreSQL + Redis)
- web admin UI (Next.js)
- provider abstraction (Telephony / TTS / STT / LLM)
- inbound webhook flow + call logging + transcript + outcome
- Docker Compose, миграции, seed admin, тесты

## 1. Что реализовано

### Must-have

- Логин/логаут admin (cookie JWT, httpOnly)
- Редактирование одного агента (`GET/PUT /api/agent`)
- Сохранение интеграций (`GET/PUT /api/integrations`) с masked secret полями
- Шифрование секретов в БД (AES-256-GCM)
- Тест Cartesia TTS (`POST /api/agent/test-tts`)
- Тест prompt (`POST /api/agent/test-prompt`)
- Inbound call flow через webhook провайдера:
  - inbound -> answer -> greeting -> media turns -> finalize
- Лог звонков, события timeline, реплики диалога
- Список звонков + карточка звонка + transcript endpoint
- Health endpoints
- Docker Compose
- Seed script для первого admin

### Nice-to-have (частично)

- Health checks по провайдерам (`POST /api/integrations/health`)
- Базовый audit log действий администратора

## 2. Стек

- Backend: TypeScript + Fastify
- Frontend: Next.js (App Router)
- DB: PostgreSQL
- ORM: Prisma
- Cache/session-idempotency: Redis
- Auth: local admin auth
- TTS: Cartesia provider + fallback wav mode
- STT: Mock STT provider (через интерфейс)
- LLM: OpenAI provider + fallback mode (через интерфейс)

## 3. Структура репозитория

- `apps/api` - backend API
- `apps/web` - frontend admin panel
- `apps/api/prisma/schema.prisma` - схема БД
- `apps/api/prisma/migrations` - миграции
- `apps/api/prisma/seed.ts` - seed admin и default agent
- `docker-compose.yml` - PostgreSQL + Redis + API + Web
- `.env.example` - пример env

## 4. Запуск локально

### Вариант A: локально (Postgres/Redis в Docker)

1. Скопировать env:

```bash
cp .env.example .env
```

2. Поднять инфраструктуру:

```bash
docker compose up -d postgres redis
```

3. Установить зависимости:

```bash
npm install
```

4. Сгенерировать Prisma client и применить миграции:

```bash
npm run prisma:generate -w apps/api
npm run prisma:migrate -w apps/api
```

5. Засидить admin и baseline данные:

```bash
npm run seed -w apps/api
```

6. Запустить API + Web:

```bash
npm run dev
```

- Web UI: `http://localhost:3000`
- API: `http://localhost:4000`

### Вариант B: всё в Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

## 5. Admin по умолчанию

Берётся из `.env`:

- `ADMIN_EMAIL=admin@example.com`
- `ADMIN_PASSWORD=admin12345`

## 6. Реализованные endpoint-ы

### Auth

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Agent

- `GET /api/agent`
- `PUT /api/agent`
- `POST /api/agent/test-tts`
- `POST /api/agent/test-prompt`

### Integrations

- `GET /api/integrations`
- `PUT /api/integrations`
- `POST /api/integrations/health`

### Calls

- `GET /api/calls`
- `GET /api/calls/:id`
- `GET /api/calls/:id/transcript`

### Telephony webhooks

- `POST /api/webhooks/telephony/inbound`
- `POST /api/webhooks/telephony/status`
- `POST /api/webhooks/telephony/media`

### Voximplant standalone integration (без voicyfy)

- `GET /api/voximplant/assistants/config/:id`
- `POST /api/voximplant/functions/execute`
- `POST /api/voximplant/log`

### Health

- `GET /api/health`
- `GET /api/health/deep`

## 7. Архитектура (кратко)

### Provider abstractions

- `TelephonyProvider`
- `TtsProvider`
- `SpeechToTextProvider`
- `ConversationModelProvider`

Текущие реализации:

- Telephony: `VoximplantTelephonyProvider` (MVP adapter)
- TTS: `CartesiaTtsProvider`
- STT: `MockSpeechToTextProvider`
- LLM: `OpenAIConversationProvider`

### Core orchestration

- `CallSessionOrchestrator` управляет состояниями звонка:
  - `RINGING -> ANSWERED -> GREETING -> LISTENING -> TRANSCRIBING -> THINKING -> SYNTHESIZING -> SPEAKING -> COMPLETED/FAILED`
- Идемпотентность media webhook через Redis `setNX`
- Fail-safe сценарий при ошибках внешних интеграций

### Conversation

- `ConversationService`:
  - собирает prompt
  - учитывает историю
  - ограничивает длину ответа
  - определяет `shouldHangup`
  - строит структурированный outcome

## 8. Безопасность и эксплуатация

- Секреты интеграций шифруются в БД
- API keys не логируются в plaintext
- CSRF проверка для mutating admin endpoints
- Rate limit на API
- Audit log admin действий

## 9. БД и миграции

Минимальные сущности:

- `admins`
- `agents`
- `integration_settings`
- `calls`
- `call_messages`
- `call_events`
- `admin_audit_logs`

Схема: `apps/api/prisma/schema.prisma`

## 10. Тесты

- Unit: `ConversationService`
- Integration-style routes:
  - auth
  - agent settings
  - calls list

Запуск:

```bash
npm run test
```

## 11. Известные ограничения MVP

- Voximplant adapter в текущем MVP реализован как abstraction-ready интеграционный слой; production-specific media bridge для конкретного аккаунта провайдера потребует донастройки webhook payload/сценария на стороне провайдера.
- STT в MVP - mock/turn-based (без full duplex).
- LLM/TTS имеют fallback режимы при отсутствии API ключей.
- Single-admin / single-agent / single-number сценарий (архитектура подготовлена к расширению, но мульти-tenant и multi-agent не включены).
- Нет исходящих звонков, Telegram, биллинга, CRM, кампаний, RBAC (по ТЗ первой версии).
# govori
