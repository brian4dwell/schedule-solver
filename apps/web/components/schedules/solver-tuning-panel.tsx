"use client";

import { useEffect, useRef, useState } from "react";
import {
  getSolverRuns,
  getSolverSettings,
  saveSolverSettings,
} from "@/lib/api";
import { useToast } from "@/components/ui/toast-provider";
import {
  solverControls,
  solverFactorLabel,
  solverWeightsSchema,
  type SolverOutcomes,
  type SolverRun,
  type SolverSettings,
  type SolverWeights,
} from "@/lib/schemas/solver-controls";

type WeightFields = { [Key in keyof SolverWeights]: string };

type Props = {
  periodId: string;
  activeJobId: string | null;
  hasSavedVersion: boolean;
  refreshKey: number;
  busy: boolean;
  weights: SolverWeights | null;
  replay: SolverRun | null;
  onWeightsChange: (weights: SolverWeights | null) => void;
  onReplayChange: (run: SolverRun | null) => void;
};

const buttonClass =
  "rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function weightFields(weights: SolverWeights): WeightFields {
  return {
    center_weight: String(weights.center_weight),
    shift_type_weight: String(weights.shift_type_weight),
    manager_hidden_weight: String(weights.manager_hidden_weight),
    below_minimum_weight: String(weights.below_minimum_weight),
    above_maximum_weight: String(weights.above_maximum_weight),
    balance_weight: String(weights.balance_weight),
    fairness_weight: String(weights.fairness_weight),
    unfilled_weight: String(weights.unfilled_weight),
  };
}

function inputNumber(value: string): number {
  if (value.trim() === "") {
    return Number.NaN;
  }
  return Number(value);
}

function parseFields(fields: WeightFields) {
  return solverWeightsSchema.safeParse({
    center_weight: inputNumber(fields.center_weight),
    shift_type_weight: inputNumber(fields.shift_type_weight),
    manager_hidden_weight: inputNumber(fields.manager_hidden_weight),
    below_minimum_weight: inputNumber(fields.below_minimum_weight),
    above_maximum_weight: inputNumber(fields.above_maximum_weight),
    balance_weight: inputNumber(fields.balance_weight),
    fairness_weight: inputNumber(fields.fairness_weight),
    unfilled_weight: inputNumber(fields.unfilled_weight),
  });
}

function comparableRuns(first: SolverRun, second: SolverRun): boolean {
  const sameInputs =
    first.input_fingerprint !== null &&
    first.input_fingerprint === second.input_fingerprint;
  const sameMode = first.generation_mode === second.generation_mode;
  const sameRuntime =
    JSON.stringify(first.runtime) === JSON.stringify(second.runtime);
  return sameInputs && sameMode && sameRuntime && second.outcomes !== null;
}

function preferenceText(outcome: SolverOutcomes["center_preferences"]): string {
  const specified = outcome.positive + outcome.negative + outcome.neutral;
  return `${outcome.positive} positive / ${specified} specified; ${outcome.negative} avoided, ${outcome.neutral} neutral, ${outcome.missing} missing`;
}

