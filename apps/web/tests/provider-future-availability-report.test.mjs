import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { useSyncExternalStore } from "react";

import { act, button, click, finishRequest, loadTsModule, renderComponent, select } from "./helpers/render-component.mjs";

const schemas = loadTsModule("lib/schemas/reports.ts");
const providers = [
  { id: randomUUID(), display_name: "Avery", provider_type: "doctor", employment_type: "employee", is_active: true },
  { id: randomUUID(), display_name: "Blake", provider_type: "crna", employment_type: "contractor", is_active: false },
];
const reportPath = "/reports/provider-future-availability";

function reportFor(provider = providers[0], notes = "Line one\n<script>plain text</script>") {
  return {
    provider,
    cutoff_date: "2026-12-31",
    timezone: "America/New_York",
    weeks: [{
      schedule_period_id: randomUUID(),
      name: "New year week",
      start_date: "2026-12-28",
      end_date: "2027-01-03",
      status: "published",
      has_submission: true,
      is_complete: true,
      unset_weekdays: [],
      min_shifts_requested: 1.5,
      max_shifts_requested: 2.5,
      notes,
      days: [
        { date: "2026-12-31", weekday: "thursday", options: ["first_half", "second_half", "short_shift"], is_saved: true },
        { date: "2027-01-01", weekday: "friday", options: ["none"], is_saved: true },
      ],
    }],
  };
}

function subscribeToUrl(callback) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

function useSearchParams() {
  const search = useSyncExternalStore(subscribeToUrl, () => window.location.search);
  return new URLSearchParams(search);
}

async function setup(context, getReport, providerId = null) {
  const initialUrl = providerId === null ? reportPath : `${reportPath}?provider_id=${providerId}`;
  window.history.replaceState(null, "", initialUrl);
  const pushState = window.history.pushState.bind(window.history);
  context.mock.method(window.history, "pushState", (...args) => {
    pushState(...args);
    window.dispatchEvent(new window.PopStateEvent("popstate"));
  });
  const showToast = mock.fn();
  const getProviderFutureAvailabilityReport = mock.fn(getReport);
  const overrides = new Map([
    ["@/lib/api", { getProviderFutureAvailabilityReport }],
    ["@/components/ui/toast-provider", { useToast: () => ({ showToast }) }],
    ["next/navigation", { useSearchParams, usePathname: () => reportPath }],
  ]);
  const { ProviderFutureAvailabilityReport } = loadTsModule("components/reports/provider-future-availability-report.tsx", overrides);
  const container = await renderComponent(context, ProviderFutureAvailabilityReport, { providers });
  return { container, showToast, getProviderFutureAvailabilityReport };
}

