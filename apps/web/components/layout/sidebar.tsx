import Link from "next/link";

const navigationItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/centers", label: "Centers" },
  { href: "/rooms", label: "Rooms" },
  { href: "/providers", label: "Providers" },
];

export function Sidebar() {
  return (
    <aside className="flex w-full flex-col border-b border-slate-200 bg-white px-4 py-4 md:min-h-screen md:w-64 md:border-b-0 md:border-r">
      <Link href="/dashboard" className="text-lg font-semibold text-slate-950">
        Schedule Solver
      </Link>
      <nav className="mt-5 flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
        {navigationItems.map((item) => {
          return (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950"
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
