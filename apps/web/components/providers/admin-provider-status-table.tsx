"use client";

import { useState } from "react";

import {
  createProviderInvite,
  sendProviderInviteEmail,
  type AdminProviderStatusRecord,
} from "@/lib/api";

type AdminProviderStatusTableProps = {
  statuses: AdminProviderStatusRecord[];
};

function accountStateLabel(value: AdminProviderStatusRecord["accountState"]) {
  if (value === null) {
    return "Not invited";
  }

  const label = value.charAt(0).toUpperCase() + value.slice(1);
  return label;
}

function availabilityLabel(status: AdminProviderStatusRecord) {
  if (status.openWeekCount === 0) {
    return "No open weeks";
  }

  if (status.openWeekAvailabilityComplete) {
    return "Complete";
  }

  const label = `${status.incompleteOpenRequiredWeekCount} incomplete`;
  return label;
}

function statusToneClass(status: AdminProviderStatusRecord) {
  if (status.openWeekCount === 0) {
    return "bg-slate-100 text-slate-700";
  }

  if (status.openWeekAvailabilityComplete) {
    return "bg-emerald-100 text-emerald-800";
  }

  return "bg-amber-100 text-amber-900";
}

export function AdminProviderStatusTable({ statuses }: AdminProviderStatusTableProps) {
  const [inviteLinksByProviderId, setInviteLinksByProviderId] = useState<Record<string, string>>({});
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function inviteProvider(providerId: string) {
    setPendingProviderId(providerId);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const invite = await createProviderInvite(providerId);
      const inviteUrl = new URL("/provider-portal/accept", window.location.origin);
      inviteUrl.searchParams.set("token", invite.invite_token);
      setInviteLinksByProviderId((currentLinks) => {
        const nextLinks = {
          ...currentLinks,
          [providerId]: inviteUrl.toString(),
        };
        return nextLinks;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider invite failed.";
      setErrorMessage(message);
    } finally {
      setPendingProviderId(null);
    }
  }

  async function emailProvider(providerId: string) {
    setPendingProviderId(providerId);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const emailSend = await sendProviderInviteEmail(providerId);
      const message = `Invite sent to ${emailSend.recipient_email}.`;
      setSuccessMessage(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider invite email failed.";
      setErrorMessage(message);
    } finally {
      setPendingProviderId(null);
    }
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white">
      {successMessage ? (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {successMessage}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {errorMessage}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-100 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3 font-semibold">Provider</th>
              <th className="px-4 py-3 font-semibold">Account</th>
              <th className="px-4 py-3 font-semibold">Open weeks</th>
              <th className="px-4 py-3 font-semibold">Last update</th>
              <th className="px-4 py-3 font-semibold">Invite</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {statuses.map((status) => {
              const inviteLink = inviteLinksByProviderId[status.providerId];
              const providerIsPending = pendingProviderId === status.providerId;
              const availabilityClass = statusToneClass(status);
              const lastUpdate = status.lastAvailabilityUpdateAt ?? "None";
              return (
                <tr key={status.providerId}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-950">{status.providerName}</div>
                    <div className="text-xs text-slate-500">{status.providerEmail ?? "No email"}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {accountStateLabel(status.accountState)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${availabilityClass}`}>
                      {availabilityLabel(status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{lastUpdate}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded-md bg-teal-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={providerIsPending || status.accountState === "linked"}
                        onClick={() => inviteProvider(status.providerId)}
                      >
                        {providerIsPending ? "Creating..." : "Create invite"}
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded-md bg-indigo-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={providerIsPending || status.accountState === "linked"}
                        onClick={() => emailProvider(status.providerId)}
                      >
                        {providerIsPending ? "Sending..." : "Send email"}
                      </button>
                      {inviteLink !== undefined ? (
                        <input
                          className="w-80 max-w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                          readOnly
                          value={inviteLink}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
