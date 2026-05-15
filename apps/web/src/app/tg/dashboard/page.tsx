"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Script from "next/script";
import {
  tgApi,
  type Category,
  type DashboardData,
  type LeadDetail,
  type LeadListItem,
  type Period,
} from "@/lib/tg-api";

const PERIOD_LABEL: Record<Period, string> = {
  today: "Сегодня",
  yesterday: "Вчера",
  week: "7 дней",
  month: "30 дней",
  all: "Всё время",
};

const FUNNEL_PERIOD_LABEL: Record<Period, string> = {
  today: "за сегодня",
  yesterday: "за вчера",
  week: "за 7 дней",
  month: "за 30 дней",
  all: "за всё время",
};

const CATEGORY_META = {
  HOT: { label: "🔥 Горячий", className: "b-hot" },
  WARM: { label: "🟡 Тёплый", className: "b-warm" },
  COLD: { label: "❄️ Холодный", className: "b-cold" },
  NO_ANSWER: { label: "📵 Не взяли", className: "b-no" },
} as const;

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function roleName(role: string): string {
  switch (role.toUpperCase()) {
    case "USER":
      return "Клиент";
    case "ASSISTANT":
      return "Бот";
    case "TOOL":
      return "Инструмент";
    default:
      return "Система";
  }
}

