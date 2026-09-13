import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { compileFunction } from "node:vm";

import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import ts from "typescript";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:3000",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");

// Compile the real components and mock only their external boundaries.
export function loadTsModule(relativePath, overrides = new Map()) {
  const filename = resolve(relativePath);
  const source = readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const requireModule = createRequire(filename);
  const compiledModule = { exports: {} };

  function requireDependency(name) {
    if (overrides.has(name)) {
      return overrides.get(name);
    }

    return requireModule(name);
  }

  const runModule = compileFunction(compiled.outputText, ["require", "module", "exports"], {
    filename,
  });
  runModule(requireDependency, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

export async function renderComponent(context, Component, props) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  context.after(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
  await act(async () => {
    const element = createElement(Component, props);
    root.render(element);
  });
  return container;
}

export function button(container, label) {
  const buttons = Array.from(container.querySelectorAll("button"));
  const result = buttons.find((candidate) => candidate.textContent.trim() === label);
  assert.ok(result, `Missing button: ${label}`);
  return result;
}

export async function click(element) {
  await act(async () => {
    element.click();
  });
}

export async function select(element, value) {
  assert.ok(element);
  await act(async () => {
    element.value = value;
    const event = new window.Event("change", { bubbles: true });
    element.dispatchEvent(event);
  });
}

export async function finishRequest(request, value) {
  await act(async () => {
    request.resolve(value);
  });
}

export async function changeNotes(container, value) {
  const textarea = container.querySelector('textarea[aria-label="Freeform notes"]');
  assert.ok(textarea);
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  await act(async () => {
    descriptor.set.call(textarea, value);
    const event = new window.Event("input", { bubbles: true });
    textarea.dispatchEvent(event);
  });
}

export { act, createElement };
