"use client";

import { ArrowUpRight, Filter, PhoneCall } from "lucide-react";
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

function statusClass(status: string): string {
  if (status === "COMPLETED") return "ok";
  if (status === "FAILED") return "danger";
  return "warn";
}

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
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="page-header">
            <div>
              <p className="eyebrow">Conversation log</p>
              <h1>Calls</h1>
              <p className="page-lede">
                История разговоров, статусы, outcome и быстрый вход в карточку.
              </p>
            </div>
            <span className="badge">
              <PhoneCall size={14} strokeWidth={2.5} />
              {items.length} loaded
            </span>
          </div>

          <section className="panel toolbar">
            <div className="panel-header">
              <h3>Filters</h3>
              <Filter size={17} strokeWidth={2.5} />
            </div>
            <div className="panel-body">
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
                    placeholder="+7999..."
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
              <div className="row" style={{ marginTop: 12 }}>
                <button onClick={() => void load()} type="button">
                  <Filter size={16} strokeWidth={2.5} />
                  Apply filters
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>Call ledger</h3>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Caller</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Outcome</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((call) => (
                    <tr key={call.id}>
                      <td>{new Date(call.startedAt).toLocaleString()}</td>
                      <td>{call.callerPhone ?? "-"}</td>
                      <td>
                        <span className={`badge ${statusClass(call.status)}`}>
                          <span className="status-dot" />
                          {call.status}
                        </span>
                      </td>
                      <td>{call.durationSec ?? "-"}</td>
                      <td>{call.summary ?? "-"}</td>
                      <td>
                        <Link className="link-action" href={`/calls/${call.id}`}>
                          Open <ArrowUpRight size={15} strokeWidth={2.5} />
                        </Link>
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
