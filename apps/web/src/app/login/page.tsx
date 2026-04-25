"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, RadioTower } from "lucide-react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin12345");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        body: { email, password },
        withCsrf: false,
      });

      const requestedNextPath = new URLSearchParams(window.location.search)
        .get("next")
        ?.trim();
      const safeNextPath =
        requestedNextPath &&
        requestedNextPath.startsWith("/") &&
        !requestedNextPath.startsWith("//")
          ? requestedNextPath
          : "/dashboard";

      router.replace(safeNextPath);
    } catch {
      setError("Не удалось войти. Проверьте email и пароль.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand" style={{ borderBottom: 0, paddingBottom: 0 }}>
          <div className="brand-mark">
            <RadioTower size={22} strokeWidth={2.4} />
          </div>
          <div>
            <div className="brand-title" style={{ color: "var(--ink)" }}>
              GovorI
            </div>
            <div className="brand-subtitle" style={{ color: "var(--muted)" }}>
              Command Center
            </div>
          </div>
        </div>

        <div style={{ margin: "24px 0 18px" }}>
          <p className="eyebrow">Secure console</p>
          <h1>Вход в панель</h1>
          <p className="page-lede">
            Операции, клиенты, номера и голосовые агенты в одном контуре.
          </p>
        </div>

        <form onSubmit={onSubmit} className="field-stack">
          <div>
            <label>Email</label>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
            />
          </div>
          <div>
            <label>Password</label>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              required
            />
          </div>
          {error && <p className="message error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? "Signing in" : "Login"}
            <ArrowRight size={16} strokeWidth={2.5} />
          </button>
        </form>
      </section>
    </main>
  );
}
