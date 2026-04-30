"use client";

import { CheckCircle2, KeyRound, PlugZap, Save, ServerCog } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { NavBar } from "@/components/NavBar";
import { apiFetch } from "@/lib/api";

const GLOBAL_SCOPE = "__global__";

type TenantItem = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
};

type IntegrationsForm = {
  telephonyProvider: string;
  phoneNumberE164: string;
  voximplantApplicationId: string;
  voximplantAccountId: string;
  voximplantApiKey: string;
  voximplantApiSecret: string;
  voximplantOutboundRuleId: string;
  ttsProvider: string;
  geminiApiKey: string;
  geminiLlmModel: string;
  geminiTtsModel: string;
  geminiTtsVoice: string;
  geminiSttModel: string;
  elevenlabsApiKey: string;
  elevenlabsVoiceId: string;
  elevenlabsModelId: string;
};

type IntegrationsResponse = Partial<IntegrationsForm> & {
  phoneNumberE164?: string | null;
};

const empty: IntegrationsForm = {
  telephonyProvider: "voximplant",
  phoneNumberE164: "",
  voximplantApplicationId: "",
  voximplantAccountId: "",
  voximplantApiKey: "",
  voximplantApiSecret: "",
  voximplantOutboundRuleId: "",
  ttsProvider: "elevenlabs",
  geminiApiKey: "",
  geminiLlmModel: "gemini-2.5-flash",
  geminiTtsModel: "gemini-2.5-flash-preview-tts",
  geminiTtsVoice: "Kore",
  geminiSttModel: "gemini-2.5-flash",
  elevenlabsApiKey: "",
  elevenlabsVoiceId: "JBFqnCBsd6RMkjVDRZzb",
  elevenlabsModelId: "eleven_flash_v2_5",
};