export default function TgDashboardPage() {
  const [ready, setReady] = useState(false);
  const [period, setPeriod] = useState<Period>("week");
  const [category, setCategory] = useState<Category>("all");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [openLead, setOpenLead] = useState<LeadDetail | null>(null);
  const [openLeadLoading, setOpenLeadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const init = useCallback(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand?.();
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.Telegram?.WebApp) {
      init();
    } else {
      // Wait for script
      const interval = window.setInterval(() => {
        if (window.Telegram?.WebApp) {
          window.clearInterval(interval);
          init();
        }
      }, 50);
      return () => window.clearInterval(interval);
    }
  }, [init]);

  const loadData = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const [d, l] = await Promise.all([
        tgApi<DashboardData>(`/api/telegram/webapp/dashboard?period=${period}`),
        tgApi<{ leads: LeadListItem[] }>(
          `/api/telegram/webapp/leads?period=${period}&category=${category}&limit=100`,
        ),
      ]);
      setDashboard(d);
      setLeads(l.leads);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [ready, period, category]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openDrawer = useCallback(async (callId: string) => {
    setOpenLeadLoading(true);
    try {
      const d = await tgApi<LeadDetail>(
        `/api/telegram/webapp/leads/${callId}`,
      );
      setOpenLead(d);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Не удалось загрузить звонок: ${msg}`);
    } finally {
      setOpenLeadLoading(false);
    }
  }, []);

  const closeDrawer = useCallback(() => {
    setOpenLead(null);
  }, []);

  const counts = dashboard?.counts ?? {
    all: 0,
    hot: 0,
    warm: 0,
    cold: 0,
    noAnswer: 0,
  };

  const funnelRows = useMemo(() => {
    const f = dashboard?.funnel;
    if (!f) return null;
    const dialed = Math.max(f.dialed, 1);
    return [
      { label: "Набрано", count: f.dialed, pct: 100 },
      {
        label: "Дозвон",
        count: f.answered,
        pct: Math.round((f.answered / dialed) * 100),
      },
      {
        label: "Разговор >30с",
        count: f.longTalk,
        pct: Math.round((f.longTalk / dialed) * 100),
      },
      {
        label: "🔥 Горячих",
        count: f.hot,
        pct: Math.round((f.hot / dialed) * 100),
        cls: "hot" as const,
      },
      {
        label: "🟡 Тёплых",
        count: f.warm,
        pct: Math.round((f.warm / dialed) * 100),
        cls: "warm" as const,
      },
      {
        label: "❄️ Холодных",
        count: f.cold,
        pct: Math.round((f.cold / dialed) * 100),
        cls: "cold" as const,
      },
      {
        label: "📵 Не взяли",
        count: f.noAnswer,
        pct: Math.round((f.noAnswer / dialed) * 100),
        cls: "no" as const,
      },
    ];
  }, [dashboard]);

  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="beforeInteractive"
      />
      <style>{CSS}</style>

      <div className="app">
        <div className="header">
          <div>
            <h1>📊 Отчёт по обзвону</h1>
            <div className="sub">{PERIOD_LABEL[period]}</div>
          </div>
          <div className="header-actions">
            <button className="btn" onClick={() => void loadData()}>
              🔄 Обновить
            </button>
          </div>
        </div>

        <div className="period-bar">
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
            <button
              key={p}
              className={`chip ${period === p ? "active" : ""}`}
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>

        {error && <div className="panel error">⚠️ {error}</div>}

        <div className="panel">
          <h3>
            Воронка обзвона{" "}
            <span className="muted">{FUNNEL_PERIOD_LABEL[period]}</span>
          </h3>
          {!funnelRows && <div className="empty">{loading ? "Загрузка…" : "Нет данных"}</div>}
          {funnelRows && (
            <div className="funnel">
              {funnelRows.map((r) => (
                <div key={r.label} className="funnel-row">
                  <div className="funnel-label">{r.label}</div>
                  <div className="funnel-bar-wrap">
                    <div
                      className={`funnel-bar ${r.cls ?? ""}`}
                      style={{ width: `${Math.min(r.pct, 100)}%` }}
                    >
                      {r.count}
                    </div>
                    <span className="funnel-pct">{r.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="leads-header">
            <h3>Лиды</h3>
            <div className="leads-tabs">
              {(
                [
                  { k: "all" as Category, label: "Все", c: counts.all },
                  { k: "hot" as Category, label: "🔥 Горячие", c: counts.hot },
                  { k: "warm" as Category, label: "🟡 Тёплые", c: counts.warm },
                  { k: "cold" as Category, label: "❄️ Холодные", c: counts.cold },
                  {
                    k: "no_answer" as Category,
                    label: "📵 Не взяли",
                    c: counts.noAnswer,
                  },
                ]
              ).map((tab) => (
                <button
                  key={tab.k}
                  className={`chip ${category === tab.k ? "active" : ""}`}
                  onClick={() => setCategory(tab.k)}
                >
                  {tab.label} <span style={{ opacity: 0.7 }}>{tab.c}</span>
                </button>
              ))}
            </div>
          </div>

          {leads.length === 0 ? (
            <div className="empty">
              {loading ? "Загрузка…" : "Нет лидов в этой категории"}
            </div>
          ) : (
            <>
              <div className="lead-row lead-head">
                <div>Когда</div>
                <div>Клиент</div>
                <div>Резюме</div>
                <div>Длит.</div>
                <div>Статус</div>
              </div>
              {leads.map((lead) => {
                const meta = lead.category
                  ? CATEGORY_META[lead.category]
                  : { label: "—", className: "b-no" };
                return (
                  <div
                    key={lead.id}
                    className="lead-row"
                    onClick={() => void openDrawer(lead.id)}
                  >
                    <div className="lead-time">
                      {formatDateTime(lead.startedAt)}
                    </div>
                    <div>
                      <div className="lead-name">{lead.displayName}</div>
                      <div className="lead-phone">{lead.phone ?? ""}</div>
                    </div>
                    <div className="lead-summary">
                      {lead.summary ?? "—"}
                    </div>
                    <div className="lead-time">
                      {formatDuration(lead.durationSec)}
                    </div>
                    <div>
                      <span className={`badge ${meta.className}`}>
                        {meta.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      <div
        className={`drawer-bg ${openLead || openLeadLoading ? "open" : ""}`}
        onClick={closeDrawer}
      />
      <div className={`drawer ${openLead || openLeadLoading ? "open" : ""}`}>
        {openLeadLoading && <div className="empty">Загрузка…</div>}
        {openLead && (
          <>
            <div className="drawer-head">
              <div>
                <h2>{openLead.displayName}</h2>
                <div
                  className="sub"
                  style={{ color: "var(--text-dim)", fontSize: 13 }}
                >
                  {openLead.phone ?? ""}
                </div>
              </div>
              <button className="close-btn" onClick={closeDrawer}>
                ✕
              </button>
            </div>

            <div className="drawer-section">
              <span
                className={`badge ${openLead.category ? CATEGORY_META[openLead.category].className : "b-no"}`}
              >
                {openLead.category ? CATEGORY_META[openLead.category].label : "—"}
              </span>
              <span
                style={{
                  color: "var(--text-dim)",
                  fontSize: 12,
                  marginLeft: 8,
                }}
              >
                {formatDateTime(openLead.startedAt)} ·{" "}
                {formatDuration(openLead.durationSec)}
              </span>
            </div>

            {openLead.recordingUrl && (
              <div className="drawer-section">
                <h4>Запись звонка</h4>
                <audio
                  controls
                  src={openLead.recordingUrl}
                  style={{ width: "100%" }}
                />
              </div>
            )}

            {openLead.summary && (
              <div className="drawer-section">
                <h4>Резюме</h4>
                <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                  {openLead.summary}
                </div>
              </div>
            )}

            {openLead.nextStep && (
              <div className="drawer-section">
                <h4>Следующий шаг</h4>
                <div style={{ fontSize: 14 }}>{openLead.nextStep}</div>
              </div>
            )}

            {openLead.messages.length > 0 && (
              <div className="drawer-section">
                <h4>Транскрипт</h4>
                <div className="transcript">
                  {openLead.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`msg ${m.role === "USER" ? "client" : "bot"}`}
                    >
                      <div className="who">{roleName(m.role)}</div>
                      {m.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

const CSS = `
:root {
  --bg: #0f1419;
  --panel: #1a2129;
  --panel-2: #232c36;
  --border: #2a3442;
  --text: #e6edf3;
  --text-dim: #8b98a8;
  --accent: #4a9eff;
  --hot: #ff5252;
  --warm: #ffb547;
  --cold: #5b8def;
  --no: #4a5563;
  --good: #2ecc71;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'SF Pro Text', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.app { max-width: 1080px; margin: 0 auto; padding: 16px; }
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 4px 20px;
  flex-wrap: wrap; gap: 12px;
}
.header h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.3px; }
.header .sub { color: var(--text-dim); font-size: 13px; margin-top: 2px; }
.header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn {
  background: var(--panel); border: 1px solid var(--border);
  color: var(--text); padding: 8px 14px; border-radius: 8px;
  font-size: 13px; cursor: pointer; transition: all .15s;
  display: inline-flex; align-items: center; gap: 6px;
}
.btn:hover { background: var(--panel-2); border-color: #3a4654; }
.period-bar {
  display: flex; gap: 8px; flex-wrap: wrap;
  background: var(--panel); border: 1px solid var(--border);
  padding: 10px; border-radius: 10px; margin-bottom: 16px;
}
.chip {
  background: transparent; border: 1px solid var(--border);
  color: var(--text-dim); padding: 6px 14px; border-radius: 16px;
  font-size: 12px; cursor: pointer; transition: all .15s;
}
.chip:hover { color: var(--text); border-color: #3a4654; }
.chip.active { background: var(--accent); border-color: var(--accent); color: white; }
.panel {
  background: var(--panel); border: 1px solid var(--border);
  padding: 18px; border-radius: 12px;
  margin-bottom: 16px;
}
.panel.error { color: var(--hot); }
.panel h3 { font-size: 14px; font-weight: 600; margin-bottom: 16px; color: var(--text); }
.panel h3 .muted { color: var(--text-dim); font-weight: 400; margin-left: 6px; }
.funnel { display: flex; flex-direction: column; gap: 8px; }
.funnel-row { display: flex; align-items: center; gap: 12px; }
.funnel-label { width: 160px; font-size: 13px; color: var(--text-dim); }
.funnel-bar-wrap { flex: 1; background: var(--panel-2); border-radius: 6px; overflow: hidden; height: 32px; position: relative; }
.funnel-bar { height: 100%; background: linear-gradient(90deg, var(--accent), #6cb1ff); display: flex; align-items: center; padding-left: 12px; font-size: 13px; font-weight: 600; color: white; transition: width .4s; }
.funnel-pct { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 12px; color: var(--text-dim); }
.funnel-bar.hot { background: linear-gradient(90deg, #ff5252, #ff7878); }
.funnel-bar.warm { background: linear-gradient(90deg, #ffb547, #ffc97a); color: #2a1a00; }
.funnel-bar.cold { background: linear-gradient(90deg, #5b8def, #87a8f5); }
.funnel-bar.no { background: linear-gradient(90deg, #4a5563, #6b7785); }
.leads-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px; flex-wrap: wrap; gap: 8px;
}
.leads-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.leads-tabs .chip { padding: 7px 14px; font-size: 12px; }
.lead-row {
  display: grid; grid-template-columns: 110px 1.2fr 2fr 80px 110px;
  gap: 12px; padding: 14px 10px; border-bottom: 1px solid var(--border);
  align-items: center; cursor: pointer; transition: background .15s;
  font-size: 13px;
}
.lead-row:hover { background: var(--panel-2); }
.lead-row:last-child { border-bottom: none; }
.lead-head {
  color: var(--text-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px;
  border-bottom: 1px solid var(--border); padding-bottom: 8px; cursor: default;
}
.lead-head:hover { background: transparent; }
.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;
}
.b-hot { background: rgba(255,82,82,.15); color: var(--hot); }
.b-warm { background: rgba(255,181,71,.15); color: var(--warm); }
.b-cold { background: rgba(91,141,239,.15); color: var(--cold); }
.b-no { background: rgba(74,85,99,.25); color: #8b98a8; }
.lead-name { font-weight: 600; }
.lead-phone { color: var(--text-dim); font-size: 12px; }
.lead-summary { color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lead-time { color: var(--text-dim); font-size: 12px; }
.empty { padding: 32px; text-align: center; color: var(--text-dim); font-size: 14px; }
.drawer-bg {
  position: fixed; inset: 0; background: rgba(0,0,0,.5);
  opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 100;
}
.drawer-bg.open { opacity: 1; pointer-events: auto; }
.drawer {
  position: fixed; right: 0; top: 0; bottom: 0; width: 480px; max-width: 100%;
  background: var(--panel); border-left: 1px solid var(--border);
  transform: translateX(100%); transition: transform .25s;
  overflow-y: auto; z-index: 101; padding: 20px;
}
.drawer.open { transform: translateX(0); }
.drawer-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.drawer h2 { font-size: 18px; }
.close-btn {
  background: transparent; border: none; color: var(--text-dim);
  cursor: pointer; font-size: 22px; padding: 4px 8px;
}
.drawer-section { margin-bottom: 18px; }
.drawer-section h4 { font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.transcript { background: var(--panel-2); border-radius: 8px; padding: 12px; max-height: 320px; overflow-y: auto; font-size: 13px; }
.msg { margin-bottom: 10px; }
.msg .who { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px; }
.msg.bot .who { color: var(--accent); }
.msg.client .who { color: var(--warm); }
@media (max-width: 760px) {
  .lead-row { grid-template-columns: 1fr 110px; gap: 6px; padding: 12px 6px; }
  .lead-row > div:nth-child(1), .lead-row > div:nth-child(3), .lead-row > div:nth-child(4) { display: none; }
  .lead-head { display: none; }
  .funnel-label { width: 110px; font-size: 12px; }
  .header h1 { font-size: 18px; }
  .drawer { width: 100%; }
}
`;
