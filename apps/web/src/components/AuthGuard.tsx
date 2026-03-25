"use client";

import { useRouter } from "next/navigation";
import { PropsWithChildren, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export function AuthGuard({ children }: PropsWithChildren) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    const validate = async () => {
      try {
        await apiFetch("/api/auth/me", { withCsrf: false });
        if (active) {
          setReady(true);
        }
      } catch {
        router.replace("/login");
      }
    };

    void validate();

    return () => {
      active = false;
    };
  }, [router]);

  if (!ready) {
    return <div className="loading">Проверка сессии...</div>;
  }

  return <>{children}</>;
}
