"use client";

import { FormEvent, useState } from "react";
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
      router.replace("/dashboard");
    } catch {
      setError("Не удалось войти. Проверьте email/password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page" style={{ maxWidth: 440, paddingTop: 80 }}>
      <section className="card">
        <h1>Admin Login</h1>
        <p style={{ color: "var(--muted)" }}>MVP панель голосового агента</p>
        <form onSubmit={onSubmit} className="grid">
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
          {error && (
            <div style={{ color: "var(--danger)", fontSize: 14 }}>{error}</div>
          )}
          <button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}
