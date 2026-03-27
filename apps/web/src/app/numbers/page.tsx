"use client";

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
      <NavBar />
      <main className="page">
        <h1>Numbers</h1>

        <section className="card" style={{ marginBottom: 12 }}>
          <h3>Добавить номер клиента</h3>
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
              <label>Phone (E.164)</label>
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
            <div className="row" style={{ marginTop: 8 }}>
              <button type="submit">Add number</button>
            </div>
          </form>
          {message && <p style={{ color: "#166534" }}>{message}</p>}
        </section>

        <section className="card">
          <h3>Подключенные номера</h3>
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
                  <td>{item.e164}</td>
                  <td>{item.tenant.name}</td>
                  <td>{item.label ?? "-"}</td>
                  <td>{item.provider}</td>
                  <td>{item.agent?.name ?? "-"}</td>
                  <td>{item.isActive ? "ACTIVE" : "INACTIVE"}</td>
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void toggleActive(item)}
                    >
                      {item.isActive ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </AuthGuard>
  );
}
