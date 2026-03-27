"use client";

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
  cartesiaApiKey: string;
  cartesiaVoiceId: string;
  cartesiaModelId: string;
  llmApiKey: string;
  llmModel: string;
  sttApiKey: string;
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
  cartesiaApiKey: "",
  cartesiaVoiceId: "",
  cartesiaModelId: "",
  llmApiKey: "",
  llmModel: "",
  sttApiKey: "",
};

export default function IntegrationsPage() {
  const [form, setForm] = useState<IntegrationsForm>(empty);
  const [scopeId, setScopeId] = useState<string>(GLOBAL_SCOPE);
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const currentTenant = tenants.find((tenant) => tenant.id === scopeId) ?? null;

  const pathByScope = (scope: string): string =>
    scope === GLOBAL_SCOPE ? "/api/integrations" : `/api/tenants/${scope}/integrations`;

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
      scopeId === GLOBAL_SCOPE
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

  const isGlobalScope = scopeId === GLOBAL_SCOPE;

  return (
    <AuthGuard>
      <NavBar />
      <main className="page">
        <h1>Integrations</h1>
        <section className="card" style={{ marginBottom: 12 }}>
          <h3>Область настроек</h3>
          <label>Куда сохранять параметры</label>
          <select
            value={scopeId}
            onChange={(event) => void handleScopeChange(event.target.value)}
          >
            <option value={GLOBAL_SCOPE}>Global defaults (fallback)</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name} ({tenant.slug}){tenant.isActive ? "" : " [inactive]"}
              </option>
            ))}
          </select>
          <p style={{ marginTop: 8, opacity: 0.8 }}>
            {isGlobalScope
              ? "Эти ключи используются как fallback для клиентов без персональных настроек."
              : `Редактируются настройки клиента ${currentTenant?.name ?? scopeId}.`}
          </p>
          {isLoading && <p style={{ marginTop: 6 }}>Загрузка настроек...</p>}
        </section>

        <form onSubmit={save} className="grid">
          <section className="card">
            <h3>Telephony</h3>
            <label>Provider</label>
            <input
              value={form.telephonyProvider}
              onChange={(event) =>
                setForm({ ...form, telephonyProvider: event.target.value })
              }
            />
            {isGlobalScope ? (
              <>
                <label>Fallback phone number E.164</label>
                <input
                  value={form.phoneNumberE164}
                  onChange={(event) =>
                    setForm({ ...form, phoneNumberE164: event.target.value })
                  }
                />
              </>
            ) : (
              <>
                <label>Active client number</label>
                <input value={form.phoneNumberE164 || "—"} disabled />
                <p style={{ marginTop: 4, opacity: 0.8 }}>
                  Номер назначается в разделе Numbers.
                </p>
              </>
            )}
            <label>Voximplant application id</label>
            <input
              value={form.voximplantApplicationId}
              onChange={(event) =>
                setForm({
                  ...form,
                  voximplantApplicationId: event.target.value,
                })
              }
            />
            <label>Voximplant account id</label>
            <input
              value={form.voximplantAccountId}
              onChange={(event) =>
                setForm({ ...form, voximplantAccountId: event.target.value })
              }
            />
            <label>Voximplant API key</label>
            <input
              value={form.voximplantApiKey}
              onChange={(event) =>
                setForm({ ...form, voximplantApiKey: event.target.value })
              }
            />
            <label>Voximplant API secret</label>
            <input
              value={form.voximplantApiSecret}
              onChange={(event) =>
                setForm({ ...form, voximplantApiSecret: event.target.value })
              }
            />
          </section>

          <section className="card">
            <h3>AI providers</h3>
            <label>Cartesia API key</label>
            <input
              value={form.cartesiaApiKey}
              onChange={(event) =>
                setForm({ ...form, cartesiaApiKey: event.target.value })
              }
            />
            <label>Cartesia voice id</label>
            <input
              value={form.cartesiaVoiceId}
              onChange={(event) =>
                setForm({ ...form, cartesiaVoiceId: event.target.value })
              }
            />
            <label>Cartesia model id</label>
            <input
              value={form.cartesiaModelId}
              onChange={(event) =>
                setForm({ ...form, cartesiaModelId: event.target.value })
              }
            />
            <label>LLM API key</label>
            <input
              value={form.llmApiKey}
              onChange={(event) =>
                setForm({ ...form, llmApiKey: event.target.value })
              }
            />
            <label>LLM model</label>
            <input
              value={form.llmModel}
              onChange={(event) =>
                setForm({ ...form, llmModel: event.target.value })
              }
            />
            <label>STT API key</label>
            <input
              value={form.sttApiKey}
              onChange={(event) =>
                setForm({ ...form, sttApiKey: event.target.value })
              }
            />
          </section>

          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="row">
              <button type="submit">Save</button>
              {isGlobalScope && (
                <button type="button" className="secondary" onClick={check}>
                  Check connection
                </button>
              )}
            </div>
            {message && <p style={{ color: "#166534" }}>{message}</p>}
            {health && (
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(health, null, 2)}
              </pre>
            )}
          </section>
        </form>
      </main>
    </AuthGuard>
  );
}
