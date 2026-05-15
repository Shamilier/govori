import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "GovorI · Дашборд",
  description: "Отчёт по обзвону",
};

export default function TgLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
