"use client";

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
      <NavBar />
      <main className="page">
        <h1>Clients</h1>

        <section className="card" style={{ marginBottom: 12 }}>
          <h3>Новый клиент</h3>
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
              <label>Slug (optional)</label>
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="clinic-north"
              />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="submit">Create client</button>
            </div>
          </form>
          {message && <p style={{ color: "#166534" }}>{message}</p>}
        </section>

        <section className="card">
          <h3>Список клиентов</h3>
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
                  <td>{tenant.name}</td>
                  <td>{tenant.slug}</td>
                  <td>{tenant.isActive ? "ACTIVE" : "INACTIVE"}</td>
                  <td>{tenant.numbersCount}</td>
                  <td>{tenant.agentsCount}</td>
                  <td>{new Date(tenant.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </AuthGuard>
  );
}
