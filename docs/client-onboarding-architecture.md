# Client onboarding and outbound scaling

## Goal

New GovorI clients should not need web-admin access for daily work. The internal team provisions a tenant once, connects a Voximplant number and prompt, gives the client a Telegram access code, and the client runs outbound calls from the Telegram bot.

## Core entities

- `Tenant`: one client account.
- `Agent`: the client's voice agent prompt, voice, greeting, fallback, limits.
- `PhoneNumber`: a Voximplant E.164 number assigned to a tenant and agent. The phone number is also the assistant id used by Voximplant scripts.
- `TenantIntegrationSettings`: tenant-specific provider settings. Global integrations remain the fallback.
- `TenantCrmIntegration`: tenant CRM provider, connection config, and mapping template.
- `TenantAccessCode`: one-time or limited-use Telegram binding code for the client.
- `TelegramBinding`: Telegram user to tenant and optional agent binding.
- `Call`: inbound or outbound call history with transcript, events, outcome, and recording.

## Provisioning flow

1. Internal team buys or assigns a Voximplant number.
2. Internal team creates or reuses a Voximplant outbound rule/scenario.
3. Internal team calls `POST /api/onboarding/clients` with:
   - client name and phone number,
   - system prompt,
   - optional Gemini/Voximplant tenant overrides,
   - optional CRM template config,
   - optional Telegram access-code settings.
4. Backend creates:
   - tenant,
   - default active agent,
   - phone number bound to agent,
   - tenant integrations,
   - CRM config if provided,
   - Telegram access code.
5. Internal team sends the access code to the client.
6. Client opens Telegram bot, runs `/start`, enters the code, then uses `/menu` or `/campaign`.

## Onboarding endpoint

`POST /api/onboarding/clients`

Protected by admin auth and CSRF.

Minimal payload:

```json
{
  "name": "Clinic North",
  "phoneNumberE164": "+79990001122",
  "systemPrompt": "Ты голосовой агент клиники. Отвечай кратко и записывай клиента на прием.",
  "voximplant": {
    "outboundRuleId": "12345"
  }
}
```

The response contains tenant, agent, phone number, Telegram access code, and setup checklist.

## Outbound call routing

Telegram campaign start resolves:

1. `TelegramBinding` -> tenant.
2. Tenant active `PhoneNumber` -> caller id and assistant id.
3. Tenant `TenantIntegrationSettings.voximplant.outboundRuleId` -> outbound rule.
4. Global `VOXIMPLANT_OUTBOUND_RULE_ID` only as fallback.

Voximplant outbound script sends `direction: "outbound"` in logs. Backend stores calls as `OUTBOUND`.

## CRM module

The first CRM layer is template-based:

- `GET /api/crm/templates` returns built-in templates.
- `GET /api/tenants/:tenantId/crm` returns tenant CRM config.
- `PUT /api/tenants/:tenantId/crm` saves provider config and mapping.

Built-in providers:

- `custom_webhook`
- `amocrm`
- `bitrix24`
- `hubspot`

Next step is a CRM executor that reacts to `call.finalized` and pushes mapped call outcomes into the configured CRM.

## Next implementation steps

1. Add persistent outbound campaigns and recipients for retries, status, and client-visible history.
2. Add CRM executor with provider adapters and delivery retry queue.
3. Add admin UI for `POST /api/onboarding/clients` and tenant CRM config.
4. Add Telegram campaign history and status commands.
5. Add per-tenant usage limits and billing counters.
