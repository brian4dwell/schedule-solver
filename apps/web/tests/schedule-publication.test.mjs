import assert from "node:assert/strict";
import { mock, test } from "node:test";

import {
  act,
  button,
  changeNotes,
  click,
  createElement,
  finishRequest,
  loadTsModule,
  renderComponent,
  select,
} from "./helpers/render-component.mjs";

const providerId = "00000000-0000-4000-8000-000000000001";
const centerId = "00000000-0000-4000-8000-000000000002";
const roomId = "00000000-0000-4000-8000-000000000003";
const periodId = "00000000-0000-4000-8000-000000000004";
const versionId = "00000000-0000-4000-8000-000000000007";
const nextVersionId = "00000000-0000-4000-8000-000000000008";
const timestamp = "2026-09-13T12:00:00Z";
const scheduleSchemas = loadTsModule("lib/schemas/schedule.ts");

function versionDetail(shiftType = "full_shift") {
  return scheduleSchemas.scheduleVersionDetailApiSchema.parse({
    version: {
      id: versionId,
      schedule_period_id: periodId,
      schedule_job_id: null,
      version_number: 1,
      status: "draft",
      source: "manual",
      parent_schedule_version_id: null,
      published_at: null,
      published_by_user_id: null,
      created_by_user_id: null,
      solver_score: null,
      notes: null,
      created_at: timestamp,
      updated_at: timestamp,
    },
    assignments: [{
      id: "00000000-0000-4000-8000-000000000005",
      room_slot_id: "00000000-0000-4000-8000-000000000006",
      schedule_version_id: versionId,
      schedule_period_id: periodId,
      provider_id: providerId,
      center_id: centerId,
      room_id: roomId,
      shift_requirement_id: null,
      required_provider_type: null,
      shift_type: shiftType,
      schedule_date: "2026-09-14",
      start_time: "2026-09-14T07:00:00Z",
      end_time: "2026-09-14T11:00:00Z",
      assignment_status: "draft",
      source: "manual",
      notes: null,
      created_at: timestamp,
      updated_at: timestamp,
    }],
    violations: [],
  });
}

async function setup(context, { detail = versionDetail(), availabilityOption = "full_shift", apiOverrides = {} } = {}) {
  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const days = weekdays.map((weekday) => ({ weekday, options: [availabilityOption] }));
  const availability = {
    providerId,
    scheduleWeekId: periodId,
    isLocked: false,
    minShiftsRequested: 0,
    maxShiftsRequested: 5,
    days,
  };
  const api = {
    getProviderWeeklyAvailability: mock.fn(async () => availability),
    publishScheduleVersion: mock.fn(async (id) => ({
      version: { ...detail.version, id, status: "published", published_at: timestamp },
      violations: [],
    })),
    saveDraftScheduleVersion: mock.fn(async (payload) => ({
      ...detail,
      version: { ...detail.version, id: nextVersionId, version_number: 2, notes: payload.notes },
    })),
    ...apiOverrides,
  };
  const toast = { showToast: mock.fn(() => "toast-id"), dismissToast: mock.fn() };
  const router = { push: mock.fn() };
  const analytics = {
    captureScheduleWorkflowException: mock.fn(),
    trackScheduleDraftSaved: mock.fn(),
    trackScheduleGenerated: mock.fn(),
    trackSchedulePublished: mock.fn(),
  };
  const overrides = new Map([
    ["@/lib/api", api],
    ["@/lib/schemas/schedule", scheduleSchemas],
    ["@/lib/logrocket", analytics],
    ["@/components/ui/toast-provider", { useToast: () => toast }],
    ["next/navigation", { useRouter: () => router }],
    ["next/link", (props) => createElement("a", props)],
  ]);
  const { ScheduleWorkspace } = loadTsModule("components/schedules/schedule-workspace.tsx", overrides);
  const props = {
    initialVersionDetail: detail,
    initialTemplates: [],
    initialVersions: [detail.version],
    providers: [{
      id: providerId,
      display_name: "Provider A",
      is_active: true,
      provider_type: "doctor",
      credentialed_center_ids: [centerId],
      skill_room_type_ids: [],
    }],
    rooms: [{
      room: { id: roomId, name: "Room A", is_active: true, md_only: false, room_types: [] },
      center: { id: centerId, name: "Center A" },
    }],
    schedulePeriod: {
      id: periodId,
      name: "Test week",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      status: "draft",
      created_at: timestamp,
      updated_at: timestamp,
    },
    scheduleId: periodId,
  };
  const container = await renderComponent(context, ScheduleWorkspace, props);
  return { container, api, toast };
}

for (const shiftType of ["full_shift", "first_half"]) {
  test(`a saved ${shiftType} schedule publishes with no hard blockers`, async (context) => {
    const detail = versionDetail(shiftType);
    const { container, api, toast } = await setup(context, { detail });
    assert.match(container.textContent, /0 publish blockers/);
    if (shiftType === "first_half") {
      assert.match(container.textContent, /accommodating a shorter shift/);
    }
    assert.equal(button(container, "Publish saved draft").disabled, false);
    await click(button(container, "Publish saved draft"));
    assert.deepEqual(api.publishScheduleVersion.mock.calls[0].arguments, [versionId]);
    assert.equal(toast.showToast.mock.calls.at(-1).arguments[0].title, "Schedule published");
  });
}

