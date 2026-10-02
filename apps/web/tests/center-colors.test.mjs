import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { act, button, click, loadTsModule, renderComponent } from "./helpers/render-component.mjs";

const schemas = loadTsModule("lib/schemas/center.ts");
const picker = loadTsModule("components/centers/center-color-picker.tsx");

test("center color boundaries accept hex and clearing, reject invalid colors and missing response fields", () => {
  assert.equal(schemas.centerColorSchema.parse("#12abEF"), "#12abEF");
  assert.deepEqual(schemas.centerColorUpdateSchema.parse({ color: null }), { color: null });
  assert.equal(schemas.centerColorSchema.safeParse("red").success, false);
  assert.equal(schemas.centerColorSchema.safeParse("#123").success, false);
  assert.equal(schemas.centerColorSchema.safeParse("#123456\n").success, false);
  assert.equal(schemas.centerColorUpdateSchema.safeParse({}).success, false);
});

async function setHexColor(container, color) {
  const input = container.querySelector('input[type="text"]');
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  await act(async () => {
    descriptor.set.call(input, color);
    const event = new window.Event("input", { bubbles: true });
    input.dispatchEvent(event);
  });
}

test("center color editor saves only on request, retains edits after failure, and clears color", async (context) => {
  const showToast = mock.fn();
  const refresh = mock.fn();
  const updateCenterColor = mock.fn(async (_centerId, color) => ({ color }));
  const overrides = new Map([
    ["@/lib/api", { updateCenterColor }],
    ["next/navigation", { useRouter: () => ({ refresh }) }],
    ["@/components/ui/toast-provider", { useToast: () => ({ showToast }) }],
    ["@/components/centers/center-color-picker", picker],
  ]);
  const { CenterColorEditor } = loadTsModule("components/centers/center-color-editor.tsx", overrides);
  const center = { id: "center-a", name: "Center A", color: null };
  const container = await renderComponent(context, CenterColorEditor, { center });
  assert.equal(container.querySelector('input[type="text"]').value, "");

  const colorPicker = container.querySelector('input[type="color"]');
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  await act(async () => {
    descriptor.set.call(colorPicker, "#123456");
    const event = new window.Event("input", { bubbles: true });
    colorPicker.dispatchEvent(event);
  });
  assert.equal(container.querySelector('input[type="text"]').value, "#123456");
  assert.equal(updateCenterColor.mock.callCount(), 0);
  await click(button(container, "Save"));
  assert.deepEqual(updateCenterColor.mock.calls[0].arguments, [center.id, "#123456"]);
  assert.equal(refresh.mock.callCount(), 1);
  assert.equal(showToast.mock.calls[0].arguments[0].tone, "success");

  updateCenterColor.mock.mockImplementationOnce(async () => {
    throw new Error("Save unavailable");
  });
  await setHexColor(container, "#abcdef");
  await click(button(container, "Save"));
  assert.equal(container.querySelector('input[type="text"]').value, "#abcdef");
  assert.ok(button(container, "Save"));
  assert.equal(showToast.mock.calls[1].arguments[0].tone, "error");

  await click(button(container, "Clear"));
  await click(button(container, "Save"));
  assert.deepEqual(updateCenterColor.mock.calls[2].arguments, [center.id, null]);
  assert.equal(container.querySelector('input[type="text"]').value, "");
});
