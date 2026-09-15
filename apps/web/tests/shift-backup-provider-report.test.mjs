import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { act, button, click, finishRequest, loadTsModule, renderComponent, select } from "./helpers/render-component.mjs";
import { addBookedCandidate, backupFixture } from "./helpers/shift-backup-fixtures.mjs";

const schemas = loadTsModule("lib/schemas/reports.ts");

async function enterDate(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  await act(async () => {
    descriptor.set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function setup(context, fixture = backupFixture()) {
  const showToast = mock.fn();
  const getShiftBackupReportOptions = mock.fn(async () => fixture.options);
  const getShiftBackupProviderReport = mock.fn(async () => fixture.report);
  const overrides = new Map([
    ["@/lib/api", { getShiftBackupReportOptions, getShiftBackupProviderReport }],
    ["@/components/ui/toast-provider", { useToast: () => ({ showToast }) }],
  ]);
  const components = loadTsModule("components/reports/shift-backup-provider-report.tsx", overrides);
  const container = await renderComponent(context, components.ShiftBackupProviderReportWorkspace, {});
  return { container, showToast, getShiftBackupReportOptions, getShiftBackupProviderReport, components, fixture };
}

async function loadChoices(view) {
  const dates = view.container.querySelectorAll('input[type="date"]');
  await enterDate(dates[0], "2026-09-14");
  await enterDate(dates[1], "2026-09-20");
  await click(button(view.container, "Load schedule choices"));
}

async function generate(view) {
  await loadChoices(view);
  await select(view.container.querySelector("select"), view.fixture.options.periods[0].versions[0].id);
  await click(button(view.container, "Generate report"));
}

test("valid dates and explicit version choices are required", async (context) => {
  const view = await setup(context);
  await click(button(view.container, "Load schedule choices"));
  assert.match(view.container.textContent, /Enter valid dates/);
  assert.equal(view.getShiftBackupReportOptions.mock.callCount(), 0);
  await loadChoices(view);
  assert.equal(button(view.container, "Generate report").disabled, true);
  await select(view.container.querySelector("select"), view.fixture.options.periods[0].versions[0].id);
  await click(button(view.container, "Generate report"));
  assert.deepEqual(view.getShiftBackupProviderReport.mock.calls[0].arguments[0], {
    start_date: "2026-09-14", end_date: "2026-09-20", center_id: null,
    selected_version_ids: [view.fixture.options.periods[0].versions[0].id], excluded_period_ids: [],
  });
  assert.match(view.container.textContent, /Assigned Provider: Unassigned/);
});

test("excluded competing periods and Center row filters are explicit", async (context) => {
  const fixture = backupFixture();
  const alternative = { ...fixture.options.periods[0], id: randomUUID(), name: "Alternative", versions: [] };
  fixture.options.periods.push(alternative);
  const view = await setup(context, fixture);
  await loadChoices(view);
  const selectors = view.container.querySelectorAll("select");
  await select(selectors[0], fixture.options.periods[0].versions[0].id);
  assert.equal(button(view.container, "Generate report").disabled, true);
  await select(selectors[1], "exclude");
  await select(selectors[2], fixture.options.centers[0].id);
  await click(button(view.container, "Generate report"));
  const request = view.getShiftBackupProviderReport.mock.calls[0].arguments[0];
  assert.deepEqual(request.excluded_period_ids, [alternative.id]);
  assert.equal(request.center_id, fixture.options.centers[0].id);
});

test("booked candidates and warnings are labeled with current-data basis and local clocks", async (context) => {
  const fixture = backupFixture();
  addBookedCandidate(fixture.report);
  const view = await setup(context, fixture);
  await generate(view);
  const results = view.container.querySelector(".shift-backup-results");
  assert.match(results.textContent, /Available replacement/);
  assert.match(results.textContent, /Qualified but already scheduled/);
  assert.match(results.textContent, /West Center/);
  assert.match(results.textContent, /08:00–16:00 · America\/Chicago/);
  assert.match(results.textContent, /Warning: Provider is over the maximum/);
  assert.match(results.textContent, /v2 · published/);
  assert.match(results.textContent, /Generated 2026-09-14 13:30:00Z/);
  assert.match(results.textContent, /does not reconstruct eligibility at publication/);
});

test("selection changes invalidate printing and late generation results", async (context) => {
  const view = await setup(context);
  await generate(view);
  const pending = Promise.withResolvers();
  view.getShiftBackupProviderReport.mock.mockImplementation(() => pending.promise);
  await click(button(view.container, "Generate report"));
  assert.equal(view.container.querySelector(".shift-backup-results"), null);
  assert.equal(button(view.container, "Print / Save as PDF").disabled, true);
  await select(view.container.querySelector("select"), "exclude");
  await finishRequest(pending, view.fixture.report);
  assert.equal(view.container.querySelector(".shift-backup-results"), null);
  assert.equal(button(view.container, "Print / Save as PDF").disabled, true);
});

test("changed dates reject a pending options response", async (context) => {
  const view = await setup(context);
  const pending = Promise.withResolvers();
  view.getShiftBackupReportOptions.mock.mockImplementation(() => pending.promise);
  await loadChoices(view);
  await enterDate(view.container.querySelector('input[type="date"]'), "2026-09-15");
  await finishRequest(pending, view.fixture.options);
  assert.equal(view.container.querySelector("select"), null);
});

test("failed regeneration clears stale results and shows a toast", async (context) => {
  const view = await setup(context);
  await generate(view);
  view.getShiftBackupProviderReport.mock.mockImplementation(async () => { throw new Error("Credentials changed; retry"); });
  await click(button(view.container, "Generate report"));
  assert.equal(view.container.querySelector(".shift-backup-results"), null);
  assert.equal(button(view.container, "Print / Save as PDF").disabled, true);
  assert.equal(view.showToast.mock.calls[0].arguments[0].tone, "error");
});

test("empty candidate lists, blocked shifts, and empty results are distinct", async (context) => {
  const fixture = backupFixture(0);
  const view = await setup(context, fixture);
  await generate(view);
  assert.match(view.container.textContent, /No eligible replacements/);
  fixture.report.shifts[0].blockers = [{ severity: "hard_violation", category: "other_hard_constraint", constraint_type: "inactive_room", message: "Room is inactive." }];
  view.getShiftBackupProviderReport.mock.mockImplementation(async () => structuredClone(fixture.report));
  await click(button(view.container, "Generate report"));
  assert.match(view.container.textContent, /Cannot evaluate replacements/);
  assert.doesNotMatch(view.container.textContent, /No eligible replacements/);
  fixture.report.shifts = [];
  fixture.report.excluded_periods = [{ id: randomUUID(), name: "Excluded week", start_date: "2026-09-14", end_date: "2026-09-20" }];
  await click(button(view.container, "Generate report"));
  assert.match(view.container.textContent, /No shifts match/);
  assert.match(view.container.textContent, /Explicitly excluded periodsExcluded week/);
});

test("printing includes all candidates without converting local clocks or rendering markup", async (context) => {
  const fixture = backupFixture(80);
  fixture.report.shifts[0].available_replacements[0].display_name = "<script>Long Provider Name</script>";
  const print = context.mock.method(window, "print", () => {});
  const view = await setup(context, fixture);
  await generate(view);
  const results = view.container.querySelector(".shift-backup-results");
  assert.equal(results.querySelectorAll("tbody tr").length, 80);
  assert.equal(results.querySelector("script"), null);
  assert.match(results.textContent, /Replacement Provider 80/);
  assert.match(results.textContent, /07:00–15:00 · America\/New_York/);
  await click(button(view.container, "Print / Save as PDF"));
  assert.equal(print.mock.callCount(), 1);
});

test("contracts require conflict details and ordered date ranges", () => {
  const fixture = backupFixture();
  addBookedCandidate(fixture.report);
  assert.deepEqual(schemas.shiftBackupProviderReportSchema.parse(fixture.report), fixture.report);
  assert.deepEqual(schemas.backupReportOptionsSchema.parse(fixture.options), fixture.options);
  delete fixture.report.shifts[0].qualified_but_scheduled[0].conflicts[0].violations;
  assert.equal(schemas.shiftBackupProviderReportSchema.safeParse(fixture.report).success, false);
  assert.equal(schemas.backupReportDateRangeSchema.safeParse({ start_date: "2026-09-20", end_date: "2026-09-14" }).success, false);
});
