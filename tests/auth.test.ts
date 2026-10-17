import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUsername, validLoginPassword, passwordError, isSameOrigin } from "../src/lib/auth/validation";
import { parseAdminMutation } from "../src/lib/site-admin/validation";
import { validSchoolMutation, validProgress } from "../src/lib/workspace/validation";

test("Workspace mutations require bounded fields and cannot accept extra roles or scopes", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const payload = { action: "assignment", period_id: id, grade_id: id, classroom_id: id, user_id: null, manager: false };
  assert.equal(validSchoolMutation({ version: 1, payload }), true);
  assert.equal(validSchoolMutation({ version: 1, payload: { ...payload, role: "site_admin" } }), false);
  assert.equal(validSchoolMutation({ version: 1, payload: { ...payload, school_id: id } }), false);
  assert.equal(validSchoolMutation({ version: 0, payload }), false);
  assert.equal(validSchoolMutation({ version: 1, payload: { action: "toString" } }), false);
  assert.equal(validSchoolMutation({ version: 1, payload: { action: "grade_create", period_id: id, number: 7 } }), false);
  assert.equal(validSchoolMutation({ version: 1, payload: { action: "teacher_create", username: "teacher.one", name: "선생님" } }), true);
  assert.equal(validSchoolMutation({ version: 1, payload: { action: "teacher_create", username: "teacher.one", name: "선생님", is_site_admin: true } }), false);
  assert.equal(validProgress({ classroom_id: id, unit_id: id, completed: true, version: 0 }), true);
  assert.equal(validProgress({ classroom_id: id, unit_id: id, completed: "true", version: 0 }), false);
  assert.equal(validProgress({ classroom_id: id, unit_id: id, completed: true, version: -1 }), false);
});

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
test("Initial password can log in, but new passwords require length and all four character groups", () => {
  assert.equal(validLoginPassword("000000"), true);
  for (const password of ["000000", "Aa1!abc", "abcdefgh1!", "ABCDEFGH1!", "Abcdefgh!", "Abcdefgh1", "Abc123  ", "가나다라마바사아"]) {
    assert.ok(passwordError(password, password, "old-password"), `Must reject ${password}`);
  }
  for (const password of ["Abcd123!", "Aa1!가나다라", "Aa1!" + "a".repeat(68), " Abcd123! "]) {
    assert.equal(passwordError(password, password, "000000"), null);
  }
  assert.match(passwordError("Aa1!abc", "Aa1!abc", "old")!, /8/);
  assert.match(passwordError("Abcd123!", "wrong-confirm", "000000")!, /일치/);
  assert.match(passwordError("Abcd123!", "Abcd123!", "Abcd123!")!, /다른/);
  assert.ok(passwordError("Aa1!" + "a".repeat(69), "Aa1!" + "a".repeat(69), "old"));
  assert.ok(passwordError("Aa1!" + "가".repeat(23), "Aa1!" + "가".repeat(23), "old"));
});
test("POST origin checks reject external and missing origins", () => {
  const req = (origin?: string) => new Request("http://localhost:3000/api/auth/login", { headers: origin ? { Origin: origin } : {} });
  assert.equal(isSameOrigin(req("http://localhost:3000")), true);
  assert.equal(isSameOrigin(req("https://attacker.example")), false);
  assert.equal(isSameOrigin(req()), false);
  assert.equal(isSameOrigin(req("https://school.example"), "https://school.example"), true);
  assert.equal(isSameOrigin(req("http://localhost:3000"), "https://school.example"), false);
});

test("School mutations reject privileged fields and malformed versions or IDs", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(parseAdminMutation({ action: "create_school", name: "  우리초등학교  " }), { action: "create_school", name: "우리초등학교" });
  assert.deepEqual(parseAdminMutation({ action: "save_school", id, name: "학교", version: 2, active: false }), { action: "save_school", id, name: "학교", version: 2, active: false });
  assert.ok(parseAdminMutation({ action: "set_manager", id, user_id: id, version: 1, assign: true }));
  for (const value of [null, [], {}, { action: "create_school", name: "  " }, { action: "create_school", name: "가".repeat(81) },
    { action: "create_school", name: "학교", is_site_admin: true }, { action: "create_school", name: "학교", active: false },
    { action: "save_school", id: "wrong", name: "학교", version: 1 }, { action: "save_school", id, name: "학교", version: "1" },
    { action: "save_school", id, name: "학교", version: 0 }, { action: "save_school", id, name: "학교", version: 1, active: "false" },
    { action: "set_manager", id, user_id: id, version: 1, assign: "true" }, { action: "set_manager", id, user_id: id, version: 1, assign: true, role: "site_admin" }]) {
    assert.equal(parseAdminMutation(value), null);
  }
});
