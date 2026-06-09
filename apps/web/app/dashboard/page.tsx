import { auth, currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { userHasAdminRole } from "@/lib/auth";

const dashboardLinks = [
  {
    href: "/centers",
    title: "Centers",
    description: "Manage surgery center locations and their local configuration.",
  },
  {
    href: "/rooms",
    title: "Rooms",
    description: "Add rooms inside each center for coverage planning.",
  },
  {
    href: "/room-types",
    title: "Room Types",
    description: "Manage the room types assigned to rooms for scheduling context.",
  },
  {
    href: "/providers",
    title: "Providers",
    description: "Maintain the people available for anesthesia coverage.",
  },
  {
    href: "/admin/provider-invites",
    title: "Provider Invites",
    description: "Create Provider Portal invite links and send invite emails.",
  },
  {
    href: "/schedules",
    title: "Schedules",
    description: "Build draft schedules and review completed schedule versions.",
  },
  {
    href: "/reports/monthly-availability",
    title: "Monthly Availability",
    description: "Review Provider availability selections on a calendar report.",
  },
  {
    href: "/reports/availability-submission-monitor",
    title: "Availability Submission Monitor",
    description: "Review which Providers have submitted open-week availability.",
  },
  {
    href: "/reports/fairness",
    title: "Fairness",
    description: "Track fairness status, timeline activity, and transaction reasons.",
  },
];

export default async function DashboardPage() {
  const authContext = await auth();
  const user = await currentUser();
  const currentUserIsAdmin = userHasAdminRole(
    authContext.orgRole,
    user?.publicMetadata,
    authContext.sessionClaims,
  );

  if (!currentUserIsAdmin) {
    redirect("/provider-portal");
  }

  return (
    <AppShell>
      <PageHeader
        title="Dashboard"
        description="Start with the core scheduling entities for the first operational slice."
      />
      <div className="grid gap-4 md:grid-cols-6">
        {dashboardLinks.map((item) => {
          return (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md border border-slate-200 bg-white p-5 hover:border-teal-700"
            >
              <h3 className="text-lg font-semibold text-slate-950">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
