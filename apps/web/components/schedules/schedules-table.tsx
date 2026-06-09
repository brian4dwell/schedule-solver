"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  cloneSchedulePeriod,
  deleteSchedulePeriod,
  renameSchedulePeriod,
} from "@/lib/api";
import {
  captureScheduleWorkflowException,
  trackSchedulePeriodCloned,
  trackSchedulePeriodDeleted,
  trackSchedulePeriodRenamed,
} from "@/lib/logrocket";
import type { SchedulePeriodSummary } from "@/lib/schemas/schedule";
import { useToast } from "@/components/ui/toast-provider";

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
  const { showToast } = useToast();
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openMenuPeriodId, setOpenMenuPeriodId] = useState<string | null>(null);
  const [cloningPeriodId, setCloningPeriodId] = useState<string | null>(null);

  function toggleActionMenu(periodId: string) {
    const nextMenuPeriodId = openMenuPeriodId === periodId ? null : periodId;
    setOpenMenuPeriodId(nextMenuPeriodId);
  }

  async function handleRenameSchedule(period: SchedulePeriodSummary) {
    const nextName = window.prompt("Rename schedule", period.name);

    if (nextName === null) {
      setOpenMenuPeriodId(null);
      return;
    }

    setErrorMessage(null);
    setOpenMenuPeriodId(null);

    try {
      const renameValues = {
        name: nextName,
      };
      await renameSchedulePeriod(period.id, renameValues);
      trackSchedulePeriodRenamed({
        schedulePeriodId: period.id,
        scheduleName: nextName,
      });
      showToast({
        title: "Schedule renamed",
        description: "The schedule period name was updated.",
        tone: "success",
      });
      router.refresh();
    } catch (error) {
      captureScheduleWorkflowException({
        workflowName: "rename_schedule_period",
        error,
      });
      const nextErrorMessage =
        error instanceof Error ? error.message : "Schedule rename failed.";
      setErrorMessage(nextErrorMessage);
      showToast({
        title: "Schedule rename failed",
        description: nextErrorMessage,
        tone: "error",
      });
    }
  }

  async function handleDeleteSchedule(period: SchedulePeriodSummary) {
    const hasConfirmedDeletion = window.confirm(
      `Delete \"${period.name}\"? This cannot be undone.`,
    );

    if (!hasConfirmedDeletion) {
      return;
    }

    setErrorMessage(null);
    setOpenMenuPeriodId(null);

    try {
      await deleteSchedulePeriod(period.id);
      trackSchedulePeriodDeleted({
        schedulePeriodId: period.id,
      });
      showToast({
        title: "Schedule deleted",
        description: "The schedule period was deleted.",
        tone: "success",
      });
      router.refresh();
    } catch (error) {
      captureScheduleWorkflowException({
        workflowName: "delete_schedule_period",
        error,
      });
      const nextErrorMessage =
        error instanceof Error ? error.message : "Schedule delete failed.";
      setErrorMessage(nextErrorMessage);
      showToast({
        title: "Schedule delete failed",
        description: nextErrorMessage,
        tone: "error",
      });
    }
  }

  async function handleCloneSchedule(period: SchedulePeriodSummary) {
    setErrorMessage(null);
    setOpenMenuPeriodId(null);
    setCloningPeriodId(period.id);

    try {
      showToast({
        title: "Cloning schedule",
        description: "Creating a copy of the schedule period.",
        tone: "info",
      });
      const response = await cloneSchedulePeriod(period.id);
      const schedulePeriodId = response.schedule_period.id;
      trackSchedulePeriodCloned({
        sourceSchedulePeriodId: period.id,
        clonedSchedulePeriodId: schedulePeriodId,
      });
      showToast({
        title: "Schedule cloned",
        description: "Opening the cloned schedule period.",
        tone: "success",
      });
      router.push(`/schedules/${schedulePeriodId}`);
    } catch (error) {
      captureScheduleWorkflowException({
        workflowName: "clone_schedule_period",
        error,
      });
      const nextErrorMessage =
        error instanceof Error ? error.message : "Schedule clone failed.";
      setErrorMessage(nextErrorMessage);
      setCloningPeriodId(null);
      showToast({
        title: "Schedule clone failed",
        description: nextErrorMessage,
        tone: "error",
      });
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
          const isActionMenuOpen = openMenuPeriodId === period.id;
          const isCloning = cloningPeriodId === period.id;
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
                <Link
                  href={`/schedules/${period.id}`}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-teal-700 px-3 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Open
                </Link>
                <div className="relative">
                  <button
                    type="button"
                    aria-label={`More actions for ${period.name}`}
                    aria-expanded={isActionMenuOpen}
                    aria-haspopup="menu"
                    onClick={() => toggleActionMenu(period.id)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    ...
                  </button>
                  {isActionMenuOpen ? (
                    <div
                      role="menu"
                      className="absolute right-0 z-10 mt-2 w-40 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleRenameSchedule(period)}
                        className="flex w-full px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleCloneSchedule(period)}
                        disabled={isCloning}
                        className="flex w-full px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                      >
                        {isCloning ? "Cloning" : "Clone"}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleDeleteSchedule(period)}
                        className="flex w-full px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