for (const availabilityOption of ["none", "unset"]) {
  test(`${availabilityOption} availability still blocks publication`, async (context) => {
    const { container, api } = await setup(context, { availabilityOption });
    assert.equal(button(container, "Publish saved draft").disabled, true);
    await click(button(container, "Publish saved draft"));
    assert.equal(api.publishScheduleVersion.mock.callCount(), 0);
  });
}

test("an unassigned saved slot still blocks publication", async (context) => {
  const detail = versionDetail();
  detail.assignments[0].provider_id = null;
  const { container, api } = await setup(context, { detail });
  assert.equal(button(container, "Publish saved draft").disabled, true);
  await click(button(container, "Publish saved draft"));
  assert.equal(api.publishScheduleVersion.mock.callCount(), 0);
});

test("unsaved notes must be saved before publishing the new version", async (context) => {
  const { container, api } = await setup(context);
  await changeNotes(container, "Updated handoff notes");
  assert.match(container.textContent, /0 publish blockers/);
  assert.match(container.textContent, /Save draft before publishing these changes/);
  assert.equal(button(container, "Publish saved draft").disabled, true);
  await click(button(container, "Publish saved draft"));
  assert.equal(api.publishScheduleVersion.mock.callCount(), 0);

  await click(button(container, "Save draft"));
  assert.equal(api.saveDraftScheduleVersion.mock.calls[0].arguments[0].notes, "Updated handoff notes");
  assert.equal(button(container, "Publish saved draft").disabled, false);
  await click(button(container, "Publish saved draft"));
  assert.deepEqual(api.publishScheduleVersion.mock.calls[0].arguments, [nextVersionId]);
});

test("a failed save leaves unsaved changes blocked from publication", async (context) => {
  const saveDraftScheduleVersion = mock.fn(async () => {
    throw new Error("Save request failed");
  });
  const { container, api, toast } = await setup(context, { apiOverrides: { saveDraftScheduleVersion } });
  await changeNotes(container, "Unsaved notes");
  await click(button(container, "Save draft"));
  assert.equal(toast.showToast.mock.calls.at(-1).arguments[0].title, "Draft save failed");
  assert.equal(button(container, "Publish saved draft").disabled, true);
  await click(button(container, "Publish saved draft"));
  assert.equal(api.publishScheduleVersion.mock.callCount(), 0);
});

test("a valid shift edit cannot publish the previous saved assignment", async (context) => {
  const { container, api } = await setup(context);
  const editShiftButton = container.querySelector('button[aria-label="Edit shift type for Room A"]');
  assert.ok(editShiftButton);
  await click(editShiftButton);
  const shiftSelector = container.querySelector('select[aria-label="Shift type for Room A"]');
  await select(shiftSelector, "first_half");
  assert.match(container.textContent, /0 publish blockers/);
  assert.equal(button(container, "Publish saved draft").disabled, true);
  await click(button(container, "Publish saved draft"));
  assert.equal(api.publishScheduleVersion.mock.callCount(), 0);

  await select(shiftSelector, "full_shift");
  assert.equal(button(container, "Publish saved draft").disabled, false);
});

for (const operation of ["save", "generate"]) {
  test(`publication waits for a pending ${operation} even when the board matches its saved version`, async (context) => {
    const pending = Promise.withResolvers();
    const apiOverrides = operation === "save"
      ? { saveDraftScheduleVersion: mock.fn(() => pending.promise) }
      : { generateScheduleVersion: mock.fn(() => pending.promise) };
    const { container, api } = await setup(context, { apiOverrides });
    assert.equal(button(container, "Publish saved draft").disabled, false);
    const action = operation === "save" ? "Save draft" : "Solve - Strict";
    await click(button(container, action));
    assert.equal(button(container, "Publish saved draft").disabled, true);
    await click(button(container, "Publish saved draft"));
    assert.equal(api.publishScheduleVersion.mock.callCount(), 0);
    await act(async () => {
      pending.reject(new Error("Request failed"));
    });
    assert.equal(button(container, "Publish saved draft").disabled, false);
  });
}

test("availability must finish loading before publication", async (context) => {
  const pending = Promise.withResolvers();
  const getProviderWeeklyAvailability = mock.fn(() => pending.promise);
  const { container, api } = await setup(context, { apiOverrides: { getProviderWeeklyAvailability } });
  assert.equal(button(container, "Publish saved draft").disabled, true);
  await click(button(container, "Publish saved draft"));
  assert.equal(api.publishScheduleVersion.mock.callCount(), 0);
  await finishRequest(pending, {
    providerId,
    scheduleWeekId: periodId,
    isLocked: false,
    minShiftsRequested: 0,
    maxShiftsRequested: 5,
    days: [{ weekday: "monday", options: ["full_shift"] }],
  });
  assert.equal(button(container, "Publish saved draft").disabled, false);
});
