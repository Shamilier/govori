export type CrmTemplateField = {
  key: string;
  label: string;
  required: boolean;
  secret?: boolean;
  placeholder?: string;
};

export type CrmTemplate = {
  provider: "custom_webhook" | "amocrm" | "bitrix24" | "hubspot";
  name: string;
  description: string;
  fields: CrmTemplateField[];
  defaultMapping: Record<string, unknown>;
};

export const CRM_TEMPLATES: CrmTemplate[] = [
  {
    provider: "custom_webhook",
    name: "Custom webhook",
    description: "Generic HTTP webhook for call results and callback requests.",
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        required: true,
        placeholder: "https://example.com/govori/webhook",
      },
      {
        key: "secret",
        label: "Signing secret",
        required: false,
        secret: true,
      },
    ],
    defaultMapping: {
      onCallCompleted: {
        method: "POST",
        payload: {
          event: "call.completed",
          callerPhone: "{{call.callerPhone}}",
          calleePhone: "{{call.calleePhone}}",
          summary: "{{outcome.summary}}",
          transcript: "{{call.transcriptText}}",
          callbackRequested: "{{outcome.callback_requested}}",
        },
      },
    },
  },
  {
    provider: "amocrm",
    name: "amoCRM",
    description: "Create or update contact, lead, and note from call outcome.",
    fields: [
      {
        key: "baseUrl",
        label: "Account URL",
        required: true,
        placeholder: "https://example.amocrm.ru",
      },
      { key: "accessToken", label: "Access token", required: true, secret: true },
      { key: "pipelineId", label: "Pipeline ID", required: false },
      { key: "statusId", label: "Status ID", required: false },
    ],
    defaultMapping: {
      contact: {
        name: "{{outcome.caller_name || call.callerPhone}}",
        phone: "{{call.callerPhone}}",
      },
      lead: {
        name: "GovorI: {{outcome.intent || 'call'}}",
        price: 0,
      },
      note: "{{outcome.summary}}\n\n{{call.transcriptText}}",
    },
  },
  {
    provider: "bitrix24",
    name: "Bitrix24",
    description: "Create lead and timeline comment through Bitrix24 webhook.",
    fields: [
      {
        key: "webhookBaseUrl",
        label: "Inbound webhook URL",
        required: true,
        secret: true,
        placeholder: "https://example.bitrix24.ru/rest/1/token",
      },
      { key: "assignedById", label: "Assigned user ID", required: false },
    ],
    defaultMapping: {
      lead: {
        TITLE: "GovorI call from {{call.callerPhone}}",
        PHONE: [{ VALUE: "{{call.callerPhone}}", VALUE_TYPE: "WORK" }],
        COMMENTS: "{{outcome.summary}}\n\n{{call.transcriptText}}",
      },
    },
  },
  {
    provider: "hubspot",
    name: "HubSpot",
    description: "Create contact and call engagement through HubSpot API.",
    fields: [
      { key: "accessToken", label: "Private app token", required: true, secret: true },
      { key: "ownerId", label: "Owner ID", required: false },
    ],
    defaultMapping: {
      contact: {
        phone: "{{call.callerPhone}}",
        firstname: "{{outcome.caller_name}}",
      },
      call: {
        hs_call_title: "GovorI call",
        hs_call_body: "{{outcome.summary}}\n\n{{call.transcriptText}}",
      },
    },
  },
];
