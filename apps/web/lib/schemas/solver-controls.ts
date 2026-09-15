import { z } from "zod";

export const solverWeightsSchema = z
  .object({
    center_weight: z.number().int().min(0).max(8),
    shift_type_weight: z.number().int().min(0).max(12),
    manager_hidden_weight: z.number().int().min(0).max(10),
    below_minimum_weight: z.number().int().min(0).max(20),
    above_maximum_weight: z.number().int().min(0).max(30),
    balance_weight: z.number().int().min(0).max(6),
    fairness_weight: z.number().int().min(0).max(20),
    unfilled_weight: z.literal(100000),
  })
  .strict();

export type SolverWeights = z.infer<typeof solverWeightsSchema>;

export const solverSettingsSchema = z.object({
  weights: solverWeightsSchema,
  baseline: solverWeightsSchema,
  revision: z.number().int().positive(),
});

export const solverSettingsWriteSchema = z.object({
  weights: solverWeightsSchema,
  expected_revision: z.number().int().positive(),
});

export type SolverSettings = z.infer<typeof solverSettingsSchema>;

const preferenceOutcomeSchema = z.object({
  positive: z.number().int(),
  negative: z.number().int(),
  neutral: z.number().int(),
  missing: z.number().int(),
});

const factorOutcomeSchema = z.object({
  factor: solverWeightsSchema.keyof(),
  raw_value: z.number(),
  weight: z.number().int(),
  contribution: z.number().int(),
});

const solverOutcomesSchema = z.object({
  assigned_count: z.number().int(),
  unfilled_count: z.number().int(),
  below_minimum_provider_count: z.number().int(),
  above_maximum_provider_count: z.number().int(),
  center_preferences: preferenceOutcomeSchema,
  shift_preferences: preferenceOutcomeSchema,
  manager_preferences: preferenceOutcomeSchema,
  factors: z.array(factorOutcomeSchema),
});

export const solverRunSchema = z.object({
  id: z.string().uuid(),
  schedule_period_id: z.string().uuid(),
  schedule_version_id: z.string().uuid().nullable(),
  version_number: z.number().int().nullable(),
  status: z.enum(["running", "completed", "failed"]),
  requested_by_subject: z.string().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  error_message: z.string().nullable(),
  weights: solverWeightsSchema,
  configuration_source: z.enum(["organization", "run_override"]),
  organization_revision: z.number().int(),
  schema_version: z.literal(1),
  generation_mode: z.enum(["strict", "best_effort"]),
  runtime: z.object({
    implementation_id: z.string(),
    ortools_version: z.string(),
    max_solve_seconds: z.number(),
    num_search_workers: z.number().int(),
    random_seed: z.number().int(),
  }),
  replay_of_run_id: z.string().uuid().nullable(),
  input_fingerprint: z.string().nullable(),
  can_replay: z.boolean(),
  solver_status: z
    .enum(["optimal", "feasible", "infeasible", "unknown", "model_invalid"])
    .nullable(),
  is_feasible: z.boolean().nullable(),
  solver_score: z.number().nullable(),
  outcomes: solverOutcomesSchema.nullable(),
  duration_ms: z.number().int().nullable(),
  violation_messages: z.array(z.string()),
});

export type SolverRun = z.infer<typeof solverRunSchema>;
export type SolverOutcomes = z.infer<typeof solverOutcomesSchema>;

export type SolverControl = {
  key: Exclude<keyof SolverWeights, "unfilled_weight">;
  group: string;
  label: string;
  description: string;
  max: number;
};

export const solverControls: SolverControl[] = [
  {
    key: "center_weight",
    group: "Provider preferences",
    label: "Center preference",
    description:
      "Points per preference level per assignment. Higher values favor preferred Centers and discourage avoided Centers.",
    max: 8,
  },
  {
    key: "shift_type_weight",
    group: "Provider preferences",
    label: "Shift-type preference",
    description:
      "Points per preference level per assignment. Higher values favor preferred shift types.",
    max: 12,
  },
  {
    key: "manager_hidden_weight",
    group: "Provider preferences",
    label: "Manager placement preference",
    description:
      "Points per Manager Center Preference level per assignment. Higher values emphasize manager placement preferences.",
    max: 10,
  },
  {
    key: "below_minimum_weight",
    group: "Requested workload",
    label: "Avoid falling below minimum",
    description:
      "Penalty per missing half-shift unit below a Provider's requested minimum.",
    max: 20,
  },
  {
    key: "above_maximum_weight",
    group: "Requested workload",
    label: "Avoid exceeding maximum",
    description:
      "Penalty per extra half-shift unit above a Provider's requested maximum.",
    max: 30,
  },
  {
    key: "balance_weight",
    group: "Workload distribution",
    label: "Balance this schedule",
    description:
      "Penalty per half-shift unit of difference between every pair of Providers. Higher values encourage more equal workloads.",
    max: 6,
  },
  {
    key: "fairness_weight",
    group: "Workload distribution",
    label: "Historical fairness influence",
    description:
      "Scales (debt − favor credit) × Provider priority. Positive pressure discourages more workload; negative pressure encourages it. Rounded per Provider before applying assigned half-shift units.",
    max: 20,
  },
];

export function solverFactorLabel(key: keyof SolverWeights): string {
  if (key === "unfilled_weight") {
    return "Unfilled assignments";
  }
  const control = solverControls.find((candidate) => candidate.key === key);
  if (control === undefined) {
    throw new Error("Unknown solver factor");
  }
  return control.label;
}
