"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { deleteSchedulePeriod } from "@/lib/api";
import type { SchedulePeriodSummary } from "@/lib/schemas/schedule";

type SchedulesTableProps = {
  periods: SchedulePeriodSummary[];
};

function formatScheduleDate(value: string) {
  const date = new Date(value);
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const formattedValue = formatter.format(date);
  return formattedValue;
}

function publishStatus(period: SchedulePeriodSummary) {
  if (period.lastPublishedAt === null) {
    return "Never published";
  }

  if (period.unpublishedChangeCount > 0) {
    return "Published with draft versions";
  }

  return "Published";
}

export function SchedulesTable({ periods }: SchedulesTableProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDeleteSchedule(period: SchedulePeriodSummary) {
    const hasConfirmedDeletion = window.confirm(
      `Delete \"${period.name}\"? This cannot be undone.`,
    );

    if (!hasConfirmedDeletion) {
      return;
    }

    setErrorMessage(null);

    try {
      await deleteSchedulePeriod(period.id);
      router.refresh();
    } catch (error) {
      const nextErrorMessage =
        error instanceof Error ? error.message : "Schedule delete failed.";
      setErrorMessage(nextErrorMessage);
    }
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white">
      {errorMessage ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}
      <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(10rem,0.7fr)_minmax(9rem,0.6fr)_auto] border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase text-slate-500 lg:grid">
        <span>Schedule period</span>
        <span>Status</span>
        <span>Last publish</span>
        <span className="text-right">Action</span>
      </div>
      <div className="divide-y divide-slate-200">
        {periods.length === 0 ? (
          <div className="px-4 py-8 text-sm text-slate-500">
            No schedule periods have been created yet.
          </div>
        ) : null}
        {periods.map((period) => {
          const status = publishStatus(period);
          const lastPublished =
            period.lastPublishedAt === null
              ? "Not published"
              : formatScheduleDate(period.lastPublishedAt);
          return (
            <div
              key={period.id}
              className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(10rem,0.7fr)_minmax(9rem,0.6fr)_auto] lg:items-center"
            >
              <div>
                <h3 className="text-sm font-semibold text-slate-950">{period.name}</h3>
                <p className="text-sm text-slate-500">{period.dateRange}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {period.currentVersionName} edited {formatScheduleDate(period.lastEditedAt)}
                </p>
              </div>
              <div>
                <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                  {status}
                </span>
                {period.unpublishedChangeCount > 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {period.unpublishedChangeCount} draft versions
                  </p>
                ) : null}
              </div>
              <p className="text-sm text-slate-600">{lastPublished}</p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => handleDeleteSchedule(period)}
                  className="inline-flex h-9 items-center justify-center rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
                >
                  Delete
                </button>
                <Link
                  href={`/schedules/${period.id}`}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-teal-700 px-3 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Open
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