function RunOutcomes({
  run,
  previous,
}: {
  run: SolverRun;
  previous: SolverRun | null;
}) {
  const outcome = run.outcomes;
  if (outcome === null) {
    return (
      <p className="text-sm text-slate-600">
        No solution measurements recorded for this attempt.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">
        Filled: <strong>{outcome.assigned_count}</strong> · Unfilled:{" "}
        <strong>{outcome.unfilled_count}</strong> · Providers below minimum:{" "}
        <strong>{outcome.below_minimum_provider_count}</strong> · Above maximum:{" "}
        <strong>{outcome.above_maximum_provider_count}</strong>
      </p>
      <ul className="space-y-1 text-xs text-slate-600">
        <li>
          Center preferences: {preferenceText(outcome.center_preferences)}
        </li>
        <li>
          Shift-type preferences: {preferenceText(outcome.shift_preferences)}
        </li>
        <li>
          Manager preferences: {preferenceText(outcome.manager_preferences)}
        </li>
      </ul>
      {previous?.outcomes ? (
        <p className="text-xs text-teal-800">
          Same inputs and runtime as{" "}
          {previous.version_number === null
            ? "previous attempt"
            : `version ${previous.version_number}`}
          : unfilled change{" "}
          {outcome.unfilled_count - previous.outcomes.unfilled_count}; Providers
          below minimum change{" "}
          {outcome.below_minimum_provider_count -
            previous.outcomes.below_minimum_provider_count}
          ; above maximum change{" "}
          {outcome.above_maximum_provider_count -
            previous.outcomes.above_maximum_provider_count}
          .
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          No earlier measured run with matching inputs, mode, and runtime is
          loaded.
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          Factor breakdown
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b">
                <th className="py-2">Factor</th>
                <th>Raw units / points</th>
                <th>Weight</th>
                <th>Contribution</th>
                {previous ? <th>Raw change</th> : null}
              </tr>
            </thead>
            <tbody>
              {outcome.factors.map((factor) => {
                const prior = previous?.outcomes?.factors.find(
                  (candidate) => candidate.factor === factor.factor,
                );
                const delta =
                  prior === undefined
                    ? null
                    : factor.raw_value - prior.raw_value;
                return (
                  <tr key={factor.factor} className="border-b border-slate-100">
                    <td className="py-2">{solverFactorLabel(factor.factor)}</td>
                    <td>{factor.raw_value.toLocaleString()}</td>
                    <td>{factor.weight}</td>
                    <td>{factor.contribution.toLocaleString()}</td>
                    {previous ? (
                      <td>{delta === null ? "—" : delta.toLocaleString()}</td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Workload uses half-shift units; balance sums differences between
          Provider pairs. Fairness is rounded per Provider before multiplying
          workload. Total score: {run.solver_score?.toLocaleString()}. Compare
          schedule outcomes when weights differ, since total scores use
          different scoring rules.
        </p>
      </details>
    </div>
  );
}

export function SolverTuningPanel({
  periodId,
  activeJobId,
  hasSavedVersion,
  refreshKey,
  busy,
  weights,
  replay,
  onWeightsChange,
  onReplayChange,
}: Props) {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<SolverSettings | null>(null);
  const [fields, setFields] = useState<WeightFields | null>(null);
  const [runs, setRuns] = useState<SolverRun[]>([]);
  const [selection, setSelection] = useState<{
    runId: string | null;
    jobContext: string | null;
  }>({ runId: null, jobContext: activeJobId });
  const [loadingError, setLoadingError] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const previousRefresh = useRef(refreshKey);

  useEffect(() => {
    let cancelled = false;
    getSolverSettings()
      .then((response) => {
        if (cancelled) return;
        setSettings(response);
        setFields(weightFields(response.weights));
        onWeightsChange(response.weights);
        setLoadingError(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadingError(true);
        onWeightsChange(null);
        const description =
          error instanceof Error
            ? error.message
            : "Unable to load solver settings.";
        showToast({
          title: "Solver settings unavailable",
          description,
          tone: "error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, onWeightsChange, showToast]);

  useEffect(() => {
    let cancelled = false;
    const newAttempt = previousRefresh.current !== refreshKey;
    previousRefresh.current = refreshKey;
    getSolverRuns(periodId)
      .then((response) => {
        if (cancelled) return;
        setRuns(response);
        const latestRunId = newAttempt ? (response[0]?.id ?? null) : null;
        setSelection({ runId: latestRunId, jobContext: activeJobId });
        setHasMore(response.length === 50);
        setHistoryError(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setHistoryError(true);
        const description =
          error instanceof Error
            ? error.message
            : "Unable to load run history.";
        showToast({
          title: "Run history unavailable",
          description,
          tone: "error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [periodId, refreshKey, reloadKey, showToast, activeJobId]);

  function loadWeights(nextWeights: SolverWeights) {
    setFields(weightFields(nextWeights));
    onWeightsChange(nextWeights);
  }

  function changeField(key: keyof SolverWeights, value: string) {
    if (fields === null) return;
    const nextFields = { ...fields, [key]: value };
    setFields(nextFields);
    const parsed = parseFields(nextFields);
    onWeightsChange(parsed.success ? parsed.data : null);
  }

  async function saveDefault() {
    if (weights === null || settings === null) return;
    setSaving(true);
    try {
      const response = await saveSolverSettings(weights, settings.revision);
      setSettings(response);
      showToast({
        title: "Organization solver defaults saved",
        tone: "success",
      });
    } catch (error) {
      const description =
        error instanceof Error ? error.message : "Unable to save defaults.";
      showToast({ title: "Defaults not saved", description, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function loadOlderRuns() {
    setLoadingOlder(true);
    try {
      const older = await getSolverRuns(periodId, runs.length);
      setRuns((current) => [...current, ...older]);
      setHasMore(older.length === 50);
    } catch (error) {
      const description =
        error instanceof Error ? error.message : "Unable to load older runs.";
      showToast({
        title: "Run history unavailable",
        description,
        tone: "error",
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  const activeRun = runs.find((run) => run.id === activeJobId);
  const selectedRunId =
    selection.jobContext === activeJobId ? selection.runId : null;
  const selectedRun =
    runs.find((run) => run.id === selectedRunId) ??
    activeRun ??
    runs[0] ??
    null;
  const selectedIndex =
    selectedRun === null
      ? -1
      : runs.findIndex((run) => run.id === selectedRun.id);
  const earlierRuns = runs.slice(selectedIndex + 1);
  const previous =
    selectedRun === null
      ? null
      : (earlierRuns.find((run) => comparableRuns(selectedRun, run)) ?? null);
  const disabled = busy || saving;

  return (
    <details className="mt-4 rounded-md border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold text-teal-800">
        Solver tuning &amp; run history
        {replay ? " · Using captured inputs" : ""}
      </summary>
      <div className="mt-3 space-y-4">
        <p className="text-xs text-slate-600">
          Adjust → generate → inspect the outcome. Changes apply to your next
          run. Save defaults explicitly to share them across the organization.
          Hard eligibility rules remain enforced.
        </p>
        {loadingError ? (
          <button
            type="button"
            className={buttonClass}
            onClick={() => setReloadKey((key) => key + 1)}
          >
            Retry loading defaults
          </button>
        ) : null}
        {fields === null || settings === null ? (
          <p className="text-sm text-slate-500">
            {loadingError
              ? "Solver settings could not be loaded."
              : "Loading solver settings…"}
          </p>
        ) : (
          <fieldset
            disabled={disabled}
            className="space-y-4 disabled:opacity-60"
          >
            {[
              "Provider preferences",
              "Requested workload",
              "Workload distribution",
            ].map((group) => (
              <section key={group}>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {group}
                </h4>
                <div className="grid gap-3 lg:grid-cols-3">
                  {solverControls
                    .filter((control) => control.group === group)
                    .map((control) => {
                      const value = inputNumber(fields[control.key]);
                      const valid =
                        Number.isInteger(value) &&
                        value >= 0 &&
                        value <= control.max;
                      const id = `solver-${control.key}`;
                      const changed =
                        valid && value !== settings.weights[control.key];
                      return (
                        <div
                          key={control.key}
                          className="rounded-md border border-slate-200 p-3"
                        >
                          <label
                            htmlFor={id}
                            className="text-sm font-semibold text-slate-800"
                          >
                            {control.label}
                          </label>
                          <p
                            id={`${id}-help`}
                            className="mt-1 min-h-12 text-xs text-slate-600"
                          >
                            {control.description}
                          </p>
                          <div className="mt-2 flex items-center gap-3">
                            <input
                              type="range"
                              aria-label={`${control.label} slider`}
                              min={0}
                              max={control.max}
                              step={1}
                              value={valid ? value : 0}
                              disabled={!valid}
                              onChange={(event) =>
                                changeField(control.key, event.target.value)
                              }
                              className="min-w-0 flex-1 accent-teal-700"
                            />
                            <input
                              id={id}
                              type="number"
                              min={0}
                              max={control.max}
                              step={1}
                              value={fields[control.key]}
                              aria-invalid={!valid}
                              aria-describedby={`${id}-help`}
                              onChange={(event) =>
                                changeField(control.key, event.target.value)
                              }
                              className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                            />
                          </div>
                          {!valid ? (
                            <p className="mt-1 text-xs text-red-700">
                              Enter a whole number from 0 to {control.max}.
                            </p>
                          ) : null}
                          <p className="mt-2 text-xs text-slate-500">
                            Baseline {settings.baseline[control.key]} ·
                            Organization {settings.weights[control.key]}
                            {changed ? ` → Next run ${value}` : ""}
                            {value === 0 ? " · Influence disabled" : ""}
                          </p>
                          <button
                            type="button"
                            className="mt-1 text-xs font-medium text-teal-800 underline"
                            onClick={() =>
                              changeField(
                                control.key,
                                String(settings.baseline[control.key]),
                              )
                            }
                          >
                            Reset factor to baseline
                          </button>
                        </div>
                      );
                    })}
                </div>
              </section>
            ))}
            <p className="text-xs text-slate-600">
              Coverage: fixed penalty of{" "}
              {settings.baseline.unfilled_weight.toLocaleString()} per unfilled
              assignment in best-effort mode. Strict mode requires full
              coverage. The finite penalty does not guarantee coverage takes
              priority over every combination of preferences.
            </p>
            <p className="text-xs text-slate-500">
              Weights use different units, not percentages. Doubling one doubles
              its score contribution, not its schedule outcome. A changed weight
              can produce the same assignments.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass}
                onClick={() => loadWeights(settings.weights)}
              >
                Reset to organization default
              </button>
              <button
                type="button"
                className={buttonClass}
                onClick={() => loadWeights(settings.baseline)}
              >
                Reset to application baseline
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={weights === null}
                onClick={saveDefault}
              >
                {saving ? "Saving…" : "Save as organization default"}
              </button>
              <button
                type="button"
                className={buttonClass}
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Reload organization defaults
              </button>
            </div>
          </fieldset>
        )}
        {replay ? (
          <div className="rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
            Next run uses captured inputs from{" "}
            {replay.version_number === null
              ? "the selected attempt"
              : `version ${replay.version_number}`}{" "}
            in {replay.generation_mode.replace("_", "-")} mode. Adjust weights
            above, then use the matching Solve button. Current board edits are
            not inputs to this experiment.{" "}
            <button
              type="button"
              disabled={busy}
              className="ml-2 underline"
              onClick={() => onReplayChange(null)}
            >
              Use current inputs instead
            </button>
          </div>
        ) : null}
        <section className="space-y-3 border-t border-slate-200 pt-3">
          <h4 className="text-sm font-semibold text-slate-800">
            Settings used &amp; original run outcomes
          </h4>
          {hasSavedVersion && activeJobId === null ? (
            <p className="text-xs text-slate-600">
              Settings not recorded for this version. Run history below
              describes separate solver attempts.
            </p>
          ) : null}
          <p className="text-xs text-slate-500">
            Historical settings are read-only. Measurements describe the
            original solver output and do not include subsequent manual edits.
          </p>
          {historyError ? (
            <button
              type="button"
              className={buttonClass}
              onClick={() => setReloadKey((key) => key + 1)}
            >
              Retry loading history
            </button>
          ) : null}
          {selectedRun === null ? (
            <p className="text-sm text-slate-500">
              No recorded solver runs loaded.
            </p>
          ) : (
            <>
              <label className="block text-xs font-medium text-slate-700">
                Run
                <select
                  value={selectedRun.id}
                  onChange={(event) =>
                    setSelection({
                      runId: event.target.value,
                      jobContext: activeJobId,
                    })
                  }
                  className="ml-2 max-w-full rounded-md border border-slate-300 p-2 text-sm"
                >
                  {runs.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.version_number === null
                        ? "Attempt"
                        : `Version ${run.version_number}`}{" "}
                      ·{" "}
                      {run.started_at === null
                        ? "Time not recorded"
                        : new Date(run.started_at).toLocaleString()}{" "}
                      · {run.solver_status ?? run.status} ·{" "}
                      {run.generation_mode}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-slate-600">
                {selectedRun.configuration_source === "organization"
                  ? "Organization defaults"
                  : "Run-specific settings"}{" "}
                · Organization revision {selectedRun.organization_revision} ·
                Duration{" "}
                {selectedRun.duration_ms === null
                  ? "not recorded"
                  : `${selectedRun.duration_ms} ms`}{" "}
                · Requested by{" "}
                {selectedRun.requested_by_subject ?? "not recorded"}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
                {solverControls.map((control) => (
                  <span key={control.key}>
                    {control.label}:{" "}
                    <strong>{selectedRun.weights[control.key]}</strong>
                  </span>
                ))}
                <span>
                  Unfilled assignments:{" "}
                  <strong>{selectedRun.weights.unfilled_weight}</strong>
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  className={buttonClass}
                  onClick={() => {
                    loadWeights(selectedRun.weights);
                    onReplayChange(null);
                  }}
                >
                  Use settings with current inputs
                </button>
                <button
                  type="button"
                  disabled={disabled || !selectedRun.can_replay}
                  className={buttonClass}
                  onClick={() => {
                    loadWeights(selectedRun.weights);
                    onReplayChange(selectedRun);
                  }}
                >
                  Try different weights on the same inputs
                </button>
              </div>
              {!selectedRun.can_replay ? (
                <p className="text-xs text-slate-500">
                  Captured inputs are missing or this run used a different
                  solver implementation or runtime. Its weights can still be
                  used with current inputs.
                </p>
              ) : null}
              {selectedRun.error_message ? (
                <p className="text-sm text-red-700">
                  {selectedRun.error_message}
                </p>
              ) : null}
              {selectedRun.solver_status === "feasible" ? (
                <p className="text-xs text-amber-800">
                  A solution was found within the time limit; optimality was not
                  proven.
                </p>
              ) : null}
              {selectedRun.violation_messages.length > 0 ? (
                <details>
                  <summary className="cursor-pointer text-xs text-amber-800">
                    Run warnings and violations (
                    {selectedRun.violation_messages.length})
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
                    {selectedRun.violation_messages.map((message, index) => (
                      <li key={index}>{message}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <RunOutcomes run={selectedRun} previous={previous} />
              <details>
                <summary className="cursor-pointer text-xs text-slate-500">
                  Run record
                </summary>
                <dl className="mt-2 space-y-1 break-all text-xs text-slate-500">
                  <dt>Run ID</dt>
                  <dd>{selectedRun.id}</dd>
                  <dt>Solver implementation</dt>
                  <dd>{selectedRun.runtime.implementation_id}</dd>
                  <dt>Runtime</dt>
                  <dd>
                    OR-Tools {selectedRun.runtime.ortools_version}; limit{" "}
                    {selectedRun.runtime.max_solve_seconds}s; workers{" "}
                    {selectedRun.runtime.num_search_workers} (0 = automatic);
                    seed {selectedRun.runtime.random_seed}; schema{" "}
                    {selectedRun.schema_version}
                  </dd>
                  <dt>Input fingerprint</dt>
                  <dd>
                    {selectedRun.input_fingerprint ?? "Inputs not captured"}
                  </dd>
                </dl>
              </details>
            </>
          )}
          {hasMore ? (
            <button
              type="button"
              className={buttonClass}
              disabled={loadingOlder || busy}
              onClick={loadOlderRuns}
            >
              {loadingOlder ? "Loading…" : "Load older runs"}
            </button>
          ) : null}
        </section>
      </div>
    </details>
  );
}
