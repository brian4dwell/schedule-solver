import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { useState } from "react";

import { button, click, createElement, loadTsModule, renderComponent } from "./helpers/render-component.mjs";

const providerId = "00000000-0000-4000-8000-000000000001";

async function setup(context, accountState = "expired") {
  const initialStatuses = [{ providerId, providerName: "Provider A", providerEmail: "provider@example.com", accountState }];
  let serverStatuses = initialStatuses;
  let updateRows;
  const router = { refresh: mock.fn(() => updateRows(serverStatuses)) };
  const toast = { showToast: mock.fn() };
  const api = {
    createProviderInvite: mock.fn(async () => {
      serverStatuses = [{ ...initialStatuses[0], accountState: "invited" }];
      return { invite_token: "created-token" };
    }),
    sendProviderInviteEmail: mock.fn(async () => {
      serverStatuses = [{ ...initialStatuses[0], accountState: "invited" }];
      return { recipient_email: "provider@example.com", invite: { invite_token: "emailed-token" } };
    }),
  };
  const overrides = new Map([
    ["@/lib/api", api],
    ["next/navigation", { useRouter: () => router }],
    ["@/components/ui/toast-provider", { useToast: () => toast }],
  ]);
  const { ProviderInvitesTable } = loadTsModule("components/providers/provider-invites-table.tsx", overrides);
  function ServerPage() {
    const [statuses, setStatuses] = useState(initialStatuses);
    updateRows = setStatuses;
    return createElement(ProviderInvitesTable, { statuses });
  }
  const container = await renderComponent(context, ServerPage, {});
  return { container, api, router, toast };
}

test("expired invites explain the next step and allow a new invitation", async (context) => {
  const { container } = await setup(context);
  assert.match(container.textContent, /Expired/);
  assert.match(container.textContent, /The previous link has expired/);
  assert.equal(button(container, "Create invite").disabled, false);
  assert.equal(button(container, "Send email").disabled, false);
});

test("linked accounts retain their status and cannot be reinvited", async (context) => {
  const { container } = await setup(context, "linked");
  assert.match(container.textContent, /Linked/);
  assert.doesNotMatch(container.textContent, /Expired/);
  assert.equal(button(container, "Create invite").disabled, true);
});

for (const operation of ["Create invite", "Send email"]) {
  test(`${operation} refreshes the expired status and exposes the new link`, async (context) => {
    const { container, router } = await setup(context);
    await click(button(container, operation));
    assert.equal(router.refresh.mock.callCount(), 1);
    assert.doesNotMatch(container.textContent, /Expired/);
    const accountCell = container.querySelector("tbody tr td:nth-child(3)");
    assert.equal(accountCell.textContent.trim(), "Invited");
    const token = operation === "Create invite" ? "created-token" : "emailed-token";
    assert.equal(container.querySelector("input").value, `http://localhost:3000/provider-portal/accept?token=${token}`);
  });
}

test("resending email replaces the previous copyable link", async (context) => {
  const { container } = await setup(context);
  await click(button(container, "Create invite"));
  await click(button(container, "Send email"));
  assert.match(container.querySelector("input").value, /emailed-token/);
  assert.doesNotMatch(container.querySelector("input").value, /created-token/);
});

test("failed resend clears the old link and refreshes server status", async (context) => {
  const { container, api, router, toast } = await setup(context);
  await click(button(container, "Create invite"));
  api.sendProviderInviteEmail.mock.mockImplementation(async () => {
    throw new Error("Mail delivery failed");
  });
  await click(button(container, "Send email"));
  assert.equal(container.querySelector("input"), null);
  assert.equal(router.refresh.mock.callCount(), 2);
  assert.equal(toast.showToast.mock.calls.at(-1).arguments[0].tone, "error");
});

test("the API contract accepts an expired admin account state", () => {
  const availability = loadTsModule("lib/schemas/provider-weekly-availability.ts");
  const overrides = new Map([["@/lib/schemas/provider-weekly-availability", availability]]);
  const schemas = loadTsModule("lib/schemas/provider-portal.ts", overrides);
  const status = schemas.adminProviderStatusApiSchema.parse({
    provider_id: providerId,
    provider_name: "Provider A",
    provider_email: "provider@example.com",
    account_state: "expired",
    last_availability_update_at: null,
    open_week_count: 0,
    incomplete_open_required_week_count: 0,
    incomplete_open_required_weeks: [],
    open_week_availability_complete: true,
  });
  assert.equal(status.accountState, "expired");
});
