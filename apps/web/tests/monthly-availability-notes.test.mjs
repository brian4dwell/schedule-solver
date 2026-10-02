import assert from "node:assert/strict";
import { test } from "node:test";

import { act, loadTsModule, renderComponent } from "./helpers/render-component.mjs";

const { WeeklyAvailabilityNotes } = loadTsModule("components/reports/weekly-availability-notes.tsx");

test("weekly notes open on hover and focus, preserve plain text, and close with Escape", async (context) => {
  const notes = "Morning shifts only.\n<script>plain text</script>";
  const container = await renderComponent(context, WeeklyAvailabilityNotes, {
    providerName: "Avery",
    notes,
  });
  const icon = container.querySelector("button");
  assert.ok(icon);
  assert.equal(document.querySelector('[role="tooltip"]'), null);

  await act(async () => {
    const event = new window.MouseEvent("mouseover", { bubbles: true });
    icon.dispatchEvent(event);
  });
  const hoverTooltip = document.querySelector('[role="tooltip"]');
  assert.ok(hoverTooltip);
  assert.equal(hoverTooltip.textContent, notes);
  assert.equal(hoverTooltip.querySelector("script"), null);
  assert.equal(icon.getAttribute("aria-describedby"), hoverTooltip.id);
  assert.equal(container.contains(hoverTooltip), false);

  await act(async () => {
    const event = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    icon.dispatchEvent(event);
  });
  assert.equal(document.querySelector('[role="tooltip"]'), null);

  await act(async () => {
    icon.focus();
  });
  assert.equal(document.querySelector('[role="tooltip"]').textContent, notes);

  await act(async () => {
    icon.blur();
  });
  assert.equal(document.querySelector('[role="tooltip"]'), null);
});
