"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavigationLink = {
  href: string;
  label: string;
};

type NavigationMenu = {
  label: string;
  links: NavigationLink[];
};

const scheduleBoardLink: NavigationLink = {
  href: "/schedules",
  label: "Schedules",
};

const availabilityLink: NavigationLink = {
  href: "/availability",
  label: "Availability",
};

const reportsLink: NavigationLink = {
  href: "/fairness",
  label: "Reports",
};

const setupMenu: NavigationMenu = {
  label: "Setup",
  links: [
    {
      href: "/centers",
      label: "Centers",
    },
    {
      href: "/rooms",
      label: "Rooms",
    },
    {
      href: "/room-types",
      label: "Room Types",
    },
    {
      href: "/providers",
      label: "Providers",
    },
  ],
};

function isNavigationLinkActive(pathname: string, href: string) {
  const nestedPathPrefix = `${href}/`;
  const isExactPath = pathname === href;
  const isNestedPath = pathname.startsWith(nestedPathPrefix);
  const isActive = isExactPath || isNestedPath;

  return isActive;
}

function buildLinkClass(isActive: boolean) {
  const baseClass =
    "inline-flex h-9 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium";
  const activeClass = "bg-slate-950 text-white";
  const inactiveClass = "text-slate-700 hover:bg-slate-100 hover:text-slate-950";
  const stateClass = isActive ? activeClass : inactiveClass;
  const linkClass = `${baseClass} ${stateClass}`;

  return linkClass;
}

function buildMenuTriggerClass(isActive: boolean) {
  const baseClass =
    "flex h-9 cursor-pointer list-none items-center whitespace-nowrap rounded-md px-3 text-sm font-medium marker:hidden [&::-webkit-details-marker]:hidden";
  const activeClass = "bg-slate-950 text-white";
  const inactiveClass = "text-slate-700 hover:bg-slate-100 hover:text-slate-950";
  const stateClass = isActive ? activeClass : inactiveClass;
  const triggerClass = `${baseClass} ${stateClass}`;

  return triggerClass;
}

export function TopNav() {
  const pathname = usePathname();
  const menuHasActiveLink = setupMenu.links.some((item) => {
    const isActive = isNavigationLinkActive(pathname, item.href);

    return isActive;
  });
  const menuTriggerClass = buildMenuTriggerClass(menuHasActiveLink);

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="inline-flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-slate-500">Bespoke Anesthesia</span>
          <span className="text-sm text-slate-300">/</span>
          <span className="text-xl font-semibold text-slate-950">Operations workspace</span>
        </Link>
      </div>
      <nav className="border-t border-slate-200 px-4 py-2 sm:px-6 lg:px-8">
        <div className="flex flex-wrap gap-2">
          <Link
            href={scheduleBoardLink.href}
            className={buildLinkClass(
              isNavigationLinkActive(pathname, scheduleBoardLink.href),
            )}
          >
            {scheduleBoardLink.label}
          </Link>
          <Link
            href={availabilityLink.href}
            className={buildLinkClass(
              isNavigationLinkActive(pathname, availabilityLink.href),
            )}
          >
            {availabilityLink.label}
          </Link>
          <details className="group relative shrink-0">
            <summary className={menuTriggerClass}>{setupMenu.label}</summary>
            <div className="absolute left-0 top-10 z-20 min-w-44 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
              {setupMenu.links.map((item) => {
                const isActive = isNavigationLinkActive(pathname, item.href);
                const linkClass = buildLinkClass(isActive);

                return (
                  <Link key={item.href} href={item.href} className={`${linkClass} w-full`}>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </details>
          <Link
            href={reportsLink.href}
            className={buildLinkClass(isNavigationLinkActive(pathname, reportsLink.href))}
          >
            {reportsLink.label}
          </Link>
        </div>
      </nav>
    </header>
  );
}
