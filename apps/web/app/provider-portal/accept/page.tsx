import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { acceptProviderInvite } from "@/lib/api";

type ProviderPortalAcceptPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

type ProviderInviteAcceptanceState = {
  detail: string;
  providerName: string | null;
  title: string;
  tone: "success" | "warning" | "error";
};

function valueIsRecord(value: unknown): value is Record<string, unknown> {
  const valueIsObject = typeof value === "object";
  const valueIsPresent = value !== null;
  const valueIsRecordType = valueIsObject && valueIsPresent;

  return valueIsRecordType;
}

function apiErrorDetailFromMessage(message: string) {
  try {
    const parsedMessage = JSON.parse(message);
    const parsedMessageIsRecord = valueIsRecord(parsedMessage);

    if (!parsedMessageIsRecord) {
      return message;
    }

    const detail = parsedMessage.detail;
    const detailIsString = typeof detail === "string";

    if (!detailIsString) {
      return message;
    }

    return detail;
  } catch {
    return message;
  }
}

function inviteAcceptanceErrorDetail(error: unknown) {
  const errorIsError = error instanceof Error;

  if (!errorIsError) {
    return "Provider invite acceptance failed.";
  }

  const detail = apiErrorDetailFromMessage(error.message);
  const serverError = detail === "Internal Server Error";

  if (serverError) {
    return "The invite could not be accepted because the Provider Portal had a server error.";
  }

  return detail;
}

function acceptanceStateClass(tone: ProviderInviteAcceptanceState["tone"]) {
  if (tone === "success") {
    return "rounded-md border border-emerald-200 bg-emerald-50 p-5";
  }

  if (tone === "warning") {
    return "rounded-md border border-amber-200 bg-amber-50 p-5";
  }

  return "rounded-md border border-red-200 bg-red-50 p-5";
}

function acceptanceTitleClass(tone: ProviderInviteAcceptanceState["tone"]) {
  if (tone === "success") {
    return "text-sm font-semibold text-emerald-950";
  }

  if (tone === "warning") {
    return "text-sm font-semibold text-amber-950";
  }

  return "text-sm font-semibold text-red-950";
}

function acceptanceDetailClass(tone: ProviderInviteAcceptanceState["tone"]) {
  if (tone === "success") {
    return "mt-2 text-sm leading-6 text-emerald-900";
  }

  if (tone === "warning") {
    return "mt-2 text-sm leading-6 text-amber-900";
  }

  return "mt-2 text-sm leading-6 text-red-900";
}

export default async function ProviderPortalAcceptPage({
  searchParams,
}: ProviderPortalAcceptPageProps) {
  const resolvedSearchParams = await searchParams;
  const inviteToken = resolvedSearchParams.token ?? "";
  const hasInviteToken = inviteToken !== "";
  let acceptanceState: ProviderInviteAcceptanceState = {
    detail: "Open the Provider Portal invite link from your email.",
    providerName: null,
    title: "Invite token missing",
    tone: "warning",
  };

  if (hasInviteToken) {
    try {
      const profile = await acceptProviderInvite(inviteToken);
      acceptanceState = {
        detail: "This signed-in account is now connected to the Provider profile.",
        providerName: profile.display_name,
        title: "Provider account linked",
        tone: "success",
      };
    } catch (error) {
      const detail = inviteAcceptanceErrorDetail(error);
      acceptanceState = {
        detail,
        providerName: null,
        title: "Provider invite was not accepted",
        tone: "error",
      };
    }
  }

  const sectionClass = acceptanceStateClass(acceptanceState.tone);
  const titleClass = acceptanceTitleClass(acceptanceState.tone);
  const detailClass = acceptanceDetailClass(acceptanceState.tone);

  return (
    <AppShell>
      <PageHeader
        title="Provider Invite"
        description="Complete the Provider account link for this signed-in Clerk account."
      />
      <section className={sectionClass}>
        <p className={titleClass}>{acceptanceState.title}</p>
        <p className={detailClass}>{acceptanceState.detail}</p>
        {acceptanceState.providerName !== null ? (
          <p className={detailClass}>{acceptanceState.providerName}</p>
        ) : null}
        <Link
          href="/provider-portal"
          className="mt-4 inline-flex h-10 items-center rounded-md bg-teal-700 px-4 text-sm font-semibold text-white"
        >
          Open Provider Portal
        </Link>
      </section>
    </AppShell>
  );
}
