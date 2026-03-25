"use client";

import { FormEvent, useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { NavBar } from "@/components/NavBar";
import { API_URL, apiFetch, getCsrfToken } from "@/lib/api";

const empty = {
  name: "",
  systemPrompt: "",
  greetingText: "",
  fallbackText: "",
  goodbyeText: "",
  language: "ru-RU",
  isActive: true,
  interruptionEnabled: true,
  silenceTimeoutMs: 7000,
  maxCallDurationSec: 300,
  maxTurns: 20,
  responseTemperature: 0.3,
  responseMaxTokens: 250,
  ttsProvider: "cartesia",
  ttsVoiceId: "default",
  ttsSpeed: 1,
  ttsSampleRate: 8000,
  sttProvider: "mock",
  llmProvider: "openai",
  recordCalls: true,
  ttsTestPhrase: "Это тест голоса агента",
};

export default function AgentPage() {
  const [form, setForm] = useState(empty);
  const [message, setMessage] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [promptInput, setPromptInput] = useState(
    "Здравствуйте, мне нужна консультация",
  );
  const [promptOutput, setPromptOutput] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const data = await apiFetch<typeof empty>("/api/agent");
      setForm(data);
    };

    void load();
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    await apiFetch("/api/agent", {
      method: "PUT",
      body: form,
    });
    setMessage("Сохранено");
  };

  const testTts = async () => {
    const response = await fetch(`${API_URL}/api/agent/test-tts`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": getCsrfToken() ?? "",
      },
      body: JSON.stringify({ text: form.ttsTestPhrase }),
    });

    if (!response.ok) {
      setMessage("Ошибка теста TTS");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    setAudioUrl(url);

    const audio = new Audio(url);
    await audio.play();
  };

  const testPrompt = async () => {
    const result = await apiFetch<{ assistantText: string }>(
      "/api/agent/test-prompt",
      {
        method: "POST",
        body: { text: promptInput },
      },
    );
    setPromptOutput(result.assistantText);
  };

  return (
    <AuthGuard>
      <NavBar />
      <main className="page">
        <h1>Agent Settings</h1>
        <form onSubmit={save} className="grid">
          <section className="card">
            <h3>Основное</h3>
            <label>Name</label>
            <input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              required
            />
            <label style={{ marginTop: 10 }}>Language</label>
            <input
              value={form.language}
              onChange={(event) =>
                setForm({ ...form, language: event.target.value })
              }
              required
            />
            <div className="row" style={{ marginTop: 10 }}>
              <label>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) =>
                    setForm({ ...form, isActive: event.target.checked })
                  }
                />{" "}
                Active
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.recordCalls}
                  onChange={(event) =>
                    setForm({ ...form, recordCalls: event.target.checked })
                  }
                />{" "}
                Record calls
              </label>
            </div>
          </section>

          <section className="card">
            <h3>Промпт</h3>
            <label>System prompt</label>
            <textarea
              value={form.systemPrompt}
              onChange={(event) =>
                setForm({ ...form, systemPrompt: event.target.value })
              }
            />
            <label>Greeting</label>
            <input
              value={form.greetingText}
              onChange={(event) =>
                setForm({ ...form, greetingText: event.target.value })
              }
            />
            <label>Fallback</label>
            <input
              value={form.fallbackText}
              onChange={(event) =>
                setForm({ ...form, fallbackText: event.target.value })
              }
            />
            <label>Goodbye</label>
            <input
              value={form.goodbyeText}
              onChange={(event) =>
                setForm({ ...form, goodbyeText: event.target.value })
              }
            />
          </section>

          <section className="card">
            <h3>Голос</h3>
            <label>Voice ID</label>
            <input
              value={form.ttsVoiceId}
              onChange={(event) =>
                setForm({ ...form, ttsVoiceId: event.target.value })
              }
            />
            <label>Speed</label>
            <input
              type="number"
              step="0.1"
              value={form.ttsSpeed}
              onChange={(event) =>
                setForm({ ...form, ttsSpeed: Number(event.target.value) })
              }
            />
            <label>Sample rate</label>
            <input
              type="number"
              value={form.ttsSampleRate}
              onChange={(event) =>
                setForm({ ...form, ttsSampleRate: Number(event.target.value) })
              }
            />
            <label>Test phrase</label>
            <input
              value={form.ttsTestPhrase}
              onChange={(event) =>
                setForm({ ...form, ttsTestPhrase: event.target.value })
              }
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" onClick={testTts}>
                Test TTS
              </button>
            </div>
            {audioUrl && (
              <audio
                controls
                src={audioUrl}
                style={{ width: "100%", marginTop: 8 }}
              />
            )}
          </section>

          <section className="card">
            <h3>Поведение</h3>
            <label>Silence timeout (ms)</label>
            <input
              type="number"
              value={form.silenceTimeoutMs}
              onChange={(event) =>
                setForm({
                  ...form,
                  silenceTimeoutMs: Number(event.target.value),
                })
              }
            />
            <label>Max duration (sec)</label>
            <input
              type="number"
              value={form.maxCallDurationSec}
              onChange={(event) =>
                setForm({
                  ...form,
                  maxCallDurationSec: Number(event.target.value),
                })
              }
            />
            <label>Max turns</label>
            <input
              type="number"
              value={form.maxTurns}
              onChange={(event) =>
                setForm({ ...form, maxTurns: Number(event.target.value) })
              }
            />
            <label>Temperature</label>
            <input
              type="number"
              step="0.1"
              value={form.responseTemperature}
              onChange={(event) =>
                setForm({
                  ...form,
                  responseTemperature: Number(event.target.value),
                })
              }
            />
            <label>Response max tokens</label>
            <input
              type="number"
              value={form.responseMaxTokens}
              onChange={(event) =>
                setForm({
                  ...form,
                  responseMaxTokens: Number(event.target.value),
                })
              }
            />
          </section>

          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <h3>Тест Prompt</h3>
            <label>User text</label>
            <textarea
              value={promptInput}
              onChange={(event) => setPromptInput(event.target.value)}
            />
            <div className="row">
              <button type="button" className="secondary" onClick={testPrompt}>
                Test Prompt
              </button>
              <button type="submit">Save</button>
            </div>
            {promptOutput && (
              <div style={{ marginTop: 10 }}>
                <label>Assistant</label>
                <div className="card">{promptOutput}</div>
              </div>
            )}
            {message && <p style={{ color: "#166534" }}>{message}</p>}
          </section>
        </form>
      </main>
    </AuthGuard>
  );
}
