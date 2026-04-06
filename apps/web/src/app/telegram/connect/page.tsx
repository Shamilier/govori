"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";

type AuthState = "checking" | "guest" | "authorized";
type BindState = "idle" | "binding" | "success" | "error";

export default function TelegramConnectPage() {
  const [token, setToken] = useState("");

  const [authState, setAuthState] = useState<AuthState>("checking");
  const [bindState, setBindState] = useState<BindState>("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const value = new URLSearchParams(window.location.search)
      .get("token")
      ?.trim();
    setToken(value ?? "");
  }, []);

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      try {
        await apiFetch("/api/auth/me", { withCsrf: false });
        if (active) {
          setAuthState("authorized");
        }
      } catch {
        if (active) {
          setAuthState("guest");
        }
      }
    };

    void checkSession();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authState !== "authorized") {
      return;
    }

    if (!token || bindState !== "idle") {
      return;
    }

    let active = true;

    const consumeToken = async () => {
      setBindState("binding");
      setMessage("");

      try {
        await apiFetch<{ tenantId: string; telegramUserId: number }>(
          "/api/telegram/auth/consume",
          {
            method: "POST",
            body: { token },
          },
        );

        if (active) {
          setBindState("success");
          setMessage("Telegram успешно привязан к вашему tenant в GovorI.");
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setBindState("error");
        setMessage(buildErrorMessage(error));
      }
    };

    void consumeToken();

    return () => {
      active = false;
    };
  }, [authState, bindState, token]);

  const loginNextPath = token
    ? `/telegram/connect?token=${encodeURIComponent(token)}`
    : "/telegram/connect";

  return (
    <main className="page" style={{ maxWidth: 560, paddingTop: 80 }}>
      <section className="card">
        <h1>Привязка Telegram</h1>

        {!token && (
          <p style={{ color: "var(--danger)" }}>
            Ссылка не содержит токен привязки. Запустите /start в Telegram боте и
            откройте новую ссылку.
          </p>
        )}

        {authState === "checking" && <p>Проверяем авторизацию...</p>}

        {authState === "guest" && token && (
          <>
            <p>Для завершения привязки нужно войти в админку GovorI.</p>
            <Link
              href={`/login?next=${encodeURIComponent(loginNextPath)}`}
              style={{
                display: "inline-block",
                borderRadius: 10,
                padding: "10px 14px",
                background: "var(--primary)",
                color: "#fff",
              }}
            >
              Войти и продолжить
            </Link>
          </>
        )}

        {authState === "authorized" && token && bindState === "binding" && (
          <p>Завершаем привязку Telegram...</p>
        )}

        {bindState === "success" && (
          <>
            <p style={{ color: "#0f766e" }}>{message}</p>
            <Link href="/dashboard">Перейти в дашборд</Link>
          </>
        )}

        {bindState === "error" && (
          <>
            <p style={{ color: "var(--danger)" }}>{message}</p>
            <p style={{ color: "var(--muted)", marginBottom: 0 }}>
              Запросите новую ссылку через /start в Telegram.
            </p>
          </>
        )}
      </section>
    </main>
  );
}

function buildErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Не удалось завершить привязку. Попробуйте позже.";
  }

  const payload = error.payload;
  const code =
    typeof payload === "object" && payload && "error" in payload
      ? String((payload as { error?: unknown }).error)
      : null;

  switch (code) {
    case "TOKEN_EXPIRED":
      return "Срок действия ссылки истёк.";
    case "TOKEN_ALREADY_USED":
      return "Эта ссылка уже была использована.";
    case "TOKEN_NOT_FOUND":
      return "Ссылка недействительна или повреждена.";
    case "CSRF_VALIDATION_FAILED":
      return "Сессия устарела. Перезайдите в админку и повторите попытку.";
    case "UNAUTHORIZED":
      return "Требуется авторизация в админке GovorI.";
    default:
      return "Не удалось завершить привязку. Попробуйте позже.";
  }
}
