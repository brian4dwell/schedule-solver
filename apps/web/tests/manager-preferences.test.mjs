import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";

import { button, click, loadTsModule, renderComponent, select } from "./helpers/render-component.mjs";

const schemas = loadTsModule("lib/schemas/preferences.ts");
const levels = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];

test("manager boundaries accept all eleven levels and reject invalid scores", () => {
  const centerId = randomUUID();
  for (const level of levels) {
    const preference = { center_id: centerId, preference_level: level, manager_note: null };
    const payload = { center_preferences: [preference] };
    const parsed = schemas.managerProviderPreferencesPayloadSchema.parse(payload);
    assert.equal(parsed.center_preferences[0].preference_level, level);
    const record = {
      ...preference,
      id: randomUUID(),
      provider_id: randomUUID(),
      is_active: true,
      created_at: "2026-09-14T12:00:00Z",
      updated_at: "2026-09-14T12:00:00Z",
    };
    const response = schemas.managerProviderCenterPreferenceApiSchema.parse(record);
    assert.equal(response.preference_level, level);
  }
  for (const level of [-6, 6, -1.5, 1.5, "5"]) {
    const result = schemas.managerPreferenceLevelSchema.safeParse(level);
    assert.equal(result.success, false);
  }
  for (const level of [-5, -4, 4, 5]) {
    const result = schemas.preferenceLevelSchema.safeParse(level);
    assert.equal(result.success, false);
  }
});

test("manager editor loads, selects and saves all eleven options with toast feedback", async (context) => {
  const providerId = randomUUID();
  const centerId = randomUUID();
  const showToast = mock.fn();
  const saveManagerProviderPreferences = mock.fn(async (_providerId, payload) => {
    return schemas.managerProviderPreferencesPayloadSchema.parse(payload);
  });
  const overrides = new Map([
    ["@/lib/api", { saveManagerProviderPreferences }],
    ["@/components/ui/toast-provider", { useToast: () => ({ showToast }) }],
    ["next/navigation", { useRouter: () => ({ refresh: mock.fn() }) }],
  ]);
  const { ProviderPreferencesEditor } = loadTsModule("components/providers/provider-preferences-editor.tsx", overrides);
  const props = {
    centers: [{ id: centerId, name: "Main Center" }],
    provider: { id: providerId, display_name: "Test Provider" },
    preferences: { provider_id: providerId, center_preferences: [], shift_type_preferences: [] },
    managerPreferences: {
      provider_id: providerId,
      center_preferences: [{ center_id: centerId, preference_level: 4, manager_note: "Keep note" }],
    },
  };
  const container = await renderComponent(context, ProviderPreferencesEditor, props);
  const sections = container.querySelectorAll("section");
  const managerSection = sections[1];
  const control = managerSection.querySelector("select");
  assert.equal(control.value, "4");
  const optionValues = Array.from(control.options, (option) => Number(option.value));
  assert.deepEqual(optionValues, levels);
  assert.equal(control.options[5].textContent, "0 (Neutral)");
  const providerControl = sections[0].querySelector("select");
  assert.equal(providerControl.options.length, 5);

  for (const level of levels) {
    await select(control, String(level));
    const saveButton = button(managerSection, "Save manager preferences");
    await click(saveButton);
    const lastCall = saveManagerProviderPreferences.mock.calls.at(-1);
    assert.equal(lastCall.arguments[0], providerId);
    assert.deepEqual(lastCall.arguments[1].center_preferences, [{
      center_id: centerId,
      preference_level: level,
      manager_note: "Keep note",
    }]);
    const lastToast = showToast.mock.calls.at(-1);
    assert.equal(lastToast.arguments[0].tone, "success");
  }
});
