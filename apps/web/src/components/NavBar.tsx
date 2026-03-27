"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/clients", label: "Clients" },
  { href: "/numbers", label: "Numbers" },
  { href: "/agent", label: "Agent" },
  { href: "/integrations", label: "Integrations" },
  { href: "/calls", label: "Calls" },
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
    <header className="navbar">
      <div className="nav-left">
        <div className="brand">GovorI MVP</div>
        <nav>
          {links.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname.startsWith(item.href) ? "active" : ""}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <button onClick={logout} className="danger" type="button">
        Logout
      </button>
    </header>
  );
}
