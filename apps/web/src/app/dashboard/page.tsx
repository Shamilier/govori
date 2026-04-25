"use client";

import {
  Activity,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Clock3,
  PhoneCall,
  PlugZap,
  RadioTower,
} from "lucide-react";
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

type HealthResponse = {
  ok?: boolean;
  checks?: Record<string, { ok?: boolean; provider?: string }>;
};

function statusClass(status: string): string {
  if (status === "COMPLETED") return "ok";
  if (status === "FAILED") return "danger";
  return "warn";
}

export default function DashboardPage() {
  const [agent, setAgent] = useState<Record<string, unknown> | null>(null);
  const [integrations, setIntegrations] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);

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
        apiFetch<HealthResponse>("/api/integrations/health", {
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

  const completedCount = calls.filter((call) => call.status === "COMPLETED").length;
  const lastSuccessCall =
    calls.find((call) => call.status === "COMPLETED")?.startedAt ?? null;
  const healthChecks = Object.entries(health?.checks ?? {});

  return (
    <AuthGuard>
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="page-header">
            <div>
              <p className="eyebrow">Operations</p>
              <h1>Command Center</h1>
              <p className="page-lede">
                Пульс агентов, телефонии и последних разговоров.
              </p>
            </div>
            <span className={`badge ${health?.ok === false ? "danger" : "ok"}`}>
              <span className="status-dot" />
              {health?.ok === false ? "Degraded" : "Systems ready"}
            </span>
          </div>

          <section className="grid-tight" style={{ marginBottom: 14 }}>
            <div className="metric-card">
              <div className="metric-top">
                <div>
                  <div className="metric-label">Agent</div>
                  <div className="metric-value">
                    {agent?.isActive ? "Live" : "Off"}
                  </div>
                </div>
                <div className="icon-box">
                  <Bot size={20} strokeWidth={2.4} />
                </div>
              </div>
              <p className="metric-note">Voice: {String(agent?.ttsVoiceId ?? "-")}</p>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <div>
                  <div className="metric-label">Number</div>
                  <div className="metric-value" style={{ fontSize: 22 }}>
                    {String(integrations?.phoneNumberE164 ?? "-")}
                  </div>
                </div>
                <div className="icon-box">
                  <RadioTower size={20} strokeWidth={2.4} />
                </div>
              </div>
              <p className="metric-note">
                Provider: {String(integrations?.telephonyProvider ?? "-")}
              </p>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <div>
                  <div className="metric-label">Today</div>
                  <div className="metric-value">{todayCallsCount}</div>
                </div>
                <div className="icon-box">
                  <PhoneCall size={20} strokeWidth={2.4} />
                </div>
              </div>
              <p className="metric-note">{completedCount} completed in latest list</p>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <div>
                  <div className="metric-label">Last success</div>
                  <div className="metric-value" style={{ fontSize: 22 }}>
                    {lastSuccessCall
                      ? new Date(lastSuccessCall).toLocaleTimeString()
                      : "-"}
                  </div>
                </div>
                <div className="icon-box">
                  <Clock3 size={20} strokeWidth={2.4} />
                </div>
              </div>
              <p className="metric-note">
                {lastSuccessCall
                  ? new Date(lastSuccessCall).toLocaleDateString()
                  : "No completed calls yet"}
              </p>
            </div>
          </section>

          <div className="grid" style={{ alignItems: "start" }}>
            <section className="panel" style={{ gridColumn: "span 2" }}>
              <div className="panel-header">
                <h3>Recent calls</h3>
                <Link className="link-action" href="/calls">
                  Open calls <ArrowUpRight size={15} strokeWidth={2.5} />
                </Link>
              </div>
              <div className="table-wrap">
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
                    {calls.slice(0, 7).map((call) => (
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

            <section className="panel">
              <div className="panel-header">
                <h3>Provider health</h3>
                <PlugZap size={17} strokeWidth={2.5} />
              </div>
              <div className="panel-body stack">
                {healthChecks.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    Health check pending.
                  </p>
                ) : (
                  healthChecks.map(([name, check]) => (
                    <div className="metric-top" key={name}>
                      <div>
                        <strong>{name}</strong>
                        <p className="metric-note">
                          {check.provider ?? "provider"}
                        </p>
                      </div>
                      <span className={`badge ${check.ok === false ? "danger" : "ok"}`}>
                        {check.ok === false ? (
                          <Activity size={14} strokeWidth={2.5} />
                        ) : (
                          <CheckCircle2 size={14} strokeWidth={2.5} />
                        )}
                        {check.ok === false ? "Issue" : "OK"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
