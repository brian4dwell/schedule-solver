import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { randomUUID } from "node:crypto";

import {
  act,
  button,
  click,
  loadTsModule,
  renderComponent,
} from "./helpers/render-component.mjs";

const schemas = loadTsModule("lib/schemas/provider-weekly-availability.ts");
const portalSchemas = loadTsModule("lib/schemas/provider-portal.ts");
const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function weekRecord(notes = null, isLocked = false) {
  const scheduleWeekId = randomUUID();
  const record = {
    scheduleWeekId,
    scheduleWeekName: "September 14–20",
    scheduleWeekStartDate: "2026-09-14",
    scheduleWeekEndDate: "2026-09-20",
    availability: {
      scheduleWeekId,
      providerId: randomUUID(),
      isLocked,
      notes,
      minShiftsRequested: 0,
      maxShiftsRequested: 5,
      days: weekdays.map((weekday) => ({ weekday, options: ["full_shift"] })),
    },
    completion: { isComplete: true, unsetWeekdays: [] },
  };
  return record;
}

async function enterNotes(container, value) {
  const textarea = container.querySelector("textarea");
  assert.ok(textarea);
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  await act(async () => {
    descriptor.set.call(textarea, value);
    const event = new window.Event("input", { bubbles: true });
    textarea.dispatchEvent(event);
  });
}

async function setupPortal(context, record, view = "week", saveFailure = false) {
  let persisted = structuredClone(record);
  const showToast = mock.fn();
  const saveCurrentProviderWeeklyAvailability = mock.fn(async (_weekId, availability) => {
    if (saveFailure) {
      throw new Error("Please retry");
    }

    const payload = portalSchemas.providerPortalAvailabilityPayloadApiSchema.parse(availability);
    const savedAvailability = { ...availability, notes: payload.notes };
    persisted = { ...persisted, availability: savedAvailability };
    return structuredClone(persisted);
  });
  const overrides = new Map([
    ["@/lib/api", { saveCurrentProviderWeeklyAvailability }],
    ["@/components/ui/toast-provider", { useToast: () => ({ showToast }) }],
    ["next/navigation", {
      usePathname: () => "/provider-portal",
      useRouter: () => ({ push: mock.fn() }),
      useSearchParams: () => new URLSearchParams({ view }),
    }],
    ["./provider-preferences-view", { PreferencesView: () => null }],
  ]);
  for (const filename of [
    "provider-portal-utils",
    "provider-shift-request-controls",
    "provider-week-notes-field",
    "provider-week-availability-view",
    "provider-calendar-availability-view",
  ]) {
    const extension = filename === "provider-portal-utils" ? "ts" : "tsx";
    const loadedModule = loadTsModule(`components/providers/${filename}.${extension}`, overrides);
    overrides.set(`./${filename}`, loadedModule);
  }
  const { ProviderPortalWorkspace } = loadTsModule("components/providers/provider-portal-workspace.tsx", overrides);
  const props = {
    availabilityRecords: [record],
    preferenceOptions: { centerOptions: [] },
    preferences: { center_preferences: [], shift_type_preferences: [] },
    profile: { display_name: "Test Provider", email: "provider@example.com" },
  };
  const container = await renderComponent(context, ProviderPortalWorkspace, props);
  return { container, saveCurrentProviderWeeklyAvailability, showToast, persistedRecord: () => persisted };
}

for (const view of ["week", "calendar"]) {
  test(`${view} notes save, reload, and clear with the existing week data`, async (context) => {
    const initial = weekRecord();
    const portal = await setupPortal(context, initial, view);
    const saveLabel = view === "week" ? "Save availability" : "Save";
    const note = "Thursday: early finish\n<script>plain text</script>";
    await enterNotes(portal.container, note);
    assert.match(portal.container.textContent, /Unsaved note changes/);
    assert.match(portal.container.textContent, /2026-09-14/);
    assert.match(portal.container.textContent, /2026-09-20/);
    await click(button(portal.container, saveLabel));
    assert.doesNotMatch(portal.container.textContent, /Unsaved note changes/);
    assert.equal(portal.persistedRecord().availability.notes, note);
    assert.deepEqual(portal.persistedRecord().availability.days, initial.availability.days);
    const reloaded = await setupPortal(context, portal.persistedRecord(), view);
    assert.equal(reloaded.container.querySelector("textarea").value, note);
    assert.equal(reloaded.container.querySelector("script"), null);
    await enterNotes(reloaded.container, " \n ");
    await click(button(reloaded.container, saveLabel));
    const cleared = await setupPortal(context, reloaded.persistedRecord(), view);
    assert.equal(cleared.container.querySelector("textarea").value, "");
    assert.equal(reloaded.persistedRecord().availability.notes, null);
  });

  test(`${view} locked weeks display notes and disable saving`, async (context) => {
    const portal = await setupPortal(context, weekRecord("Locked\nweekly note", true), view);
    const textarea = portal.container.querySelector("textarea");
    assert.equal(textarea.value, "Locked\nweekly note");
    assert.equal(textarea.disabled, true);
    const saveLabel = view === "week" ? "Save availability" : "Save";
    assert.equal(button(portal.container, saveLabel).disabled, true);
    await click(button(portal.container, saveLabel));
    assert.equal(portal.saveCurrentProviderWeeklyAvailability.mock.callCount(), 0);
  });
}

test("failed saves preserve entered notes for retry and show a toast", async (context) => {
  const portal = await setupPortal(context, weekRecord(), "week", true);
  await enterNotes(portal.container, "Keep this draft");
  await click(button(portal.container, "Save availability"));
  assert.equal(portal.container.querySelector("textarea").value, "Keep this draft");
  assert.match(portal.container.textContent, /Unsaved note changes/);
  assert.equal(portal.showToast.mock.calls.at(-1).arguments[0].tone, "error");
});

test("oversized notes have inline validation and cannot be saved", async (context) => {
  const portal = await setupPortal(context, weekRecord());
  await enterNotes(portal.container, "x".repeat(2001));
  assert.equal(portal.container.querySelector("textarea").getAttribute("aria-invalid"), "true");
  assert.match(portal.container.textContent, /Notes must be 2,000 characters or fewer/);
  assert.equal(button(portal.container, "Save availability").disabled, true);
  await enterNotes(portal.container, "😀".repeat(2000));
  assert.equal(button(portal.container, "Save availability").disabled, false);
});

test("weekly contracts require notes and consistently validate both payload paths", () => {
  const record = weekRecord();
  for (const notes of [null, "", " \n", "a\nb", "<b>plain text</b>", "x".repeat(2000), "😀".repeat(2000)]) {
    const expected = notes === null || notes.trim() === "" ? null : notes;
    const availability = { ...record.availability, notes };
    const portalPayload = portalSchemas.providerPortalAvailabilityPayloadApiSchema.parse(availability);
    assert.equal(portalPayload.notes, expected);
    assert.equal(schemas.providerWeeklyAvailabilityReplaceApiSchema.parse(portalPayload).notes, expected);
    const apiRead = { ...portalPayload, provider_id: availability.providerId, schedule_week_id: availability.scheduleWeekId, is_locked: false };
    assert.equal(schemas.providerWeeklyAvailabilityReadApiSchema.parse(apiRead).notes, expected);
  }
  const missing = { ...record.availability };
  delete missing.notes;
  assert.equal(schemas.providerWeeklyAvailabilitySchema.safeParse(missing).success, false);
  for (const notes of ["x".repeat(2001), " ".repeat(2001), "😀".repeat(2001)]) {
    assert.equal(schemas.providerWeeklyNotesSchema.safeParse(notes).success, false);
  }
});
