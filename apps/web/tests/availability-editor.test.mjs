import assert from "node:assert/strict";
import { mock, test } from "node:test";

import {
  button,
  click,
  finishRequest,
  loadTsModule,
  renderComponent,
  select,
} from "./helpers/render-component.mjs";

const periods = [
  { id: "week-a", name: "Week A", start_date: "2026-09-14", end_date: "2026-09-20" },
  { id: "week-b", name: "Week B", start_date: "2026-09-21", end_date: "2026-09-27" },
];
const providers = [
  { id: "provider-a", display_name: "Provider A" },
  { id: "provider-b", display_name: "Provider B" },
];
const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function availability(providerId, scheduleWeekId, maxShiftsRequested = 5) {
  const days = weekdays.map((weekday) => ({ weekday, options: ["full_shift"] }));
  const record = {
    providerId,
    scheduleWeekId,
    isLocked: false,
    minShiftsRequested: 0,
    maxShiftsRequested,
    days,
  };
  return record;
}

async function setup(context, api) {
  const showToast = mock.fn();
  const overrides = new Map([
    ["@/lib/api", api],
    ["@/components/ui/toast-provider", { useToast: () => ({ showToast }) }],
  ]);
  const { ProviderAvailabilityEditor } = loadTsModule(
    "components/providers/provider-availability-editor.tsx",
    overrides,
  );
  const container = await renderComponent(context, ProviderAvailabilityEditor, { periods, providers });
  return container;
}

function selector(container, index) {
  const selectors = container.querySelectorAll("select");
  return selectors.item(index);
}

for (const selection of [
  { name: "provider", index: 1, providerId: "provider-b", scheduleWeekId: "week-a" },
  { name: "week", index: 0, providerId: "provider-a", scheduleWeekId: "week-b" },
]) {
  test(`changing ${selection.name} prevents saving the previous availability during loading`, async (context) => {
    const pending = Promise.withResolvers();
    const initial = availability("provider-a", "week-a");
    const next = availability(selection.providerId, selection.scheduleWeekId, 2);
    const getProviderWeeklyAvailability = mock.fn(() => initial);
    const saveProviderWeeklyAvailability = mock.fn(async (_weekId, _providerId, record) => record);
    const deleteProviderWeeklyAvailability = mock.fn();
    const container = await setup(context, {
      getProviderWeeklyAvailability,
      saveProviderWeeklyAvailability,
      deleteProviderWeeklyAvailability,
    });
    assert.equal(button(container, "Save").disabled, false);
    getProviderWeeklyAvailability.mock.mockImplementation(() => pending.promise);
    const selectedId = selection.index === 0 ? selection.scheduleWeekId : selection.providerId;
    await select(selector(container, selection.index), selectedId);
    assert.equal(button(container, "Save").disabled, true);
    assert.equal(button(container, "Delete").disabled, true);
    assert.equal(container.querySelectorAll('input[type="number"]').length, 0);
    await click(button(container, "Save"));
    await click(button(container, "Delete"));
    assert.equal(saveProviderWeeklyAvailability.mock.callCount(), 0);
    assert.equal(deleteProviderWeeklyAvailability.mock.callCount(), 0);

    await finishRequest(pending, next);
    await click(button(container, "Save"));
    const savedArguments = saveProviderWeeklyAvailability.mock.calls[0].arguments;
    assert.deepEqual(savedArguments, [selection.scheduleWeekId, selection.providerId, next]);
  });
}

test("a late load does not replace the currently selected provider", async (context) => {
  const pending = Promise.withResolvers();
  const providerB = availability("provider-b", "week-a", 2);
  const api = {
    getProviderWeeklyAvailability: mock.fn((_weekId, providerId) => {
      return providerId === "provider-a" ? pending.promise : providerB;
    }),
    saveProviderWeeklyAvailability: mock.fn(async (_weekId, _providerId, record) => record),
  };
  const container = await setup(context, api);
  await select(selector(container, 1), "provider-b");
  const providerA = availability("provider-a", "week-a", 5);
  await finishRequest(pending, providerA);
  await click(button(container, "Save"));
  assert.deepEqual(api.saveProviderWeeklyAvailability.mock.calls[0].arguments, ["week-a", "provider-b", providerB]);
});

for (const operation of ["save", "delete"]) {
  test(`a late ${operation} completion cannot overwrite another provider's editor`, async (context) => {
    const pending = Promise.withResolvers();
    const providerA = availability("provider-a", "week-a", 5);
    const providerB = availability("provider-b", "week-a", 2);
    const api = {
      getProviderWeeklyAvailability: mock.fn((_weekId, providerId) => {
        return providerId === "provider-a" ? providerA : providerB;
      }),
      saveProviderWeeklyAvailability: mock.fn(() => pending.promise),
      deleteProviderWeeklyAvailability: mock.fn(() => pending.promise),
    };
    const container = await setup(context, api);
    const actionLabel = operation === "save" ? "Save" : "Delete";
    await click(button(container, actionLabel));
    await select(selector(container, 1), "provider-b");
    await finishRequest(pending, providerA);
    assert.equal(selector(container, 1).value, "provider-b");
    const maximumInput = container.querySelectorAll('input[type="number"]').item(1);
    assert.equal(maximumInput.value, "2");
    api.saveProviderWeeklyAvailability.mock.mockImplementation(async (_weekId, _providerId, record) => record);
    await click(button(container, "Save"));
    const calls = api.saveProviderWeeklyAvailability.mock.calls;
    const lastCall = calls.at(-1);
    assert.deepEqual(lastCall.arguments, ["week-a", "provider-b", providerB]);
  });
}

test("a response for a different selection cannot be saved or deleted", async (context) => {
  const wrongRecord = availability("provider-b", "week-b");
  const api = {
    getProviderWeeklyAvailability: mock.fn(async () => wrongRecord),
    saveProviderWeeklyAvailability: mock.fn(),
    deleteProviderWeeklyAvailability: mock.fn(),
  };
  const container = await setup(context, api);
  await click(button(container, "Save"));
  await click(button(container, "Delete"));
  assert.equal(api.saveProviderWeeklyAvailability.mock.callCount(), 0);
  assert.equal(api.deleteProviderWeeklyAvailability.mock.callCount(), 0);
});
