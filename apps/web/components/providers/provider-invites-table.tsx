"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  createProviderInvite,
  sendProviderInviteEmail,
  type AdminProviderStatusRecord,
} from "@/lib/api";
import { useToast } from "@/components/ui/toast-provider";

type ProviderInvitesTableProps = {
  statuses: AdminProviderStatusRecord[];
};

type ProviderInviteWorkflowTone = "success" | "error";

type ProviderInviteWorkflowMessage = {
  providerId: string;
  text: string;
  tone: ProviderInviteWorkflowTone;
};

function accountStateLabel(value: AdminProviderStatusRecord["accountState"]) {
  if (value === null) {
    return "Not invited";
  }

  const label = value.charAt(0).toUpperCase() + value.slice(1);
  return label;
}

function errorMessageFromUnknown(error: unknown, defaultMessage: string) {
  const errorIsError = error instanceof Error;

  if (errorIsError) {
    return error.message;
  }

  return defaultMessage;
}

function workflowMessageClass(tone: ProviderInviteWorkflowTone) {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  return "border-rose-200 bg-rose-50 text-rose-800";
}

export function ProviderInvitesTable({ statuses }: ProviderInvitesTableProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [inviteLinksByProviderId, setInviteLinksByProviderId] = useState<Map<string, string>>(() => new Map());
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [workflowMessage, setWorkflowMessage] = useState<ProviderInviteWorkflowMessage | null>(null);

  function clearInviteLink(providerId: string) {
    setInviteLinksByProviderId((currentLinks) => {
      const nextLinks = new Map(currentLinks);
      nextLinks.delete(providerId);
      return nextLinks;
    });
  }

  function showInviteLink(providerId: string, token: string) {
    const inviteUrl = new URL("/provider-portal/accept", window.location.origin);
    inviteUrl.searchParams.set("token", token);
    const inviteLink = inviteUrl.toString();
    setInviteLinksByProviderId((currentLinks) => {
      const nextLinks = new Map(currentLinks);
      nextLinks.set(providerId, inviteLink);
      return nextLinks;
    });
  }

  async function inviteProvider(providerId: string) {
    setPendingProviderId(providerId);
    setWorkflowMessage(null);
    clearInviteLink(providerId);
    try {
      const invite = await createProviderInvite(providerId);
      showInviteLink(providerId, invite.invite_token);
      showToast({
        title: "Invite link created",
        description: "The link is ready to copy from the provider row.",
        tone: "success",
      });
    } catch (error) {
      const message = errorMessageFromUnknown(error, "Provider invite failed.");
      const nextWorkflowMessage = {
        providerId,
        text: message,
        tone: "error" as const,
      };
      setWorkflowMessage(nextWorkflowMessage);
      showToast({
        title: "Invite link failed",
        description: message,
        tone: "error",
      });
    } finally {
      setPendingProviderId(null);
      router.refresh();
    }
  }

  async function emailProvider(providerId: string) {
    setPendingProviderId(providerId);
    setWorkflowMessage(null);
    clearInviteLink(providerId);
    try {
      const emailSend = await sendProviderInviteEmail(providerId);
      showInviteLink(providerId, emailSend.invite.invite_token);
      const message = `Invite sent to ${emailSend.recipient_email}.`;
      const nextWorkflowMessage = {
        providerId,
        text: message,
        tone: "success" as const,
      };
      setWorkflowMessage(nextWorkflowMessage);
      showToast({
        title: "Invite email sent",
        description: message,
        tone: "success",
      });
    } catch (error) {
      const message = errorMessageFromUnknown(error, "Provider invite email failed.");
      const nextWorkflowMessage = {
        providerId,
        text: message,
        tone: "error" as const,
      };
      setWorkflowMessage(nextWorkflowMessage);
      showToast({
        title: "Invite email failed",
        description: message,
        tone: "error",
      });
    } finally {
      setPendingProviderId(null);
      router.refresh();
    }
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-100 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3 font-semibold">Provider</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Account</th>
              <th className="px-4 py-3 font-semibold">Invite</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {statuses.map((status) => {
              const inviteLink = inviteLinksByProviderId.get(status.providerId);
              const providerIsPending = pendingProviderId === status.providerId;
              const providerMessageIsVisible = workflowMessage?.providerId === status.providerId;
              const providerMessageTone = workflowMessage?.tone;
              const providerMessageText = workflowMessage?.text;
              const providerMessageClass = providerMessageTone
                ? workflowMessageClass(providerMessageTone)
                : "";
              const providerIsLinked = status.accountState === "linked";
              const inviteIsExpired = status.accountState === "expired";

              return (
                <tr key={status.providerId}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-950">{status.providerName}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{status.providerEmail ?? "No email"}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {accountStateLabel(status.accountState)}
                    {inviteIsExpired ? (
                      <p className="mt-1 max-w-64 text-xs text-amber-800">
                        The previous link has expired. Create a new invite or send a new email.
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded-md bg-teal-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={providerIsPending || providerIsLinked}
                        onClick={() => inviteProvider(status.providerId)}
                      >
                        {providerIsPending ? "Creating..." : "Create invite"}
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded-md bg-indigo-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={providerIsPending || providerIsLinked}
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
                      {providerMessageIsVisible && providerMessageText ? (
                        <p className={`w-80 max-w-full rounded-md border px-2 py-1 text-xs ${providerMessageClass}`}>
                          {providerMessageText}
                        </p>
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
