# GovorI — Голосовой AI-агент для бизнеса

GovorI — это платформа для создания и управления голосовым AI-агентом, который автоматически отвечает на входящие телефонные звонки. Агент понимает речь абонента, отвечает живым голосом и соблюдает заданный сценарий — как настоящий оператор колл-центра.

**Для кого:** малый и средний бизнес, которому нужен автоматический первый контакт с клиентом по телефону — запись на приём, ответы на типовые вопросы, сбор заявок, охранные компании, медклиники, автосервисы и т.д.

---

## Как это работает

```
Клиент звонит на номер
        │
        ▼
   Voximplant (телефония)
        │ WebSocket (аудиопоток)
        ▼
  GovorI Backend (Нидерланды)
        │
        ├──▶ Deepgram  — распознаёт речь в реальном времени (STT)
        ├──▶ OpenAI    — генерирует ответ (LLM)
        └──▶ Cartesia  — синтезирует живой голос с интонациями (TTS)
        │
        ▼
  Клиент слышит ответ (~600–800ms задержка)
        │
        ▼
  Диалог логируется в базу данных
        │
        ▼
  Администратор видит карточку звонка в веб-панели
```

**Ключевые особенности:**
- Агент отвечает голосом с человеческими интонациями (Cartesia Sonic)
- Если клиент перебивает — агент замолкает и слушает (interruption detection)
- Вся история звонков с транскриптами доступна в веб-интерфейсе
- Настройка промпта, голоса и поведения — через удобную админку без кода

---

## Стек технологий

| Компонент | Технология | Зачем |
|-----------|-----------|-------|
| Backend API | TypeScript + Fastify | HTTP API + WebSocket media server |
| Frontend | Next.js 15 + React 19 | Веб-панель администратора |
| База данных | PostgreSQL 16 | Хранение агентов, звонков, транскриптов |
| Кеш / сессии | Redis 7 | Аудиобуфер, временные данные, идемпотентность |
| ORM | Prisma | Схема БД + миграции |
| Авторизация | JWT (httpOnly cookie) + CSRF | Безопасная сессия одного администратора |
| Телефония | Voximplant | Приём входящих звонков, аудиобридж |
| STT | Deepgram Nova-2 | Стриминговое распознавание речи в реальном времени |
| LLM | OpenAI GPT-4o | Генерация ответов с учётом контекста диалога |
| TTS | Cartesia Sonic | Синтез живого голоса с интонациями (~90ms до первого байта) |
| Деплой | Docker Compose + Caddy | HTTPS автоматически, один `docker compose up` |

---

## Структура репозитория

```
govori/
├── apps/
│   ├── api/                    # Backend (Fastify + TypeScript)
│   │   ├── src/
│   │   │   ├── agent/          # Управление агентом
│   │   │   ├── auth/           # Авторизация
│   │   │   ├── calls/          # Логика звонков, оркестратор, история
│   │   │   ├── integrations/   # Настройки провайдеров (зашифрованы)
│   │   │   ├── media/          # WebSocket media server (STT→LLM→TTS pipeline)
│   │   │   ├── providers/      # Абстракции: TTS, STT, LLM, Telephony
│   │   │   ├── voximplant/     # Voximplant-специфичные endpoints
│   │   │   ├── webhooks/       # Webhook от телефонии
│   │   │   ├── health/         # Health checks
│   │   │   └── common/         # Env, crypto, constants
│   │   └── prisma/
│   │       ├── schema.prisma   # Схема базы данных
│   │       ├── migrations/     # Миграции
│   │       └── seed.ts         # Создание первого администратора
│   └── web/                    # Frontend (Next.js)
│       └── src/app/
│           ├── login/          # Страница входа
│           ├── dashboard/      # Главная: статус агента, последние звонки
│           ├── agent/          # Настройки агента и голоса
│           ├── integrations/   # API ключи и настройки провайдеров
│           └── calls/          # История звонков + карточка звонка
├── infra/
│   ├── Caddyfile               # HTTPS reverse proxy (disciplaner.online)
│   └── voximplant-inbound.js   # Скрипт Voximplant (медиабридж к backend)
├── docker-compose.yml          # Postgres + Redis + API + Web + Caddy
├── .env.example                # Пример переменных окружения
└── README.md
```

