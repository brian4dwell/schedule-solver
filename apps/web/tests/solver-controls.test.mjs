import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { useState } from "react";
import {
  act,
  button,
  click,
  createElement,
  loadTsModule,
  renderComponent,
} from "./helpers/render-component.mjs";

const { solverWeightsSchema } = loadTsModule("lib/schemas/solver-controls.ts");
const baseline = {
  center_weight: 4,
  shift_type_weight: 6,
  manager_hidden_weight: 5,
  below_minimum_weight: 10,
  above_maximum_weight: 15,
  balance_weight: 3,
  fairness_weight: 10,
  unfilled_weight: 100000,
};

async function changeNumber(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  );
  await act(async () => {
    descriptor.set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function setup(context, options = {}) {
  const defaults = options.defaults ?? baseline;
  const showToast = mock.fn();
  const savedWeights = mock.fn();
  const replayChanged = mock.fn();
  const saveSolverSettings = mock.fn(async (weights, revision) => ({
    weights,
    baseline,
    revision: revision + 1,
  }));
  const getSolverSettings =
    options.getSolverSettings ??
    mock.fn(async () => ({ weights: defaults, baseline, revision: 3 }));
  const getSolverRuns = mock.fn(async () => options.runs ?? []);
  const overrides = new Map([
    ["@/lib/api", { getSolverSettings, getSolverRuns, saveSolverSettings }],
    ["@/components/ui/toast-provider", { useToast: () => ({ showToast }) }],
  ]);
  const { SolverTuningPanel } = loadTsModule(
    "components/schedules/solver-tuning-panel.tsx",
    overrides,
  );
  function Harness() {
    const [weights, setWeights] = useState(null);
    const [replay, setReplay] = useState(null);
    savedWeights(weights);
    replayChanged(replay);
    return createElement(SolverTuningPanel, {
      periodId: "period-id",
      activeJobId: null,
      hasSavedVersion: true,
      refreshKey: 0,
      busy: false,
      weights,
      replay,
      onWeightsChange: setWeights,
      onReplayChange: setReplay,
    });
  }
  const container = await renderComponent(context, Harness, {});
  return {
    container,
    showToast,
    savedWeights,
    replayChanged,
    saveSolverSettings,
  };
}

test("tuning edits affect the next run and save shared defaults only explicitly", async (context) => {
  const { container, savedWeights, saveSolverSettings, showToast } =
    await setup(context);
  const input = container.querySelector("#solver-center_weight");
  await changeNumber(input, "8");
  assert.equal(savedWeights.mock.calls.at(-1).arguments[0].center_weight, 8);
  assert.equal(saveSolverSettings.mock.callCount(), 0);
  assert.match(container.textContent, /Organization 4 → Next run 8/);
  await click(button(container, "Save as organization default"));
  assert.equal(saveSolverSettings.mock.calls[0].arguments[0].center_weight, 8);
  assert.equal(saveSolverSettings.mock.calls[0].arguments[1], 3);
  assert.equal(showToast.mock.calls.at(-1).arguments[0].tone, "success");
});

test("invalid or empty numbers block generation settings without clamping", async (context) => {
  const { container, savedWeights } = await setup(context);
  const input = container.querySelector("#solver-center_weight");
  for (const invalid of ["", "9", "-1", "1.5"]) {
    await changeNumber(input, invalid);
    assert.equal(savedWeights.mock.calls.at(-1).arguments[0], null);
    assert.equal(input.value, invalid);
    assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.equal(
      button(container, "Save as organization default").disabled,
      true,
    );
  }
  await changeNumber(input, "0");
  assert.equal(savedWeights.mock.calls.at(-1).arguments[0].center_weight, 0);
  assert.match(container.textContent, /Influence disabled/);
});

test("organization reset and application baseline reset are distinct", async (context) => {
  const defaults = { ...baseline, center_weight: 7 };
  const { container, savedWeights, saveSolverSettings } = await setup(context, {
    defaults,
  });
  await click(button(container, "Reset to application baseline"));
  assert.equal(savedWeights.mock.calls.at(-1).arguments[0].center_weight, 4);
  await click(button(container, "Reset to organization default"));
  assert.equal(savedWeights.mock.calls.at(-1).arguments[0].center_weight, 7);
  assert.equal(saveSolverSettings.mock.callCount(), 0);
});

test("historical settings stay read-only while reuse and replay create pending settings", async (context) => {
  const run = {
    id: randomUUID(),
    weights: { ...baseline, center_weight: 2 },
    status: "completed",
    solver_status: "optimal",
    version_number: 2,
    schedule_version_id: randomUUID(),
    generation_mode: "best_effort",
    organization_revision: 2,
    configuration_source: "run_override",
    started_at: "2026-09-14T12:00:00Z",
    duration_ms: 10,
    can_replay: true,
    violation_messages: [],
    outcomes: null,
    runtime: {
      implementation_id: "solver-v1",
      ortools_version: "test",
      max_solve_seconds: 30,
      num_search_workers: 0,
      random_seed: 0,
    },
    input_fingerprint: "same-inputs",
    schema_version: 1,
  };
  const { container, savedWeights, replayChanged } = await setup(context, {
    runs: [run],
  });
  assert.match(container.textContent, /Settings not recorded for this version/);
  await click(button(container, "Use settings with current inputs"));
  assert.equal(savedWeights.mock.calls.at(-1).arguments[0].center_weight, 2);
  assert.equal(replayChanged.mock.calls.at(-1).arguments[0], null);
  await click(button(container, "Try different weights on the same inputs"));
  assert.equal(replayChanged.mock.calls.at(-1).arguments[0].id, run.id);
  await changeNumber(container.querySelector("#solver-center_weight"), "8");
  assert.equal(run.weights.center_weight, 2);
  assert.match(container.textContent, /Current board edits are not inputs/);
  await click(button(container, "Use current inputs instead"));
  assert.equal(replayChanged.mock.calls.at(-1).arguments[0], null);
});

test("failed settings load leaves generation unavailable and reports a toast", async (context) => {
  const getSolverSettings = mock.fn(async () => {
    throw new Error("Unavailable");
  });
  const { container, showToast, savedWeights } = await setup(context, {
    getSolverSettings,
  });
  assert.equal(savedWeights.mock.calls.at(-1).arguments[0], null);
  assert.equal(showToast.mock.calls.at(-1).arguments[0].tone, "error");
  assert.ok(button(container, "Retry loading defaults"));
});

test("weight boundary rejects invalid factors and coverage changes", () => {
  for (const value of [-1, 9, 1.5, "4", true]) {
    assert.equal(
      solverWeightsSchema.safeParse({ ...baseline, center_weight: value })
        .success,
      false,
    );
  }
  assert.equal(
    solverWeightsSchema.safeParse({ ...baseline, unfilled_weight: 0 }).success,
    false,
  );
  assert.equal(
    solverWeightsSchema.safeParse({ ...baseline, unknown_weight: 1 }).success,
    false,
  );
});