test("selection is searchable, includes inactive Providers, and persists in the URL", async (context) => {
  const view = await setup(context, async (id) => reportFor(providers.find((provider) => provider.id === id)));
  assert.match(view.container.textContent, /Select a Provider to view/);
  assert.equal(view.getProviderFutureAvailabilityReport.mock.callCount(), 0);
  const input = view.container.querySelector('input[type="search"]');
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  await act(async () => {
    descriptor.set.call(input, "blake");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  assert.equal(view.container.querySelectorAll("option").length, 2);
  await select(view.container.querySelector("select"), providers[1].id);
  assert.equal(new URLSearchParams(window.location.search).get("provider_id"), providers[1].id);
  assert.match(view.container.querySelector("h2").textContent, /Blake.*Inactive/);
  assert.equal(view.getProviderFutureAvailabilityReport.mock.calls[0].arguments[0], providers[1].id);
  await select(view.container.querySelector("select"), "");
  assert.equal(window.location.search, "");
  assert.match(view.container.textContent, /Select a Provider to view/);
});

test("URL selection renders dates unchanged, full-week requests, multiple options, and plain text notes", async (context) => {
  const note = "<script>plain text</script>\n" + "x".repeat(1972);
  const report = reportFor(providers[0], note);
  const view = await setup(context, async () => report, providers[0].id);
  const text = view.container.textContent;
  assert.match(text, /Today and later: 2026-12-31 \(America\/New_York\)/);
  assert.match(text, /2026-12-28 – 2027-01-03/);
  assert.match(text, /Requested shifts for the entire week: minimum 1.5, maximum 2.5/);
  assert.match(text, /First half, Second half, Short shift/);
  assert.match(text, /published/);
  assert.match(text, /Complete/);
  assert.match(text, /2027-01-01/);
  assert.equal(view.container.querySelectorAll("tbody tr").length, 2);
  assert.equal(view.container.querySelectorAll("script, textarea").length, 0);
  const noteElement = view.container.querySelector(".whitespace-pre-wrap");
  assert.equal(noteElement.textContent, note);
  assert.match(noteElement.className, /overflow-wrap:anywhere/);
});

test("overlapping weeks keep independent notes and missing submissions differ from saved none", async (context) => {
  const report = reportFor();
  const missingWeek = {
    ...report.weeks[0],
    schedule_period_id: randomUUID(),
    name: "Draft overlap",
    status: "draft",
    has_submission: false,
    is_complete: false,
    unset_weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    notes: "Only a note was saved",
    days: [{ date: "2026-12-31", weekday: "thursday", options: ["unset"], is_saved: false }],
  };
  report.weeks.push(missingWeek);
  const view = await setup(context, async () => report, providers[0].id);
  assert.equal(view.container.querySelectorAll("table").length, 2);
  assert.match(view.container.textContent, /Only a note was saved/);
  assert.match(view.container.textContent, /Not submitted/);
  assert.match(view.container.textContent, /Unset/);
  const rows = view.container.querySelectorAll("tbody tr");
  assert.match(rows[1].textContent, /None/);
  assert.doesNotMatch(rows[1].textContent, /Not submitted/);
  assert.match(rows[2].textContent, /UnsetNot submitted/);
});

test("refresh shows cleared notes and an empty result explains missing future weeks", async (context) => {
  const view = await setup(context, async () => reportFor(), providers[0].id);
  view.getProviderFutureAvailabilityReport.mock.mockImplementation(async () => reportFor(providers[0], null));
  await click(button(view.container, "Refresh"));
  assert.match(view.container.textContent, /No notes for this week/);
  const empty = { ...reportFor(), weeks: [] };
  view.getProviderFutureAvailabilityReport.mock.mockImplementation(async () => empty);
  await click(button(view.container, "Refresh"));
  assert.match(view.container.textContent, /No upcoming schedule weeks/);
  assert.equal(view.container.querySelector("table"), null);
});

test("switching Providers while requests are pending cannot display the earlier response", async (context) => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const view = await setup(context, (id) => id === providers[0].id ? first.promise : second.promise, providers[0].id);
  await select(view.container.querySelector("select"), providers[1].id);
  assert.match(view.container.textContent, /Loading report/);
  await finishRequest(second, reportFor(providers[1], "Blake note"));
  await finishRequest(first, reportFor(providers[0], "Avery note"));
  assert.match(view.container.querySelector("h2").textContent, /Blake/);
  assert.match(view.container.textContent, /Blake note/);
  assert.doesNotMatch(view.container.textContent, /Avery note/);
});

test("failed refresh removes stale data and reports failure through a toast", async (context) => {
  const view = await setup(context, async () => reportFor(), providers[0].id);
  const pending = Promise.withResolvers();
  view.getProviderFutureAvailabilityReport.mock.mockImplementation(() => pending.promise);
  await click(button(view.container, "Refresh"));
  assert.equal(view.container.querySelector("table"), null);
  assert.equal(button(view.container, "Refresh").disabled, true);
  await act(async () => pending.reject(new Error("Connection failed")));
  assert.equal(view.container.querySelector("table"), null);
  assert.match(view.container.textContent, /Report unavailable/);
  assert.equal(button(view.container, "Refresh").disabled, false);
  assert.equal(view.showToast.mock.calls[0].arguments[0].tone, "error");
});

test("a rejected old request is ignored after URL navigation", async (context) => {
  const first = Promise.withResolvers();
  const view = await setup(context, (id) => id === providers[0].id ? first.promise : reportFor(providers[1]), providers[0].id);
  await act(async () => {
    window.history.replaceState(null, "", `${reportPath}?provider_id=${providers[1].id}`);
    window.dispatchEvent(new window.PopStateEvent("popstate"));
  });
  await act(async () => first.reject(new Error("Old request failed")));
  assert.match(view.container.querySelector("h2").textContent, /Blake/);
  assert.equal(view.showToast.mock.callCount(), 0);
});

test("inaccessible URL selections show a failure without another Provider's data", async (context) => {
  const view = await setup(context, async () => { throw new Error("Provider not found"); }, randomUUID());
  assert.match(view.container.textContent, /Unavailable Provider/);
  assert.match(view.container.textContent, /Report unavailable/);
  assert.equal(view.container.querySelector("h2"), null);
  assert.equal(view.showToast.mock.callCount(), 1);
});

test("report contract validates dates, notes, half shifts, and missing submission metadata", () => {
  const report = reportFor();
  assert.deepEqual(schemas.providerFutureAvailabilityReportApiSchema.parse(report), report);
  const invalidDate = { ...report, cutoff_date: "2026-02-30" };
  assert.equal(schemas.providerFutureAvailabilityReportApiSchema.safeParse(invalidDate).success, false);
  const invalidNotes = reportFor(providers[0], "x".repeat(2001));
  assert.equal(schemas.providerFutureAvailabilityReportApiSchema.safeParse(invalidNotes).success, false);
  report.weeks[0].min_shifts_requested = 1.25;
  assert.equal(schemas.providerFutureAvailabilityReportApiSchema.safeParse(report).success, false);
  const missingNotes = reportFor();
  delete missingNotes.weeks[0].notes;
  assert.equal(schemas.providerFutureAvailabilityReportApiSchema.safeParse(missingNotes).success, false);
  const missingSavedState = reportFor();
  delete missingSavedState.weeks[0].days[0].is_saved;
  assert.equal(schemas.providerFutureAvailabilityReportApiSchema.safeParse(missingSavedState).success, false);
});
