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
const solverBaseline = {
  center_weight: 4, shift_type_weight: 6, manager_hidden_weight: 5,
  below_minimum_weight: 10, above_maximum_weight: 15, balance_weight: 3,
  fairness_weight: 10, unfilled_weight: 100000,
};

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
      start_time: "07:00",
      end_time: "11:00",
      assignment_status: "draft",
      source: "manual",
      notes: null,
      created_at: timestamp,
      updated_at: timestamp,
    }],
    violations: [],
  });
}

async function setup(context, { detail = versionDetail(), availabilityOption = "full_shift", apiOverrides = {}, propsOverrides = {} } = {}) {
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
    getSolverSettings: mock.fn(async () => ({ weights: solverBaseline, baseline: solverBaseline, revision: 1 })),
    getSolverRuns: mock.fn(async () => []),
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
  const tuningPanel = loadTsModule("components/schedules/solver-tuning-panel.tsx", overrides);
  overrides.set("@/components/schedules/solver-tuning-panel", tuningPanel);
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
    ...propsOverrides,
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
    if (operation === "generate") {
      const payload = api.generateScheduleVersion.mock.calls[0].arguments[1];
      assert.deepEqual(payload.solver_weights, solverBaseline);
      assert.ok(Array.isArray(payload.assignments));
    }
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

test("the real board preserves wall clocks and metadata when saved repeatedly", async (context) => {
  const detail = versionDetail();
  detail.assignments[0].required_provider_type = "doctor";
  detail.assignments[0].shift_requirement_id = nextVersionId;
  detail.assignments[0].notes = "Preserve slot notes";
  detail.assignments[0].source = "solver";
  const { container, api } = await setup(context, { detail });

  for (let cycle = 0; cycle < 10; cycle += 1) {
    await changeNotes(container, `Round trip ${cycle}`);
    await click(button(container, "Save draft"));
    const payload = api.saveDraftScheduleVersion.mock.calls.at(-1).arguments[0];
    assert.equal(payload.assignments[0].schedule_date, "2026-09-14");
    assert.equal(payload.assignments[0].start_time, "07:00");
    assert.equal(payload.assignments[0].end_time, "11:00");
    assert.equal(payload.assignments[0].required_provider_type, "doctor");
    assert.equal(payload.assignments[0].shift_requirement_id, nextVersionId);
    assert.equal(payload.assignments[0].notes, "Preserve slot notes");
    assert.equal(payload.assignments[0].source, "solver");
  }
});

test("a roomless saved slot remains in the next board save", async (context) => {
  const detail = versionDetail();
  detail.assignments[0].room_id = null;
  const { container, api } = await setup(context, { detail });
  assert.match(container.textContent, /Center assignment \(no room\)/);
  assert.doesNotMatch(container.textContent, /Room is missing or inactive/);
  await changeNotes(container, "Retain unplaced slot");
  await click(button(container, "Save draft"));
  const payload = api.saveDraftScheduleVersion.mock.calls[0].arguments[0];
  assert.equal(payload.assignments.length, 1);
  assert.equal(payload.assignments[0].room_id, null);
});

function savedViolation(detail, constraintType, message, assignmentId = detail.assignments[0]?.id ?? null) {
  return scheduleSchemas.constraintViolationApiSchema.parse({
    id: crypto.randomUUID(),
    schedule_version_id: detail.version.id,
    assignment_id: assignmentId,
    severity: "hard_violation",
    constraint_type: constraintType,
    message,
    metadata_json: null,
    created_at: timestamp,
    updated_at: timestamp,
  });
}

test("roomless slots report an explicit template limitation and stay on the board", async (context) => {
  const detail = versionDetail();
  detail.assignments[0].room_id = null;
  const { container, toast } = await setup(context, { detail });
  const templateName = container.querySelector('input[type="text"]');
  assert.ok(templateName);
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  await act(async () => {
    descriptor.set.call(templateName, "Roomless template");
    templateName.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await click(button(container, "Save template"));
  const notification = toast.showToast.mock.calls.at(-1).arguments[0];
  assert.equal(notification.title, "Template save failed");
  assert.match(notification.description, /Assign a room to every slot/);
  assert.equal(container.querySelector("fieldset").disabled, false);
  assert.match(container.textContent, /Center assignment \(no room\)/);
});

test("backend-only assignment and schedule blockers remain visible and refresh after saving", async (context) => {
  const detail = versionDetail();
  detail.violations = [
    savedViolation(detail, "inactive_center_credential", "Credential expired before this slot."),
    savedViolation(detail, "insufficient_required_skill_level", "Skill A proficiency is too low."),
    savedViolation(detail, "insufficient_required_skill_level", "Skill B proficiency is too low."),
    savedViolation(detail, "coverage_incomplete", "Required coverage is incomplete.", null),
  ];
  const saveDraftScheduleVersion = mock.fn(async (payload) => ({
    ...detail,
    version: { ...detail.version, notes: payload.notes },
    violations: [],
  }));
  const { container } = await setup(context, { detail, apiOverrides: { saveDraftScheduleVersion } });
  assert.match(container.textContent, /4 publish blockers/);
  for (const violation of detail.violations) {
    assert.ok(container.querySelector("table").textContent.includes(violation.message));
  }
  assert.match(container.textContent, /Not publishable/);
  assert.equal(button(container, "Publish saved draft").disabled, true);

  await changeNotes(container, "Changed snapshot");
  assert.match(container.textContent, /Save draft to refresh backend validation/);
  assert.doesNotMatch(container.textContent, /Credential expired/);
  assert.equal(button(container, "Publish saved draft").disabled, true);
  await click(button(container, "Save draft"));
  assert.match(container.textContent, /0 publish blockers/);
  assert.equal(button(container, "Publish saved draft").disabled, false);
});

test("backend warnings stay visible without blocking publication", async (context) => {
  const detail = versionDetail();
  const violation = savedViolation(detail, "backend_warning", "Review the provider preference.");
  violation.severity = "warning";
  detail.violations = [violation];
  const { container } = await setup(context, { detail });
  assert.match(container.querySelector("table").textContent, /Review the provider preference/);
  assert.match(container.textContent, /0 publish blockers/);
  assert.equal(button(container, "Publish saved draft").disabled, false);
});

test("best-effort generation shows schedule blockers even with preserved unsolved slots", async (context) => {
  const generated = versionDetail();
  generated.assignments = [];
  generated.violations = [savedViolation(generated, "coverage_incomplete", "No eligible provider covers this slot.", null)];
  const generateScheduleVersion = mock.fn(async () => ({ ...generated, metrics: { solve_duration_ms: 12 }, is_feasible: false }));
  const { container } = await setup(context, { apiOverrides: { generateScheduleVersion } });
  await click(button(container, "Solve - Best Effort"));
  assert.match(container.querySelector("table").textContent, /No eligible provider covers this slot/);
  assert.match(container.textContent, /2 publish blockers/);
  assert.equal(button(container, "Publish saved draft").disabled, true);
});

function pickerOption(container) {
  const options = Array.from(container.querySelectorAll("button"));
  const option = options.find((candidate) => candidate.textContent.startsWith("Provider A") && !candidate.hasAttribute("aria-expanded"));
  assert.ok(option);
  return option;
}

test("clearing a saved assignment lets the working board reuse the provider", async (context) => {
  const detail = versionDetail();
  const nextSlot = { ...detail.assignments[0], id: crypto.randomUUID(), room_slot_id: crypto.randomUUID(), provider_id: null };
  detail.assignments.push(nextSlot);
  const checkProviderSlotEligibility = mock.fn(async () => ({ provider_id: providerId, is_eligible: true, violations: [] }));
  const { container } = await setup(context, { detail, apiOverrides: { checkProviderSlotEligibility } });

  const picker = container.querySelectorAll("button[aria-expanded]:not([aria-label])")[1];
  await click(picker);
  assert.equal(pickerOption(container).disabled, true);
  await click(button(container, "Clear"));
  await click(picker);
  assert.equal(pickerOption(container).disabled, false);
  await click(pickerOption(container));

  const payload = checkProviderSlotEligibility.mock.calls[0].arguments[0];
  assert.equal(payload.schedule_version_id, null);
  assert.equal(payload.assignment_id, null);
  assert.equal(payload.shift_requirement_id, null);
  assert.doesNotMatch(container.textContent, /Provider not assigned/);
  assert.equal(container.querySelectorAll("button[aria-expanded]:not([aria-label])")[1].textContent.startsWith("Provider A"), true);
});

for (const operation of ["save", "generate", "load", "provider check"]) {
  test(`${operation} serializes board edits and other operations until completion`, async (context) => {
    const pending = Promise.withResolvers();
    const detail = versionDetail();
    const otherVersion = { ...detail.version, id: nextVersionId, version_number: 2 };
    const apiOverrides = {
      saveDraftScheduleVersion: mock.fn(() => pending.promise),
      generateScheduleVersion: mock.fn(() => pending.promise),
      getScheduleVersion: mock.fn(() => pending.promise),
      checkProviderSlotEligibility: mock.fn(() => pending.promise),
    };
    const { container, api } = await setup(context, { detail, apiOverrides, propsOverrides: { initialVersions: [detail.version, otherVersion] } });
    await changeNotes(container, "Before request");
    const versionSelect = Array.from(container.querySelectorAll("select")).find((element) => Array.from(element.options).some((option) => option.value === nextVersionId));
    assert.ok(versionSelect);
    if (operation === "save") {
      await click(button(container, "Save draft"));
    } else if (operation === "generate") {
      await click(button(container, "Solve - Strict"));
    } else if (operation === "load") {
      await select(versionSelect, nextVersionId);
    } else {
      await click(container.querySelector("button[aria-expanded]:not([aria-label])"));
      await click(pickerOption(container));
    }

    assert.equal(container.querySelector("fieldset").disabled, true);
    assert.equal(versionSelect.matches(":disabled"), true);
    assert.equal(container.querySelector("textarea").matches(":disabled"), true);
    assert.equal(container.querySelector('button[aria-label="Edit shift type for Room A"]').matches(":disabled"), true);
    assert.equal(container.querySelectorAll('[draggable="true"]').length, 0);
    await click(button(container, "Clear"));
    await changeNotes(container, "Attempted pending edit");
    // Even duplicate selection events in the same operation cannot start another request.
    await select(versionSelect, nextVersionId);
    const requestCount = Object.values(apiOverrides).reduce((count, method) => count + method.mock.callCount(), 0);
    assert.equal(requestCount, 1);

    if (operation === "provider check") {
      await finishRequest(pending, { provider_id: providerId, is_eligible: true, violations: [] });
    } else {
      const completed = { ...detail, version: { ...detail.version, notes: "Before request" }, metrics: { solve_duration_ms: 1 }, is_feasible: true };
      await finishRequest(pending, completed);
    }
    assert.equal(container.querySelector("fieldset").disabled, false);
    assert.equal(container.querySelector("textarea").value, "Before request");
    assert.equal(button(container, "Clear").matches(":disabled"), false);
    assert.equal(api.publishScheduleVersion.mock.callCount(), 0);
    await changeNotes(container, "After request");
    assert.equal(container.querySelector("textarea").value, "After request");
  });
}
