import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ESLint } from "eslint";

const eslint = new ESLint();
const authRuleId = "@clerk/next/require-auth-protection";

async function authViolations(source, filePath) {
  const results = await eslint.lintText(source, { filePath });
  const messages = results.flatMap((result) => result.messages);
  const violations = messages.filter((message) => message.ruleId === authRuleId);
  return violations;
}

test("new pages must require authentication", async () => {
  const source = "export default function Page() { return null; }";
  const violations = await authViolations(source, "app/future-feature/page.tsx");
  assert.equal(violations.length, 1);
});

test("Route Handlers must require authentication", async () => {
  const source = "export function GET() { return Response.json({}); }";
  const violations = await authViolations(source, "app/api/future-feature/route.ts");
  assert.equal(violations.length, 1);
});

test("Server Functions outside app must require authentication", async () => {
  const source = '"use server"; export async function save() {}';
  const violations = await authViolations(source, "lib/future-actions.ts");
  assert.equal(violations.length, 1);
});

test("removing protection from the invite acceptance page is rejected", async () => {
  const filePath = "app/provider-portal/accept/page.tsx";
  const originalSource = await readFile(filePath, "utf8");
  const originalViolations = await authViolations(originalSource, filePath);
  assert.equal(originalViolations.length, 0);

  const unprotectedSource = originalSource.replace("await auth.protect();", "");
  assert.notEqual(unprotectedSource, originalSource);
  const violations = await authViolations(unprotectedSource, filePath);
  assert.equal(violations.length, 1);
});

test("public sign-in, sign-up, and health resources remain exempt", async () => {
  const publicFiles = [
    "app/sign-in/[[...sign-in]]/page.tsx",
    "app/sign-up/[[...sign-up]]/page.tsx",
    "app/health/route.ts",
  ];

  for (const filePath of publicFiles) {
    const source = await readFile(filePath, "utf8");
    const violations = await authViolations(source, filePath);
    assert.equal(violations.length, 0, filePath);
  }
});

test("the shared root layout does not make the root page public", async () => {
  const layoutPath = "app/layout.tsx";
  const layoutSource = await readFile(layoutPath, "utf8");
  const layoutViolations = await authViolations(layoutSource, layoutPath);
  assert.equal(layoutViolations.length, 0);

  const pageSource = "export default function Home() { return null; }";
  const pageViolations = await authViolations(pageSource, "app/page.tsx");
  assert.equal(pageViolations.length, 1);
});