---

## Быстрый старт (продакшн на сервере)

### Требования
- Linux сервер с Docker и Docker Compose
- Домен с DNS A-записями: `disciplaner.online` и `api.disciplaner.online` → IP сервера
- Открытые порты 80 и 443

### 1. Клонировать и настроить окружение

```bash
git clone <repo> /opt/govori && cd /opt/govori
cp .env.example .env
nano .env   # заполнить API ключи (см. раздел «Переменные окружения»)
```

### 2. Запустить

```bash
docker compose up -d --build
```

Caddy автоматически получит SSL-сертификат от Let's Encrypt. После запуска:
- Веб-панель: `https://disciplaner.online`
- API: `https://api.disciplaner.online`
- Health: `https://api.disciplaner.online/api/health`

### 3. Войти в панель

Email и пароль берутся из `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`).

---

## Локальная разработка

```bash
# Поднять инфраструктуру
docker compose up -d postgres redis

# Установить зависимости
npm install

# Применить миграции и создать администратора
npm run prisma:generate -w apps/api
npm run prisma:dev -w apps/api
npm run seed -w apps/api

# Запустить API + Web
npm run dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:4000`

---

## Переменные окружения

Скопируй `.env.example` в `.env` и заполни:

```bash
# Безопасность — сгенерируй случайные строки
JWT_SECRET=<минимум 32 символа>
ENCRYPTION_KEY=<ровно 32 символа>

# Твой домен
PUBLIC_API_BASE_URL=https://api.disciplaner.online
WEB_ORIGIN=https://disciplaner.online
NEXT_PUBLIC_API_URL=https://api.disciplaner.online

# Администратор (создаётся при первом запуске через seed)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=StrongPassword123!

# База данных (для Docker Compose — не менять хост)
DATABASE_URL=postgresql://govori:Shamil2004!@postgres:5432/govori
REDIS_URL=redis://redis:6379

# OpenAI — нужен для LLM (GPT-4o) и Voximplant Realtime (STT)
LLM_API_KEY=sk-proj-...

# Cartesia — TTS с живым голосом
CARTESIA_API_KEY=sk-...
CARTESIA_VOICE_ID=<ID голоса из play.cartesia.ai>
CARTESIA_MODEL_ID=sonic-2

# Voximplant
VOXIMPLANT_WEBHOOK_SECRET=<любая строка для защиты webhook>
PHONE_NUMBER_E164=+79XXXXXXXXX

# Deepgram — для стримингового STT в media pipeline
# STT_API_KEY=<deepgram api key>
```

Где взять ключи:
- OpenAI: https://platform.openai.com/api-keys
- Cartesia: https://play.cartesia.ai → Settings → API Keys
- Cartesia Voice ID: https://play.cartesia.ai → Voices → скопировать ID
- Deepgram: https://console.deepgram.com

---

## API Endpoints

### Auth
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/auth/login` | Войти (email + password → cookie) |
| POST | `/api/auth/logout` | Выйти |
| GET | `/api/auth/me` | Текущий администратор |

### Agent
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/agent` | Получить настройки агента |
| PUT | `/api/agent` | Обновить настройки |
| POST | `/api/agent/test-tts` | Тест голоса Cartesia |
| POST | `/api/agent/test-prompt` | Тест промпта с LLM |

### Integrations
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/integrations` | Настройки (секреты замаскированы) |
| PUT | `/api/integrations` | Обновить настройки |
| POST | `/api/integrations/health` | Проверить все провайдеры |

### Calls
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/calls` | Список звонков с фильтрами |
| GET | `/api/calls/:id` | Карточка звонка |
| GET | `/api/calls/:id/transcript` | Транскрипт по репликам |

### Voximplant
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/voximplant/assistants/config/:id` | Конфиг агента для скрипта |
| POST | `/api/voximplant/synthesize` | Cartesia TTS → audio URL |
| GET | `/api/voximplant/audio/:id` | Отдать WAV файл (из Redis) |
| POST | `/api/voximplant/functions/execute` | Выполнить function call |
| POST | `/api/voximplant/log` | Сохранить реплику диалога |

### Media Pipeline (WebSocket)
| Протокол | Путь | Описание |
|----------|------|----------|
| WS | `/api/media/session` | Аудиобридж: Voximplant ↔ STT→LLM→TTS |

### Health
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/health` | Базовая проверка |
| GET | `/api/health/deep` | Проверка БД + Redis |

