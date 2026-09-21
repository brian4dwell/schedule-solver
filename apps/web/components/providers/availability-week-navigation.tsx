import Link from "next/link";

type AvailabilityWeekNavigationProps = {
  previousHref: string | undefined;
  nextHref: string | undefined;
};

type AvailabilityWeekLinkProps = {
  href: string | undefined;
  label: string;
};

function AvailabilityWeekLink({ href, label }: AvailabilityWeekLinkProps) {
  if (href === undefined) {
    return (
      <span
        aria-disabled="true"
        title="No availability week exists in this direction"
        className="inline-flex h-12 items-center whitespace-nowrap rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-400"
      >
        {label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-teal-700 hover:bg-teal-50 hover:text-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
    >
      {label}
    </Link>
  );
}

export function AvailabilityWeekNavigation({
  previousHref,
  nextHref,
}: AvailabilityWeekNavigationProps) {
  return (
    <nav aria-label="Availability weeks" className="flex flex-wrap items-center gap-2">
      <AvailabilityWeekLink href={previousHref} label="← Previous week" />
      <AvailabilityWeekLink href={nextHref} label="Next week →" />
    </nav>
  );
}
