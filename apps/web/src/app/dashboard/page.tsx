"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { NavBar } from "@/components/NavBar";
import { apiFetch } from "@/lib/api";

type CallItem = {
  id: string;
  callerPhone: string | null;
  status: string;
  startedAt: string;
  durationSec: number | null;
  summary: string | null;
};

export default function DashboardPage() {
  const [agent, setAgent] = useState<Record<string, unknown> | null>(null);
  const [integrations, setIntegrations] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const load = async () => {
      const [
        agentResponse,
        integrationsResponse,
        callsResponse,
        healthResponse,
      ] = await Promise.all([
        apiFetch<Record<string, unknown>>("/api/agent"),
        apiFetch<Record<string, unknown>>("/api/integrations"),
        apiFetch<{ items: CallItem[] }>("/api/calls?limit=10"),
        apiFetch<Record<string, unknown>>("/api/integrations/health", {
          method: "POST",
          body: {},
        }),
      ]);

      setAgent(agentResponse);
      setIntegrations(integrationsResponse);
      setCalls(callsResponse.items);
      setHealth(healthResponse);
    };

    void load();
  }, []);

  const todayCallsCount = useMemo(() => {
    const today = new Date().toDateString();
    return calls.filter(
      (call) => new Date(call.startedAt).toDateString() === today,
    ).length;
  }, [calls]);

  const lastSuccessCall = useMemo(
    () => calls.find((call) => call.status === "COMPLETED")?.startedAt ?? null,
    [calls],
  );

  return (
    <AuthGuard>
      <NavBar />
      <main className="page">
        <h1>Dashboard</h1>
        <div className="grid">
          <section className="card">
            <h3>Agent status</h3>
            <p>
              <span
                className="status-dot"
                style={{ background: agent?.isActive ? "#16a34a" : "#b91c1c" }}
              />
              {String(agent?.isActive ? "Active" : "Inactive")}
            </p>
            <p>Voice: {String(agent?.ttsVoiceId ?? "-")}</p>
          </section>
          <section className="card">
            <h3>Connected number</h3>
            <p>{String(integrations?.phoneNumberE164 ?? "-")}</p>
            <p>Provider: {String(integrations?.telephonyProvider ?? "-")}</p>
          </section>
          <section className="card">
            <h3>Calls today</h3>
            <p style={{ fontSize: 28, margin: 0 }}>{todayCallsCount}</p>
          </section>
          <section className="card">
            <h3>Last successful call</h3>
            <p>
              {lastSuccessCall
                ? new Date(lastSuccessCall).toLocaleString()
                : "No completed calls yet"}
            </p>
          </section>
        </div>

        <section className="card" style={{ marginTop: 14 }}>
          <h3>Integration health</h3>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(health, null, 2)}
          </pre>
        </section>

        <section className="card" style={{ marginTop: 14 }}>
          <h3>Recent calls</h3>
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Caller</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Summary</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {calls.slice(0, 5).map((call) => (
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
