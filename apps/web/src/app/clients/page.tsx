"use client";

import { Building2, Plus, Users } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { NavBar } from "@/components/NavBar";
import { apiFetch } from "@/lib/api";

type TenantItem = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  agentsCount: number;
  numbersCount: number;
  createdAt: string;
};

export default function ClientsPage() {
  const [items, setItems] = useState<TenantItem[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const response = await apiFetch<{ items: TenantItem[] }>("/api/tenants");
    setItems(response.items);
  };

  useEffect(() => {
    void load();
  }, []);

  const createTenant = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);

    await apiFetch("/api/tenants", {
      method: "POST",
      body: {
        name,
        slug: slug || undefined,
      },
    });

    setName("");
    setSlug("");
    setMessage("Клиент добавлен");
    await load();
  };

  return (
    <AuthGuard>
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="page-header">
            <div>
              <p className="eyebrow">Tenants</p>
              <h1>Clients</h1>
              <p className="page-lede">
                Компании, номера и агенты, разложенные по отдельным аккаунтам.
              </p>
            </div>
            <span className="badge ok">
              <Users size={14} strokeWidth={2.5} />
              {items.length} clients
            </span>
          </div>

          <section className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-header">
              <h3>Новый клиент</h3>
              <Building2 size={17} strokeWidth={2.5} />
            </div>
            <div className="panel-body">
              <form onSubmit={createTenant} className="grid">
                <div>
                  <label>Name</label>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Clinic North"
                    required
                  />
                </div>
                <div>
                  <label>Slug</label>
                  <input
                    value={slug}
                    onChange={(event) => setSlug(event.target.value)}
                    placeholder="clinic-north"
                  />
                </div>
                <div className="row" style={{ alignSelf: "end" }}>
                  <button type="submit">
                    <Plus size={16} strokeWidth={2.6} />
                    Create
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
              <h3>Список клиентов</h3>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Slug</th>
                    <th>Status</th>
                    <th>Numbers</th>
                    <th>Agents</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((tenant) => (
                    <tr key={tenant.id}>
                      <td>
                        <strong>{tenant.name}</strong>
                      </td>
                      <td>{tenant.slug}</td>
                      <td>
                        <span className={`badge ${tenant.isActive ? "ok" : "danger"}`}>
                          <span className="status-dot" />
                          {tenant.isActive ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td>{tenant.numbersCount}</td>
                      <td>{tenant.agentsCount}</td>
                      <td>{new Date(tenant.createdAt).toLocaleString()}</td>
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
