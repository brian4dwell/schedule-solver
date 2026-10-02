import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { loadTsModule, renderComponent } from "./helpers/render-component.mjs";

const schemas = loadTsModule("lib/schemas/reports.ts");
const colorStyles = loadTsModule("components/reports/monthly-availability-colors.ts");
const overrides = new Map([
  ["@/lib/api", { getMonthlyAvailabilityReport: async () => { throw new Error("Unexpected reload"); } }],
  ["@/components/reports/weekly-availability-notes", { WeeklyAvailabilityNotes: () => null }],
  ["@/components/reports/monthly-availability-colors", colorStyles],
]);
const { MonthlyAvailabilityReport } = loadTsModule("components/reports/monthly-availability-report.tsx", overrides);
const periodId = randomUUID();

function assignment(color, centerName) {
  return {
    assignment_id: randomUUID(),
    schedule_period_id: periodId,
    schedule_period_name: "Week of May 4",
    schedule_version_id: randomUUID(),
    schedule_version_number: 1,
    schedule_version_status: "draft",
    center_id: randomUUID(),
    center_name: centerName,
    center_color: color,
    room_id: null,
    room_name: null,
    shift_type: "full_shift",
    schedule_date: "2026-05-04",
    start_time: "07:00",
    end_time: "15:00",
  };
}

function provider(name, assignments) {
  return {
    provider_id: randomUUID(),
    provider_display_name: name,
    schedule_period_id: periodId,
    schedule_period_name: "Week of May 4",
    options: ["full_shift"],
    min_shifts_requested: 1,
    max_shifts_requested: 4,
    notes: null,
    scheduled_assignments: assignments,
  };
}

test("scheduled assignment contract requires an explicit valid or unset center color", () => {
  const configured = assignment("#123abc", "Center A");
  assert.equal(schemas.monthlyScheduleAssignmentApiSchema.parse(configured).center_color, "#123abc");
  assert.equal(schemas.monthlyScheduleAssignmentApiSchema.parse(assignment(null, "Center A")).center_color, null);
  const invalid = { ...configured, center_color: "red" };
  assert.equal(schemas.monthlyScheduleAssignmentApiSchema.safeParse(invalid).success, false);
  const missing = { ...configured };
  delete missing.center_color;
  assert.equal(schemas.monthlyScheduleAssignmentApiSchema.safeParse(missing).success, false);
});

test("monthly report uses assignment center colors, preserves multiple centers and uncolored and available states", async (context) => {
  const providers = [
    provider("Purple Provider", [assignment("#800080", "Purple Center")]),
    provider("White Provider", [assignment("#ffffff", "White Center")]),
    provider("Unset Provider", [assignment(null, "Unset Center")]),
    provider("Split Provider", [assignment("#800080", "Purple Center"), assignment("#ff8800", "Orange Center")]),
    provider("Available Provider", []),
  ];
  const report = schemas.monthlyAvailabilityReportApiSchema.parse({
    year: 2026,
    month: 5,
    start_date: "2026-05-01",
    end_date: "2026-05-31",
    schedule_candidate_groups: [],
    days: [{ date: "2026-05-04", providers }],
  });
  const container = await renderComponent(context, MonthlyAvailabilityReport, { initialReport: report });
  const cards = container.querySelectorAll('.monthly-availability-day-cell .shadow-sm');
  assert.equal(cards.length, 5);
  assert.equal(cards[0].style.borderColor, "rgb(128, 0, 128)");
  assert.match(cards[0].style.backgroundColor, /color-mix/);
  assert.match(cards[0].style.backgroundColor, /10%/);
  assert.match(cards[0].querySelector('span[style]').style.backgroundColor, /25%/);
  assert.equal(cards[1].style.borderColor, "rgb(255, 255, 255)");
  assert.equal(cards[2].style.borderColor, "");
  assert.equal(cards[2].style.backgroundColor, "transparent");
  assert.match(cards[3].style.backgroundImage, /linear-gradient/);
  assert.match(cards[3].style.backgroundImage, /rgb\(128, 0, 128\)/);
  assert.match(cards[3].style.backgroundImage, /rgb\(255, 136, 0\)/);
  const markers = cards[3].querySelectorAll('p[style]');
  assert.equal(markers[0].style.borderLeftColor, "rgb(128, 0, 128)");
  assert.equal(markers[1].style.borderLeftColor, "rgb(255, 136, 0)");
  assert.ok(cards[4].classList.contains("bg-amber-50"));
  assert.equal(cards[4].getAttribute("style"), null);
  assert.equal(cards[0].textContent.includes("1–4"), true);
  assert.equal(cards[0].textContent.includes("Purple Center"), true);
});
