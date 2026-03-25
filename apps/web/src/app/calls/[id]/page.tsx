"use client";

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
        <NavBar />
        <main className="page">Loading...</main>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <NavBar />
      <main className="page">
        <h1>Call Details</h1>

        <section className="card">
          <h3>Meta</h3>
          <p>Call ID: {data.externalCallId}</p>
          <p>Status: {data.status}</p>
          <p>Caller: {data.callerPhone ?? "-"}</p>
          <p>Callee: {data.calleePhone ?? "-"}</p>
          <p>Started: {new Date(data.startedAt).toLocaleString()}</p>
          <p>
            Ended:{" "}
            {data.endedAt ? new Date(data.endedAt).toLocaleString() : "-"}
          </p>
          <p>Duration: {data.durationSec ?? "-"}</p>
          <p>Error: {data.errorMessage ?? "-"}</p>
        </section>

        {data.recordingUrl && (
          <section className="card" style={{ marginTop: 12 }}>
            <h3>Recording</h3>
            <audio controls src={data.recordingUrl} style={{ width: "100%" }} />
          </section>
        )}

        <section className="card" style={{ marginTop: 12 }}>
          <h3>Timeline</h3>
          <table>
            <thead>
              <tr>
                <th>time</th>
                <th>event</th>
                <th>payload</th>
              </tr>
            </thead>
            <tbody>
              {data.timeline.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>{item.eventType}</td>
                  <td>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(item.payload, null, 2)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card" style={{ marginTop: 12 }}>
          <h3>Transcript</h3>
          {data.transcript.map((item) => (
            <div key={item.id} className="card" style={{ marginBottom: 8 }}>
              <strong>{item.role}</strong>
              <p style={{ margin: "6px 0 0 0" }}>{item.text}</p>
            </div>
          ))}
        </section>

        <section className="card" style={{ marginTop: 12 }}>
          <h3>Outcome JSON</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(data.outcome, null, 2)}
          </pre>
        </section>

        <section className="card" style={{ marginTop: 12 }}>
          <h3>System Prompt Snapshot</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {data.systemPromptSnapshot ?? "-"}
          </pre>
        </section>
      </main>
    </AuthGuard>
  );
}