export default function IntegrationsPage() {
  const [form, setForm] = useState<IntegrationsForm>(empty);
  const [scopeId, setScopeId] = useState<string>(GLOBAL_SCOPE);
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const currentTenant = tenants.find((tenant) => tenant.id === scopeId) ?? null;
  const isGlobalScope = scopeId === GLOBAL_SCOPE;

  const pathByScope = (scope: string): string =>
    scope === GLOBAL_SCOPE
      ? "/api/integrations"
      : `/api/tenants/${scope}/integrations`;

  const normalizeForm = (payload: IntegrationsResponse): IntegrationsForm => ({
    ...empty,
    ...payload,
    phoneNumberE164: payload.phoneNumberE164 ?? "",
  });

  const loadIntegrations = async (scope: string) => {
    setIsLoading(true);
    try {
      const data = await apiFetch<IntegrationsResponse>(pathByScope(scope));
      setForm(normalizeForm(data));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      const tenantsData = await apiFetch<{ items: TenantItem[] }>("/api/tenants");
      setTenants(tenantsData.items);
      await loadIntegrations(GLOBAL_SCOPE);
    };
    void load();
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    await apiFetch(pathByScope(scopeId), {
      method: "PUT",
      body: form,
    });
    setMessage(
      isGlobalScope
        ? "Глобальные интеграции сохранены"
        : "Интеграции клиента сохранены",
    );
  };

  const check = async () => {
    const data = await apiFetch<Record<string, unknown>>(
      "/api/integrations/health",
      {
        method: "POST",
        body: {},
      },
    );
    setHealth(data);
  };

  const handleScopeChange = async (nextScopeId: string) => {
    setScopeId(nextScopeId);
    setMessage(null);
    setHealth(null);
    await loadIntegrations(nextScopeId);
  };

  return (
    <AuthGuard>
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="page-header">
            <div>
              <p className="eyebrow">Provider matrix</p>
              <h1>Integrations</h1>
              <p className="page-lede">
                Глобальные fallback-настройки и персональные ключи клиентов.
              </p>
            </div>
            <span className="badge">
              <PlugZap size={14} strokeWidth={2.5} />
              {isGlobalScope ? "Global" : currentTenant?.slug ?? "Tenant"}
            </span>
          </div>

          <section className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-header">
              <h3>Область настроек</h3>
              <ServerCog size={17} strokeWidth={2.5} />
            </div>
            <div className="panel-body field-stack">
              <div>
                <label>Куда сохранять параметры</label>
                <select
                  value={scopeId}
                  onChange={(event) => void handleScopeChange(event.target.value)}
                >
                  <option value={GLOBAL_SCOPE}>Global defaults</option>
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name} ({tenant.slug})
                      {tenant.isActive ? "" : " [inactive]"}
                    </option>
                  ))}
                </select>
              </div>
              {isLoading && <p className="message">Загрузка настроек</p>}
            </div>
          </section>

          <form onSubmit={save} className="stack">
            <div className="grid" style={{ alignItems: "start" }}>
              <section className="panel">
                <div className="panel-header">
                  <h3>Telephony</h3>
                  <ServerCog size={17} strokeWidth={2.5} />
                </div>
                <div className="panel-body field-stack">
                  <div>
                    <label>Provider</label>
                    <input
                      value={form.telephonyProvider}
                      onChange={(event) =>
                        setForm({ ...form, telephonyProvider: event.target.value })
                      }
                    />
                  </div>
                  {isGlobalScope ? (
                    <div>
                      <label>Fallback phone number E.164</label>
                      <input
                        value={form.phoneNumberE164}
                        onChange={(event) =>
                          setForm({ ...form, phoneNumberE164: event.target.value })
                        }
                      />
                    </div>
                  ) : (
                    <div>
                      <label>Active client number</label>
                      <input value={form.phoneNumberE164 || "-"} disabled />
                    </div>
                  )}
                  <div className="grid-tight">
                    <div>
                      <label>Application ID</label>
                      <input
                        value={form.voximplantApplicationId}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            voximplantApplicationId: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label>Account ID</label>
                      <input
                        value={form.voximplantAccountId}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            voximplantAccountId: event.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label>Outbound rule id</label>
                    <input
                      value={form.voximplantOutboundRuleId}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          voximplantOutboundRuleId: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label>Voximplant API key</label>
                    <input
                      value={form.voximplantApiKey}
                      onChange={(event) =>
                        setForm({ ...form, voximplantApiKey: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label>Voximplant API secret</label>
                    <input
                      value={form.voximplantApiSecret}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          voximplantApiSecret: event.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <h3>AI providers</h3>
                  <KeyRound size={17} strokeWidth={2.5} />
                </div>
                <div className="panel-body field-stack">
                  <div>
                    <label>TTS provider</label>
                    <input
                      value={form.ttsProvider}
                      onChange={(event) =>
                        setForm({ ...form, ttsProvider: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label>Gemini API key</label>
                    <input
                      value={form.geminiApiKey}
                      onChange={(event) =>
                        setForm({ ...form, geminiApiKey: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label>Gemini LLM model</label>
                    <input
                      value={form.geminiLlmModel}
                      onChange={(event) =>
                        setForm({ ...form, geminiLlmModel: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label>Gemini TTS model</label>
                    <input
                      value={form.geminiTtsModel}
                      onChange={(event) =>
                        setForm({ ...form, geminiTtsModel: event.target.value })
                      }
                    />
                  </div>
                  <div className="grid-tight">
                    <div>
                      <label>Gemini voice</label>
                      <input
                        value={form.geminiTtsVoice}
                        onChange={(event) =>
                          setForm({ ...form, geminiTtsVoice: event.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label>Gemini STT model</label>
                      <input
                        value={form.geminiSttModel}
                        onChange={(event) =>
                          setForm({ ...form, geminiSttModel: event.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label>ElevenLabs API key</label>
                    <input
                      value={form.elevenlabsApiKey}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          elevenlabsApiKey: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="grid-tight">
                    <div>
                      <label>ElevenLabs voice ID</label>
                      <input
                        value={form.elevenlabsVoiceId}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            elevenlabsVoiceId: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label>ElevenLabs model</label>
                      <input
                        value={form.elevenlabsModelId}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            elevenlabsModelId: event.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <section className="panel">
              <div className="panel-body form-footer">
                <div className="row">
                  <button type="submit">
                    <Save size={16} strokeWidth={2.5} />
                    Save
                  </button>
                  {isGlobalScope && (
                    <button type="button" className="secondary" onClick={check}>
                      <CheckCircle2 size={16} strokeWidth={2.5} />
                      Check connection
                    </button>
                  )}
                </div>
                {message && <p className="message ok">{message}</p>}
              </div>
              {health && (
                <div className="panel-body" style={{ borderTop: "1px solid var(--border)" }}>
                  <pre>{JSON.stringify(health, null, 2)}</pre>
                </div>
              )}
            </section>
          </form>
        </main>
      </div>
    </AuthGuard>
  );
}