---

## База данных

```
admins              — один администратор
agents              — настройки агента (промпт, голос, поведение)
integration_settings — API ключи провайдеров (зашифрованы AES-256-GCM)
calls               — каждый входящий звонок
call_messages       — реплики диалога (USER / ASSISTANT)
call_events         — timeline событий звонка
admin_audit_logs    — лог действий администратора
```

---

## Безопасность

- API ключи провайдеров хранятся зашифрованными (AES-256-GCM)
- Сессия через httpOnly cookie (не доступна JavaScript)
- CSRF-токен для всех мутирующих запросов
- Rate limiting на API
- Webhook от Voximplant проверяется по секрету
- Audit log всех действий администратора

---

## Дорожная карта

### ✅ Шаг 1 — Backend API (выполнено)
Fastify + Prisma + PostgreSQL + Redis. Auth, agent CRUD, integrations, calls history, health checks. Все provider abstractions (TTS/STT/LLM/Telephony).

### ✅ Шаг 2 — Frontend Admin UI (выполнено)
Next.js: логин, dashboard, настройки агента, интеграции, список звонков, карточка звонка.

### ✅ Шаг 3 — Docker Compose + HTTPS деплой (выполнено)
Caddy reverse proxy с автоматическим SSL. Healthcheck для Postgres и Redis. Работает на `disciplaner.online`.

### ✅ Шаг 4 — Cartesia TTS endpoint (выполнено)
`POST /api/voximplant/synthesize` → вызывает Cartesia → сохраняет аудио в Redis → возвращает URL. `GET /api/voximplant/audio/:id` → отдаёт WAV. TTL 120 секунд.

### ✅ Шаг 5 — Voximplant конфиг и логирование (выполнено)
Скрипт Voximplant получает промпт + голос + ключи с backend. Каждая реплика логируется. Звонки сохраняются в БД с транскриптом и outcome.

### 🔲 Шаг 6 — WebSocket Media Server на backend
Принимать аудиопоток от Voximplant по WebSocket (PCM 8kHz/16kHz). Управлять сессией: start → streaming → interrupt → end. Хранить состояние сессии в Redis.

### 🔲 Шаг 7 — Deepgram Streaming STT
Подключить Deepgram Nova-2 (EU endpoint). Стримить входящий PCM аудиопоток. Обрабатывать `SpeechFinal` event как сигнал конца реплики. Передавать транскрипт в LLM pipeline.

### 🔲 Шаг 8 — OpenAI Chat Streaming (LLM)
На основе транскрипта + истории диалога → OpenAI Chat API с streaming. Разбивать поток токенов на предложения. Передавать предложения в TTS сразу (без ожидания полного ответа).

### 🔲 Шаг 9 — Cartesia Streaming TTS
Стриминговый синтез речи через Cartesia Sonic. Первый аудиочанк уходит в Voximplant через ~90ms после получения первого предложения. Перемежение: пока говорит первое предложение — синтезируется второе.

### 🔲 Шаг 10 — Voximplant скрипт v3 (медиабридж) + финальное тестирование
Упростить скрипт Voximplant до чистого медиабриджа: `VoxEngine.sendMediaBetween(call, backendWebSocket)`. Протестировать interruption: Deepgram фиксирует речь во время playback → backend шлёт `interrupt` → Voximplant останавливает воспроизведение. Нагрузочное тестирование 2-3 параллельных звонка. Go-live.

---

## Известные ограничения текущей версии

- Один администратор, один агент, один номер (архитектура подготовлена к расширению)
- Нет исходящих звонков, Telegram-бота, биллинга, CRM, кампаний обзвона, RBAC
- Media pipeline (шаги 6-10) ещё в разработке — текущий скрипт Voximplant использует Cartesia только для приветствия
- STT в текущей версии — OpenAI Realtime через Voximplant SDK (ограниченный контроль)
