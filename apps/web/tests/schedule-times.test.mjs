import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadTsModule } from "./helpers/render-component.mjs";

if (process.env.SCHEDULE_TIME_TEST_CHILD !== "1") {
  for (const timezone of ["UTC", "America/Denver", "America/New_York", "Asia/Tokyo"]) {
    test(`schedule round trips and board saves in ${timezone}`, () => {
      const environment = { ...process.env, TZ: timezone, SCHEDULE_TIME_TEST_CHILD: "1" };
      delete environment.NODE_TEST_CONTEXT;
      const filename = fileURLToPath(import.meta.url);
      const result = spawnSync(process.execPath, ["--test", filename, "tests/schedule-publication.test.mjs"], {
        env: environment,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /ten save\/load cycles preserve dates, clocks, roomless slots, and requirements/);
      assert.match(result.stdout, /the real board preserves wall clocks and metadata when saved repeatedly/);
    });
  }
} else {
  const schemas = loadTsModule("lib/schemas/schedule.ts");
  const timeSchemas = loadTsModule("lib/schemas/schedule-time.ts");
  const { assignmentSavePayload, formatScheduleClock, providerHasTimeConflict } = loadTsModule("lib/schedule-time.ts");
  const id = "00000000-0000-4000-8000-000000000001";
  const otherId = "00000000-0000-4000-8000-000000000002";

  function slot(overrides = {}) {
    return schemas.scheduleRoomAssignmentSchema.parse({
      id,
      dayKey: "thursday",
      slotDate: "2026-11-05",
      slotDateChanged: false,
      centerId: id,
      roomId: null,
      shiftRequirementId: otherId,
      requiredProviderType: "doctor",
      source: "solver",
      notes: "Preserve this requirement",
      providerId: id,
      shiftType: "full_shift",
      startTime: "07:00",
      endTime: "15:00",
      sortOrder: 0,
      validationStatus: "valid",
      validationMessages: [],
      ...overrides,
    });
  }

  test("ten save/load cycles preserve dates, clocks, roomless slots, and requirements", () => {
    for (const day of ["2026-03-07", "2026-03-08", "2026-03-09", "2026-10-31", "2026-11-01", "2026-11-02"]) {
      for (const [start, end] of [["07:00", "15:00"], ["22:00", "23:59"]]) {
        let assignment = slot({ slotDate: day, startTime: start, endTime: end });

        for (let cycle = 0; cycle < 10; cycle += 1) {
          const payload = assignmentSavePayload(assignment);
          const serialized = JSON.stringify(payload);
          const parsed = schemas.scheduleAssignmentSavePayloadSchema.parse(JSON.parse(serialized));
          assert.equal(parsed.schedule_date, day);
          assert.equal(parsed.start_time, start);
          assert.equal(parsed.end_time, end);
          assert.equal(parsed.room_id, null);
          assert.equal(parsed.shift_requirement_id, otherId);
          assert.equal(parsed.required_provider_type, "doctor");
          assert.equal(parsed.notes, "Preserve this requirement");
          assert.equal(parsed.source, "solver");
          assignment = slot({ slotDate: parsed.schedule_date, startTime: parsed.start_time, endTime: parsed.end_time });
        }
      }
    }
  });

  test("boundary schemas reject datetime payloads and invalid ranges", () => {
    for (const start of ["2026-11-05T07:00:00", "2026-11-05T07:00:00Z", "07:00:00", "07:00Z", "24:00", "7:00"]) {
      assert.equal(timeSchemas.wallClockSchema.safeParse(start).success, false);
    }
    assert.throws(() => assignmentSavePayload(slot({ startTime: "15:00", endTime: "07:00" })));
    assert.throws(() => assignmentSavePayload(slot({ endTime: "07:00" })));
    assert.throws(() => slot({ slotDate: "2026-02-30" }));
  });

  test("template clocks and report labels have no timezone conversion", () => {
    const template = schemas.scheduleStructureTemplateSlotPayloadSchema.parse({
      weekday: "thursday", room_id: id, shift_type: "full_shift", start_time: "07:00", end_time: "15:00", display_order: 0,
    });
    assert.equal(template.start_time, "07:00");
    assert.equal(formatScheduleClock(template.start_time), "7:00 AM");
    assert.equal(formatScheduleClock(template.end_time), "3:00 PM");
    assert.equal(formatScheduleClock("00:00"), "12:00 AM");
    assert.equal(formatScheduleClock("23:59"), "11:59 PM");
  });

  test("same-day constraints allow only a non-overlapping split pair at one center", () => {
    const first = slot({ shiftType: "first_half", endTime: "11:00" });
    const second = slot({ id: otherId, shiftType: "second_half", startTime: "11:00" });
    assert.equal(providerHasTimeConflict([first], second, id), false);
    assert.equal(providerHasTimeConflict([first], { ...second, startTime: "10:00" }, id), true);
    assert.equal(providerHasTimeConflict([first], { ...second, centerId: otherId }, id), true);
    assert.equal(providerHasTimeConflict([{ ...first, shiftType: "full_shift" }], { ...second, shiftType: "full_shift" }, id), true);
    assert.equal(providerHasTimeConflict([first, { ...first, id: "third" }], second, id), true);
    assert.equal(providerHasTimeConflict([first], { ...second, slotDate: "2026-11-06" }, id), false);
  });
}
