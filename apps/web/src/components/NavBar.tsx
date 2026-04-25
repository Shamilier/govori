"use client";

import {
  Bot,
  Building2,
  Gauge,
  LogOut,
  Phone,
  PlugZap,
  RadioTower,
  ScrollText,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

const links = [
  { href: "/dashboard", label: "Dashboard", Icon: Gauge },
  { href: "/clients", label: "Clients", Icon: Building2 },
  { href: "/numbers", label: "Numbers", Icon: Phone },
  { href: "/agent", label: "Agent", Icon: Bot },
  { href: "/integrations", label: "Integrations", Icon: PlugZap },
  { href: "/calls", label: "Calls", Icon: ScrollText },
];

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST", body: {} });
    } finally {
      router.replace("/login");
    }
  };

  return (
    <aside className="navbar">
      <div className="nav-left">
        <div className="brand">
          <div className="brand-mark">
            <RadioTower size={22} strokeWidth={2.4} />
          </div>
          <div>
            <div className="brand-title">GovorI</div>
            <div className="brand-subtitle">Voice command center</div>
          </div>
        </div>
        <nav>
          {links.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className={pathname.startsWith(href) ? "active" : ""}
            >
              <Icon size={18} strokeWidth={2.3} />
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="nav-footer">
        <div className="nav-status">
          <span>Runtime</span>
          <strong>
            <Sparkles size={14} strokeWidth={2.4} /> Gemini Live ready
          </strong>
        </div>
        <button onClick={logout} className="danger" type="button">
          <LogOut size={16} strokeWidth={2.5} />
          Logout
        </button>
      </div>
    </aside>
  );
}
