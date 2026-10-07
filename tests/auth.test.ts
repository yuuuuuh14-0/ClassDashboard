import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUsername, validLoginPassword, passwordError, isSameOrigin } from "../src/lib/auth/validation";

test("ID normalization supports the agreed ID rules without accepting another identifier", () => {
  assert.equal(normalizeUsername("  Kim.Teacher  "), "kim.teacher");
  for (const input of [null, {}, "abc", "a".repeat(31), "kim teacher", "admin@example.com", "선생님"]) assert.equal(normalizeUsername(input), null);
});
test("Passwords preserve whitespace and enforce the provider's byte limit", () => {
  assert.equal(validLoginPassword(" pass word "), true);
  assert.equal(validLoginPassword("가".repeat(24)), true);
  assert.equal(validLoginPassword("가".repeat(25)), false);
  assert.equal(validLoginPassword(""), false);
  assert.equal(validLoginPassword(null), false);
});
test("Password change requires at least six characters and a matching, different password", () => {
  assert.equal(passwordError("abcdef", "abcdef", "old-password"), null);
  assert.equal(passwordError("\uac00\ub098\ub2e4\ub77c\ub9c8\ubc14", "\uac00\ub098\ub2e4\ub77c\ub9c8\ubc14", "old-password"), null);
  assert.match(passwordError("short", "short", "old")!, /6/);
  assert.match(passwordError("a-strong-pass", "wrong-confirm", "old")!, /일치/);
  assert.match(passwordError("a-strong-pass", "a-strong-pass", "a-strong-pass")!, /다른/);
  assert.ok(passwordError("가".repeat(25), "가".repeat(25), "old"));
});
test("POST origin checks reject external and missing origins", () => {
  const req = (origin?: string) => new Request("http://localhost:3000/api/auth/login", { headers: origin ? { Origin: origin } : {} });
  assert.equal(isSameOrigin(req("http://localhost:3000")), true);
  assert.equal(isSameOrigin(req("https://attacker.example")), false);
  assert.equal(isSameOrigin(req()), false);
  assert.equal(isSameOrigin(req("https://school.example"), "https://school.example"), true);
  assert.equal(isSameOrigin(req("http://localhost:3000"), "https://school.example"), false);
});
