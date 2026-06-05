import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ProviderPortalWorkspace } from "@/components/providers/provider-portal-workspace";
import {
  getCurrentProviderAvailability,
  getCurrentProviderPreferenceOptions,
  getCurrentProviderPreferences,
  getCurrentProviderProfile,
} from "@/lib/api";

type ProviderPortalAccessIssue = "missingLink" | "inactiveLink";

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
      return null;
    }

    const detail = parsedMessage.detail;
    const detailIsString = typeof detail === "string";

    if (!detailIsString) {
      return null;
    }

    return detail;
  } catch {
    return null;
  }
}

function providerPortalAccessIssueFromError(error: unknown): ProviderPortalAccessIssue | null {
  const errorIsError = error instanceof Error;

  if (!errorIsError) {
    return null;
  }

  const detail = apiErrorDetailFromMessage(error.message);
  const accountLinkIsMissing = detail === "Provider account link required";

  if (accountLinkIsMissing) {
    return "missingLink";
  }

  const accountLinkIsInactive = detail === "Provider account link is inactive";

  if (accountLinkIsInactive) {
    return "inactiveLink";
  }

  return null;
}

function accessIssueTitle(issue: ProviderPortalAccessIssue) {
  if (issue === "inactiveLink") {
    return "Provider profile link inactive";
  }

  return "Provider profile not linked";
}

function accessIssueDescription(issue: ProviderPortalAccessIssue) {
  if (issue === "inactiveLink") {
    return "This signed-in account is linked to a Provider profile that is no longer active.";
  }

  return "This signed-in account is not connected to a Provider profile yet.";
}

function accessIssueNextStep(issue: ProviderPortalAccessIssue) {
  if (issue === "inactiveLink") {
    return "Ask an administrator to reactivate the Provider profile or send a new Provider Portal invite.";
  }

  return "Use the Provider Portal invite link from your email, or ask an administrator to create a Provider link for this account.";
}

function ProviderPortalAccessIssuePanel({
  issue,
}: {
  issue: ProviderPortalAccessIssue;
}) {
  const title = accessIssueTitle(issue);
  const description = accessIssueDescription(issue);
  const nextStep = accessIssueNextStep(issue);

  return (
    <section className="rounded-md border border-amber-200 bg-amber-50 p-5">
      <p className="text-sm font-semibold text-amber-950">{title}</p>
      <p className="mt-2 text-sm leading-6 text-amber-900">{description}</p>
      <p className="mt-2 text-sm leading-6 text-amber-900">{nextStep}</p>
    </section>
  );
}

export default async function ProviderPortalPage() {
  let profile;
  let availabilityRecords;
  let preferences;
  let preferenceOptions;

  try {
    profile = await getCurrentProviderProfile();
    availabilityRecords = await getCurrentProviderAvailability();
    preferences = await getCurrentProviderPreferences();
    preferenceOptions = await getCurrentProviderPreferenceOptions();
  } catch (error) {
    const accessIssue = providerPortalAccessIssueFromError(error);

    if (accessIssue === null) {
      throw error;
    }

    return (
      <AppShell>
        <PageHeader
          title="Provider Portal"
          description="Manage open-week availability and provider-visible preferences."
        />
        <ProviderPortalAccessIssuePanel issue={accessIssue} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Provider Portal"
        description="Manage open-week availability and provider-visible preferences."
      />
      <ProviderPortalWorkspace
        availabilityRecords={availabilityRecords}
        preferenceOptions={preferenceOptions}
        preferences={preferences}
        profile={profile}
      />
    </AppShell>
  );
}
