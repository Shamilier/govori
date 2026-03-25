"use client";

import { FormEvent, useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { NavBar } from "@/components/NavBar";
import { apiFetch } from "@/lib/api";

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
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const data =
        await apiFetch<Partial<IntegrationsForm>>("/api/integrations");
      setForm({ ...empty, ...data });
    };
    void load();
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    await apiFetch("/api/integrations", {
      method: "PUT",
      body: form,
    });
    setMessage("Сохранено");
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

  return (
    <AuthGuard>
      <NavBar />
      <main className="page">
        <h1>Integrations</h1>
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
            <label>Phone number E.164</label>
            <input
              value={form.phoneNumberE164}
              onChange={(event) =>
                setForm({ ...form, phoneNumberE164: event.target.value })
              }
            />
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
              <button type="button" className="secondary" onClick={check}>
                Check connection
              </button>
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
