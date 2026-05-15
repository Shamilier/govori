/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready: () => void;
        expand?: () => void;
        BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void };
        colorScheme?: "light" | "dark";
        themeParams?: Record<string, string>;
      };
    };
  }
}

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "development" ? "http://localhost:4000" : "");

export function getInitData(): string {
  if (typeof window === "undefined") return "";
  return window.Telegram?.WebApp?.initData ?? "";
}

export async function tgApi<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const initData = getInitData();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (initData) {
    headers["Authorization"] = `tma ${initData}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`API ${response.status}: ${text.slice(0, 200)}`);
  }

  return (await response.json()) as T;
}

export type Period = "today" | "yesterday" | "week" | "month" | "all";
export type Category = "all" | "hot" | "warm" | "cold" | "no_answer";

export type DashboardData = {
  period: string;
  funnel: {
    dialed: number;
    answered: number;
    longTalk: number;
    hot: number;
    warm: number;
    cold: number;
    noAnswer: number;
  };
  counts: { all: number; hot: number; warm: number; cold: number; noAnswer: number };
};

export type LeadListItem = {
  id: string;
  startedAt: string;
  durationSec: number | null;
  direction: "INBOUND" | "OUTBOUND";
  phone: string | null;
  leadName: string | null;
  displayName: string;
  category: "HOT" | "WARM" | "COLD" | "NO_ANSWER" | null;
  summary: string | null;
  nextStep: string | null;
  hasRecording: boolean;
};

export type LeadDetail = LeadListItem & {
  recordingUrl: string | null;
  status: string;
  messages: Array<{
    id: string;
    role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
    text: string;
    sequenceNo: number;
  }>;
};
