"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Grows in Phase B/C: customers, quotes, jobs, money, assistant.
export const OFFICE_NAV = [
  { href: "/dashboard", label: "Home" },
  { href: "/customers", label: "Customers" },
  { href: "/quotes", label: "Quotes" },
  { href: "/jobs", label: "Jobs" },
  { href: "/settings", label: "Settings" },
];

export function OfficeNav() {
  const pathname = usePathname();
  const linkClass = (href: string) =>
    `rounded-control px-3 py-2 text-sm ${pathname.startsWith(href) ? "bg-paper font-medium" : "text-ink-muted hover:bg-paper"}`;
  return (
    <>
      <nav className="hidden w-48 shrink-0 flex-col gap-1 border-r border-line p-3 md:flex">
        <p className="mb-2 px-3 font-display text-lg font-semibold">Mallet</p>
        {OFFICE_NAV.map((item) => (
          <Link key={item.href} href={item.href} className={linkClass(item.href)}>{item.label}</Link>
        ))}
      </nav>
      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-line bg-card py-1 md:hidden">
        {OFFICE_NAV.map((item) => (
          <Link key={item.href} href={item.href} className={`${linkClass(item.href)} min-h-11 content-center`}>{item.label}</Link>
        ))}
      </nav>
    </>
  );
}
