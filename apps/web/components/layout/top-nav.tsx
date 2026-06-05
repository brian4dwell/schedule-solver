"use client";

import { Show, UserButton, useAuth, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { userHasAdminRole } from "@/lib/auth";

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

const providerPortalLink: NavigationLink = {
  href: "/provider-portal",
  label: "Provider Portal",
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
    {
      href: "/admin/provider-status",
      label: "Provider Status",
    },
  ],
};

const reportsMenu: NavigationMenu = {
  label: "Reports",
  links: [
    {
      href: "/reports/monthly-availability",
      label: "Monthly Availability",
    },
    {
      href: "/reports/fairness",
      label: "Fairness",
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
  const auth = useAuth();
  const userResult = useUser();
  const currentUserIsAdmin = userHasAdminRole(
    auth.orgRole,
    userResult.user?.publicMetadata,
    auth.sessionClaims,
  );
  const setupLinks = currentUserIsAdmin ? setupMenu.links : [];
  const setupMenuHasActiveLink = setupLinks.some((item) => {
    const isActive = isNavigationLinkActive(pathname, item.href);

    return isActive;
  });
  const setupMenuTriggerClass = buildMenuTriggerClass(setupMenuHasActiveLink);
  const reportLinks = currentUserIsAdmin ? reportsMenu.links : [];
  const reportsMenuHasActiveLink = reportLinks.some((item) => {
    const isActive = isNavigationLinkActive(pathname, item.href);

    return isActive;
  });
  const reportsMenuTriggerClass = buildMenuTriggerClass(reportsMenuHasActiveLink);

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="inline-flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-slate-500">Bespoke Anesthesia</span>
          <span className="text-sm text-slate-300">/</span>
          <span className="text-xl font-semibold text-slate-950">Operations workspace</span>
        </Link>
        <div className="flex items-center gap-3">
          {currentUserIsAdmin ? (
            <span className="rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800">
              Admin
            </span>
          ) : null}
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </div>
      <nav className="border-t border-slate-200 px-4 py-2 sm:px-6 lg:px-8">
        <div className="flex flex-wrap gap-2">
          {currentUserIsAdmin ? (
            <Link
              href={scheduleBoardLink.href}
              className={buildLinkClass(
                isNavigationLinkActive(pathname, scheduleBoardLink.href),
              )}
            >
              {scheduleBoardLink.label}
            </Link>
          ) : null}
          {currentUserIsAdmin ? (
            <Link
              href={availabilityLink.href}
              className={buildLinkClass(
                isNavigationLinkActive(pathname, availabilityLink.href),
              )}
            >
              {availabilityLink.label}
            </Link>
          ) : null}
          <Link
            href={providerPortalLink.href}
            className={buildLinkClass(
              isNavigationLinkActive(pathname, providerPortalLink.href),
            )}
          >
            {providerPortalLink.label}
          </Link>
          {currentUserIsAdmin ? (
            <details className="group relative shrink-0">
              <summary className={setupMenuTriggerClass}>{setupMenu.label}</summary>
              <div className="absolute left-0 top-10 z-20 min-w-44 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                {setupLinks.map((item) => {
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
          ) : null}
          {currentUserIsAdmin ? (
            <details className="group relative shrink-0">
              <summary className={reportsMenuTriggerClass}>{reportsMenu.label}</summary>
              <div className="absolute left-0 top-10 z-20 min-w-56 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                {reportLinks.map((item) => {
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
          ) : null}
        </div>
      </nav>
    </header>
  );
}
