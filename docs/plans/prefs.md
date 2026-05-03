# Preference Scoring Plan

## Goal

Add a preference scoring layer for schedule generation.

Keep hard eligibility rules unchanged.

Use preferences only to rank valid assignments.

Support practitioner-visible preferences.

Support manager-only preferences.

## Non-Goals

Do not change hard eligibility rules.

Do not expose manager-only preferences to practitioners.

Do not add time-of-day preferences in this pass.

## Guiding Principles

Keep hard constraints separate from soft objectives.

Use typed contracts at solver boundaries.

Do not pass unstructured dictionaries between services.

Use explicit reason codes for explainability.

Keep hidden manager preferences in restricted data paths.

## Preference Dimensions In Scope

Support center preference per practitioner.

Support skill or shift-type preference per practitioner.

Support manager-only center-to-practitioner preference.

## Scoring Model

Each eligible provider and shift candidate gets a preference score.

The solver objective maximizes the sum of candidate preference scores.

The solver objective also includes existing fairness terms.

The solver objective does not relax hard constraints.

### Base Preference Levels

Use a small integer band for stable tuning.

Use `3` for strong preference.

Use `2` for preference.

Use `0` for neutral.

Use `-2` for in-a-pinch assignments.

Use `-3` for strong avoid but still allowed.

### Suggested Dimension Weights

Use center weight `4`.

Use skill or shift-type weight `6`.

Use manager hidden weight `5`.

### Candidate Score Formula

Compute practitioner center points.

Compute practitioner skill or shift-type points.

Compute manager hidden points.

Multiply each point value by its dimension weight.

Add each weighted value into one candidate score.

Use that candidate score in the objective.

## Fairness Integration

Add preference scoring as another soft term in the existing fairness mechanism.

Keep min and max shift requests as soft terms.

Keep hard eligibility as candidate filtering before variable creation.

Record preference contribution metadata in solver output for manager diagnostics.

Do not include hidden manager details in practitioner-visible payloads.

## Data Contracts

Define explicit typed contracts for preference inputs.

Define separate contracts for visible and hidden preferences.

### Example Backend Contract Shapes

Use a practitioner center preference contract.

Use a practitioner skill preference contract.

Use a manager center-to-practitioner preference contract.

Use a solver preference weights contract.

Use a solver candidate preference score breakdown contract.

## Storage Model

Store practitioner preferences in practitioner-managed tables.

Store manager-only preferences in restricted manager tables.

Use active flags and effective dates for both sources.

Index by organization, practitioner, and center or skill key.

## Privacy And Access Control

Restrict manager-only preference reads to manager or scheduler roles.

Exclude manager-only preference fields from practitioner APIs.

Exclude manager-only reason details from practitioner schedule views.

Allow manager-facing explainability views to include hidden influence details.

Use neutral language in visible warnings and explanations.

## Solver Pipeline Changes

Load preference data during solver input build.

Pass preference data through typed solver contracts.

Score each eligible candidate once during candidate generation.

Attach score and score breakdown to candidate metadata.

Use weighted candidate scores in the objective function.

Persist aggregate objective and summary metrics in solver result metadata.

## Explainability

Add manager-visible summary metrics.

Track count of preferred assignments.

Track count of in-a-pinch assignments.

Track center preference satisfaction rate.

Track skill preference satisfaction rate.

Track hidden manager preference impacts.

## Suggested Reason Code Extensions

Add `preference_center_applied`.

Add `preference_skill_applied`.

Add `preference_manager_hidden_applied`.

Add `preference_in_pinch_used`.

Keep these as schedule quality or diagnostics categories.

## Implementation Steps

### Step 1: Contracts

Create typed preference contracts in solver contracts module.

Create separate visible and hidden preference structures.

Add explicit weight configuration structure.

### Step 2: Persistence

Add persistence models and migrations for practitioner preferences.

Add persistence models and migrations for manager-only preferences.

Add audit fields and active windows.

### Step 3: Input Builder

Load preference rows for the schedule period scope.

Map rows into typed preference contracts.

Validate preferences before solver invocation.

### Step 4: Candidate Scoring

Extend candidate generation to compute preference score components.

Keep hard eligibility gate unchanged.

Store candidate score and breakdown for objective construction.

### Step 5: Objective Integration

Add preference score terms to the CP-SAT objective.

Keep existing fairness terms in place.

Tune relative coefficients in one centralized weight config.

### Step 6: Output And Diagnostics

Return solver score with preference summary metadata.

Persist manager-visible diagnostics.

Keep practitioner-visible payloads free of hidden manager details.

### Step 7: API Surfaces

Add practitioner endpoints for self-managed preferences.

Add manager endpoints for hidden preference tuning.

Enforce role-based access controls at route and service layers.

### Step 8: UI

Add practitioner UI controls for center and skill preferences.

Add manager-only UI controls for hidden preference tuning.

Show only visible preference explanations to practitioners.

### Step 9: Validation And Tests

Add unit tests for preference contract validation.

Add unit tests for score calculation with deterministic fixtures.

Add solver integration tests for tie-breaking behavior.

Add authorization tests for hidden preference endpoints.

Add snapshot tests for manager and practitioner explainability payloads.

### Step 10: Rollout

Ship with conservative default weights.

Run shadow solves and compare quality metrics.

Tune weights with scheduler feedback.

Promote from beta to default after stability checks.

## Default Weight Starting Point

Set center weight to `4`.

Set skill or shift-type weight to `6`.

Set manager hidden weight to `5`.

Keep these values in configuration for easy tuning.

## Open Questions

Should manager-only preferences support expiration dates by default.

Should hidden preferences support per-shift-type granularity.

Should fairness include weekly caps on repeated in-a-pinch assignments.

Should diagnostics include practitioner-visible aggregate satisfaction percentages.
