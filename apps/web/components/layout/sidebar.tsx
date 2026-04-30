"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

const navigationItems = [
  { href: "/dashboard", label: "Dashboard", shortLabel: "D" },
  { href: "/centers", label: "Centers", shortLabel: "C" },
  { href: "/rooms", label: "Rooms", shortLabel: "R" },
  { href: "/room-types", label: "Room Types", shortLabel: "T" },
  { href: "/providers", label: "Providers", shortLabel: "P" },
  { href: "/schedules", label: "Schedules", shortLabel: "S" },
];

const sidebarDockedStorageKey = "schedule-solver-sidebar-docked";
const sidebarDockedChangeEvent = "schedule-solver-sidebar-docked-change";

function getSidebarDockedSnapshot() {
  const storedValue = localStorage.getItem(sidebarDockedStorageKey);
  const storedDocked = storedValue === "true";
  return storedDocked;
}

function getSidebarDockedServerSnapshot() {
  return false;
}

function subscribeToSidebarDockedChange(onStoreChange: () => void) {
  window.addEventListener(sidebarDockedChangeEvent, onStoreChange);

  return () => {
    window.removeEventListener(sidebarDockedChangeEvent, onStoreChange);
  };
}

function saveSidebarDocked(nextDocked: boolean) {
  const storedValue = String(nextDocked);
  localStorage.setItem(sidebarDockedStorageKey, storedValue);
  window.dispatchEvent(new Event(sidebarDockedChangeEvent));
}

export function Sidebar() {
  const pathname = usePathname();
  const isDocked = useSyncExternalStore(
    subscribeToSidebarDockedChange,
    getSidebarDockedSnapshot,
    getSidebarDockedServerSnapshot,
  );

  function toggleDock() {
    const nextDocked = !isDocked;
    saveSidebarDocked(nextDocked);
  }

  const asideWidthClass = isDocked ? "md:w-20" : "md:w-64";
  const asidePaddingClass = isDocked ? "md:px-3" : "md:px-4";
  const desktopAlignmentClass = isDocked ? "md:items-center" : "md:items-stretch";
  const titleVisibilityClass = isDocked ? "md:hidden" : "";
  const brandMarkVisibilityClass = isDocked ? "hidden md:flex" : "hidden";
  const toggleLabel = isDocked ? "Expand menu" : "Dock menu";
  const toggleSymbol = isDocked ? ">" : "<";

  return (
    <aside
      className={`flex w-full flex-col border-b border-slate-200 bg-white px-4 py-4 transition-[width,padding] duration-200 md:min-h-screen md:border-b-0 md:border-r ${asideWidthClass} ${asidePaddingClass} ${desktopAlignmentClass}`}
    >
      <div className="flex items-center justify-between gap-3 md:w-full">
        <Link
          href="/dashboard"
          className={`text-lg font-semibold text-slate-950 ${titleVisibilityClass}`}
        >
          Bespoke
        </Link>
        <Link
          href="/dashboard"
          aria-label="Bespoke dashboard"
          className={`${brandMarkVisibilityClass} h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-sm font-semibold text-white`}
        >
          B
        </Link>
        <button
          type="button"
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-pressed={isDocked}
          onClick={toggleDock}
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950 md:flex"
        >
          {toggleSymbol}
        </button>
      </div>
      <nav className="mt-5 flex gap-2 overflow-x-auto md:w-full md:flex-col md:overflow-visible">
        {navigationItems.map((item) => {
          const nestedPathPrefix = `${item.href}/`;
          const isNestedPath = pathname.startsWith(nestedPathPrefix);
          const isActive = pathname === item.href || isNestedPath;
          const activeClass = isActive ? "bg-slate-950 text-white" : "";
          const inactiveClass = isActive
            ? ""
            : "text-slate-700 hover:bg-slate-100 hover:text-slate-950";
          const dockedClass = isDocked ? "md:h-10 md:w-10 md:justify-center md:px-0" : "";
          const labelClass = isDocked ? "md:hidden" : "";
          const shortLabelClass = isDocked ? "hidden md:inline" : "hidden";

          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`flex whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${activeClass} ${inactiveClass} ${dockedClass}`}
            >
              <span className={labelClass}>{item.label}</span>
              <span className={shortLabelClass}>{item.shortLabel}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
