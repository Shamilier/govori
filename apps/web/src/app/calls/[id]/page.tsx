"use client";

import { FileJson, Mic2, PhoneCall, Route, ScrollText } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { NavBar } from "@/components/NavBar";
import { apiFetch } from "@/lib/api";

type CallDetails = {
  id: string;
  externalCallId: string;
  status: string;
  callerPhone: string | null;
  calleePhone: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  recordingUrl: string | null;
  outcome: unknown;
  errorMessage: string | null;
  systemPromptSnapshot: string | null;
  timeline: Array<{
    id: string;
    eventType: string;
    createdAt: string;
    payload: unknown;
  }>;
  transcript: Array<{
    id: string;
    role: string;
    text: string;
    createdAt: string;
  }>;
};

function statusClass(status: string): string {
  if (status === "COMPLETED") return "ok";
  if (status === "FAILED") return "danger";
  return "warn";
}

export default function CallDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<CallDetails | null>(null);

  useEffect(() => {
    const load = async () => {
      const details = await apiFetch<CallDetails>(`/api/calls/${id}`);
      setData(details);
    };

    if (id) {
      void load();
    }
  }, [id]);

  if (!data) {
    return (
      <AuthGuard>
        <div className="app-shell">
          <NavBar />
          <main className="page">
            <div className="loading">Loading call</div>
          </main>
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="page-header">
            <div>
              <p className="eyebrow">Call detail</p>
              <h1>{data.callerPhone ?? "Unknown caller"}</h1>
              <p className="page-lede">External ID: {data.externalCallId}</p>
            </div>
            <span className={`badge ${statusClass(data.status)}`}>
              <span className="status-dot" />
              {data.status}
            </span>
          </div>

          <section className="grid-tight" style={{ marginBottom: 14 }}>
            <div className="metric-card">
              <div className="metric-top">
                <div>
                  <div className="metric-label">Caller</div>
                  <div className="metric-value" style={{ fontSize: 22 }}>
                    {data.callerPhone ?? "-"}
                  </div>
                </div>
                <div className="icon-box">
                  <PhoneCall size={20} strokeWidth={2.4} />
                </div>
              </div>
              <p className="metric-note">Callee: {data.calleePhone ?? "-"}</p>
            </div>
            <div className="metric-card">
              <div>
                <div className="metric-label">Started</div>
                <div className="metric-value" style={{ fontSize: 22 }}>
                  {new Date(data.startedAt).toLocaleTimeString()}
                </div>
              </div>
              <p className="metric-note">
                {new Date(data.startedAt).toLocaleDateString()}
              </p>
            </div>
            <div className="metric-card">
              <div>
                <div className="metric-label">Duration</div>
                <div className="metric-value">
                  {data.durationSec ?? "-"}
                  <span style={{ fontSize: 16 }}> sec</span>
                </div>
              </div>
              <p className="metric-note">Error: {data.errorMessage ?? "-"}</p>
            </div>
          </section>

          {data.recordingUrl && (
            <section className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-header">
                <h3>Recording</h3>
                <Mic2 size={17} strokeWidth={2.5} />
              </div>
              <div className="panel-body">
                <audio controls src={data.recordingUrl} style={{ width: "100%" }} />
              </div>
            </section>
          )}

          <div className="grid" style={{ alignItems: "start" }}>
            <section className="panel">
              <div className="panel-header">
                <h3>Transcript</h3>
                <ScrollText size={17} strokeWidth={2.5} />
              </div>
              <div className="panel-body transcript-list">
                {data.transcript.map((item) => (
                  <div
                    key={item.id}
                    className={`transcript-item ${item.role.toLowerCase()}`}
                  >
                    <div className="metric-top">
                      <strong>{item.role}</strong>
                      <span className="muted">
                        {new Date(item.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p style={{ margin: "8px 0 0" }}>{item.text}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h3>Timeline</h3>
                <Route size={17} strokeWidth={2.5} />
              </div>
              <div className="panel-body timeline-list">
                {data.timeline.map((item) => (
                  <div key={item.id} className="timeline-item">
                    <div>
                      <strong>{new Date(item.createdAt).toLocaleTimeString()}</strong>
                      <p className="metric-note">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div>
                      <strong>{item.eventType}</strong>
                      <pre>{JSON.stringify(item.payload, null, 2)}</pre>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="panel" style={{ marginTop: 14 }}>
            <div className="panel-header">
              <h3>Outcome JSON</h3>
              <FileJson size={17} strokeWidth={2.5} />
            </div>
            <div className="panel-body">
              <pre>{JSON.stringify(data.outcome, null, 2)}</pre>
            </div>
          </section>

          <section className="panel" style={{ marginTop: 14 }}>
            <div className="panel-header">
              <h3>System Prompt Snapshot</h3>
            </div>
            <div className="panel-body">
              <pre>{data.systemPromptSnapshot ?? "-"}</pre>
            </div>
          </section>
        </main>
      </div>
    </AuthGuard>
  );
}
