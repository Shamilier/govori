"use client";

import { Power, Plus, RadioTower } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { NavBar } from "@/components/NavBar";
import { apiFetch } from "@/lib/api";

type TenantItem = {
  id: string;
  name: string;
  slug: string;
};

type PhoneNumberItem = {
  id: string;
  e164: string;
  label: string | null;
  provider: string;
  isActive: boolean;
  createdAt: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  agent: {
    id: string;
    name: string;
    isActive: boolean;
  } | null;
};

export default function NumbersPage() {
  const [items, setItems] = useState<PhoneNumberItem[]>([]);
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [e164, setE164] = useState("");
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState("voximplant");
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const [numbersResponse, tenantsResponse] = await Promise.all([
      apiFetch<{ items: PhoneNumberItem[] }>("/api/phone-numbers"),
      apiFetch<{ items: TenantItem[] }>("/api/tenants"),
    ]);

    setItems(numbersResponse.items);
    setTenants(tenantsResponse.items);

    if (!tenantId && tenantsResponse.items.length > 0) {
      setTenantId(tenantsResponse.items[0].id);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createNumber = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);

    await apiFetch("/api/phone-numbers", {
      method: "POST",
      body: {
        tenantId: tenantId || undefined,
        e164,
        label: label || undefined,
        provider,
      },
    });

    setE164("");
    setLabel("");
    setMessage("Номер добавлен");
    await load();
  };

  const toggleActive = async (item: PhoneNumberItem) => {
    await apiFetch(`/api/phone-numbers/${item.id}`, {
      method: "PUT",
      body: {
        isActive: !item.isActive,
      },
    });

    await load();
  };

  return (
    <AuthGuard>
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="page-header">
            <div>
              <p className="eyebrow">Telephony</p>
              <h1>Numbers</h1>
              <p className="page-lede">
                Voximplant номера, назначенные клиентам и голосовым агентам.
              </p>
            </div>
            <span className="badge ok">
              <RadioTower size={14} strokeWidth={2.5} />
              {items.filter((item) => item.isActive).length} active
            </span>
          </div>

          <section className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-header">
              <h3>Добавить номер клиента</h3>
              <RadioTower size={17} strokeWidth={2.5} />
            </div>
            <div className="panel-body">
              <form onSubmit={createNumber} className="grid">
                <div>
                  <label>Client</label>
                  <select
                    value={tenantId}
                    onChange={(event) => setTenantId(event.target.value)}
                    required
                  >
                    {tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.name} ({tenant.slug})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Phone E.164</label>
                  <input
                    value={e164}
                    onChange={(event) => setE164(event.target.value)}
                    placeholder="+79991234567"
                    required
                  />
                </div>
                <div>
                  <label>Label</label>
                  <input
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Main reception"
                  />
                </div>
                <div>
                  <label>Provider</label>
                  <input
                    value={provider}
                    onChange={(event) => setProvider(event.target.value)}
                  />
                </div>
                <div className="row" style={{ alignSelf: "end" }}>
                  <button type="submit">
                    <Plus size={16} strokeWidth={2.6} />
                    Add number
                  </button>
                </div>
              </form>
              {message && (
                <p className="message ok" style={{ marginTop: 12 }}>
                  {message}
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>Подключенные номера</h3>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>E.164</th>
                    <th>Client</th>
                    <th>Label</th>
                    <th>Provider</th>
                    <th>Agent</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.e164}</strong>
                      </td>
                      <td>{item.tenant.name}</td>
                      <td>{item.label ?? "-"}</td>
                      <td>{item.provider}</td>
                      <td>{item.agent?.name ?? "-"}</td>
                      <td>
                        <span className={`badge ${item.isActive ? "ok" : "danger"}`}>
                          <span className="status-dot" />
                          {item.isActive ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void toggleActive(item)}
                        >
                          <Power size={15} strokeWidth={2.5} />
                          {item.isActive ? "Disable" : "Enable"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </AuthGuard>
  );
}
