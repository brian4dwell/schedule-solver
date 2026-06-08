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
    "inline-flex h-9 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium";
  const activeClass = "bg-slate-950 text-white";
  const inactiveClass = "text-slate-700 hover:bg-slate-100 hover:text-slate-950";
  const stateClass = isActive ? activeClass : inactiveClass;
  const linkClass = `${baseClass} ${stateClass}`;
  return linkClass;
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
  const selectedWeekId = requestedWeekExists ? requestedWeekId : firstWeekId;

  return (
    <div className="flex flex-wrap gap-2">
      {providerPortalNavigationItems.map((item) => {
        const itemIsActive = item.id === activeSection;
        const linkClass = providerPortalTopBarLinkClass(itemIsActive);
        const href = providerPortalHref(item.id, selectedWeekId);

        return (
          <Link key={item.id} href={href} className={linkClass}>
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
