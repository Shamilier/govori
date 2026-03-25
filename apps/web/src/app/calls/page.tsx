"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { NavBar } from "@/components/NavBar";
import { apiFetch } from "@/lib/api";

type CallItem = {
  id: string;
  startedAt: string;
  callerPhone: string | null;
  status: string;
  durationSec: number | null;
  summary: string | null;
};

export default function CallsPage() {
  const [items, setItems] = useState<CallItem[]>([]);
  const [status, setStatus] = useState("");
  const [phone, setPhone] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = async () => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (phone) query.set("phone", phone);
    if (dateFrom) query.set("dateFrom", dateFrom);
    if (dateTo) query.set("dateTo", dateTo);
    const data = await apiFetch<{ items: CallItem[] }>(
      `/api/calls?${query.toString()}`,
    );
    setItems(data.items);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <AuthGuard>
      <NavBar />
      <main className="page">
        <h1>Calls</h1>

        <section className="card" style={{ marginBottom: 12 }}>
          <div className="grid">
            <div>
              <label>Status</label>
              <input
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                placeholder="COMPLETED"
              />
            </div>
            <div>
              <label>Phone</label>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+1..."
              />
            </div>
            <div>
              <label>Date from</label>
              <input
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                type="date"
              />
            </div>
            <div>
              <label>Date to</label>
              <input
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                type="date"
              />
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={() => void load()} type="button">
              Apply filters
            </button>
          </div>
        </section>

        <section className="card">
          <table>
            <thead>
              <tr>
                <th>started_at</th>
                <th>caller_phone</th>
                <th>status</th>
                <th>duration_sec</th>
                <th>outcome short</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((call) => (
                <tr key={call.id}>
                  <td>{new Date(call.startedAt).toLocaleString()}</td>
                  <td>{call.callerPhone ?? "-"}</td>
                  <td>{call.status}</td>
                  <td>{call.durationSec ?? "-"}</td>
                  <td>{call.summary ?? "-"}</td>
                  <td>
                    <Link href={`/calls/${call.id}`}>Open</Link>
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
