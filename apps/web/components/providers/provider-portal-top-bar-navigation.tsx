"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import type { ProviderPortalSection } from "./provider-portal-types";
import type { ProviderPortalTopBarNavigationProps } from "./provider-portal-types";
import {
  providerPortalNavigationItems,
  providerPortalSectionFromViewValue,
  providerPortalViewValueForSection,
} from "./provider-portal-utils";

function providerPortalHref(section: ProviderPortalSection, weekId: string | null) {
  const viewValue = providerPortalViewValueForSection(section);
  const params = new URLSearchParams();
  params.set("view", viewValue);

  if (weekId !== null) {
    params.set("weekId", weekId);
  }

  const query = params.toString();
  const href = `/provider-portal?${query}`;
  return href;
}

function providerPortalTopBarLinkClass(isActive: boolean) {
  const baseClass =
    "inline-flex h-9 items-center whitespace-nowrap rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

  if (isActive) {
    const activeClass = "bg-teal-700 text-white shadow-sm";
    const linkClass = `${baseClass} ${activeClass}`;
    return linkClass;
  }

  const inactiveClass = "text-slate-700 hover:bg-white hover:text-teal-950";
  const linkClass = `${baseClass} ${inactiveClass}`;

  return linkClass;
}

function providerPortalTopBarNavigationClass() {
  const baseClass = "inline-flex flex-wrap gap-1 rounded-md border p-1 shadow-sm";
  const colorClass = "border-teal-200 bg-teal-50";
  const navigationClass = `${baseClass} ${colorClass}`;

  return navigationClass;
}

function selectedProviderPortalWeekId(
  requestedWeekExists: boolean,
  requestedWeekId: string | null,
  firstWeekId: string | null,
) {
  if (requestedWeekExists) {
    return requestedWeekId;
  }

  return firstWeekId;
}

function providerPortalTopBarNavItemCurrent(isActive: boolean) {
  if (isActive) {
    return "page";
  }

  return undefined;
}

export function ProviderPortalTopBarNavigation({
  records,
}: ProviderPortalTopBarNavigationProps) {
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const requestedWeekId = searchParams.get("weekId");
  const activeSection = providerPortalSectionFromViewValue(requestedView);
  const firstWeekId = records.at(0)?.scheduleWeekId ?? null;
  const requestedWeekExists = records.some((record) => {
    const matchesWeek = record.scheduleWeekId === requestedWeekId;
    return matchesWeek;
  });
  const selectedWeekId = selectedProviderPortalWeekId(
    requestedWeekExists,
    requestedWeekId,
    firstWeekId,
  );
  const navigationClass = providerPortalTopBarNavigationClass();

  return (
    <nav aria-label="Provider portal sections" className={navigationClass}>
      {providerPortalNavigationItems.map((item) => {
        const itemIsActive = item.id === activeSection;
        const linkClass = providerPortalTopBarLinkClass(itemIsActive);
        const href = providerPortalHref(item.id, selectedWeekId);
        const ariaCurrent = providerPortalTopBarNavItemCurrent(itemIsActive);

        return (
          <Link
            key={item.id}
            aria-current={ariaCurrent}
            href={href}
            className={linkClass}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
