import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { request } from "@playwright/test";
import { gradeFixture, seedGradeFixture } from "./grade-fixture.mjs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !secret) throw new Error("Configure Supabase first.");
const appUrl = process.env.AUTH_TEST_APP_URL || "http://localhost:3000";
const origin = process.env.APP_ORIGIN || new URL(appUrl).origin;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, options), users = [], contexts = [], clients = [], schoolIds = [];
const namespace = `verify-grade-${randomBytes(8).toString("hex")}`;
const password = () => `Verify-${randomBytes(18).toString("base64url")}-Aa1!`;
const check = (ok, label) => { if (!ok) throw new Error(label); };
const pass = label => console.log(`PASS: ${label}`);
async function makeUser() {
  const username = `verify.${randomBytes(7).toString("hex")}`, email = `${randomUUID()}@${process.env.AUTH_LOGIN_DOMAIN || "auth.classdashboard.invalid"}`, initial = password();
  const created = await admin.auth.admin.createUser({ email, password: initial, email_confirm: true });
  check(!created.error && created.data.user, "Create temporary user");
  const user = { id: created.data.user.id, username, email, password: initial }; users.push(user);
  const registered = await admin.rpc("register_login_account", { target_user: user.id, login_name: username, account_name: "학년 검증용", internal_email: email, site_admin: false });
  check(!registered.error, "Register temporary user"); return user;
}
async function apiContext() { const api = await request.newContext({ baseURL: appUrl, extraHTTPHeaders: { Origin: origin }, timeout: 20_000 }); contexts.push(api); return api; }
async function direct(user) { const client = createClient(url, key, options); clients.push(client); check(!(await client.auth.signInWithPassword({ email: user.email, password: user.password })).error, "Direct test login"); return client; }

let failure;
try {
  const manager = await makeUser(), schoolManager = await makeUser();
  const fixture = gradeFixture(namespace, `${namespace} test school`, manager.id, schoolManager.id);
  schoolIds.push(fixture.schoolId);
  await seedGradeFixture(admin, fixture);
  const foreign = gradeFixture(`${namespace}-foreign`, `${namespace} foreign school`, manager.id, schoolManager.id);
  for (const name of ["school_memberships", "teacher_assignments", "grade_manager_assignments"]) foreign.tables[name] = [];
  schoolIds.push(foreign.schoolId); await seedGradeFixture(admin, foreign);
  const api = await apiContext();
  const endpoint = `/api/grade-admin?grade=${fixture.gradeId}`;
  check((await api.get(endpoint)).status() === 401, "Unauthenticated API access denied");
  const login = await api.post("/api/auth/login", { data: { username: manager.username, password: manager.password } });
  check(login.status() === 200 && (await login.json()).redirect === "/password", "Initial change must precede dashboard");
  check((await api.get(endpoint)).status() === 403, "First-password account cannot read grade data");
  const firstClient = await direct(manager);
  const hiddenBefore = await firstClient.from("student_enrollments").select("id");
  check(!hiddenBefore.error && !hiddenBefore.data.length, "RLS must hide students until initial change");
  const changedPassword = password();
  const changed = await api.post("/api/auth/password", { data: { currentPassword: manager.password, password: changedPassword, confirmation: changedPassword } });
  check(changed.status() === 200, "Change temporary grade-manager password"); manager.password = changedPassword;
  const client = await direct(manager);
  const access = await client.rpc("dashboard_access");
  check(!access.error && access.data.grades.length === 1 && access.data.grades[0].id === fixture.gradeId, "Only actual assigned grade may be selected");
  const response = await api.get(endpoint); check(response.status() === 200, "Read grade dashboard");
  const snapshot = await response.json();
  check(snapshot.classrooms.length === 3 && snapshot.students.length === 18 && snapshot.subjects.length === 6, "Dashboard counts must match stored data");
  const korean = snapshot.classrooms[0].subjects.find(value => value.subject_id === fixture.subjects[0].id);
  const english = snapshot.classrooms[0].subjects.find(value => value.subject_id === fixture.subjects[4].id);
  check(korean.completed === 2 && korean.total === 6 && Number(korean.percentage) === 33.3, "Server percentage must be rounded to one decimal");
  check(english.total === 0 && english.percentage === null, "Zero units must not become 0 percent");
  check(snapshot.context.own_classroom_id === fixture.classrooms[0].id, "Own classroom must match actual teacher assignment");
  const dashboard = await api.get("/dashboard");
  check(dashboard.status() === 200 && (await dashboard.text()).includes("3학년의 배움"), "Login routes to grade-manager dashboard");
  pass("Real grade assignment, roster counts, classroom comparison, and server-calculated rates verified");

  for (const gradeId of [fixture.otherGradeId, foreign.gradeId]) {
    check((await api.get(`/api/grade-admin?grade=${gradeId}`)).status() === 403, "Other grade/school API access must fail");
    check(!!(await client.rpc("grade_admin_snapshot", { target_grade: gradeId })).error, "Other grade/school direct RPC must fail");
  }
  const roster = await client.from("student_enrollments").select("id,grade_id");
  check(!roster.error && roster.data.length === 18 && roster.data.every(row => row.grade_id === fixture.gradeId), "Direct DB RLS must exclude other grades and schools");
  const periods = await client.from("academic_periods").select("id");
  check(!periods.error && periods.data.length === 1 && periods.data[0].id === fixture.periodId, "Period metadata must obey RLS");
  check(!!(await client.from("student_enrollments").update({ name: "forbidden" }).eq("id", fixture.students[0].id)).error, "Read-only dashboard cannot mutate students directly");
  check(!!(await client.from("class_progress").update({ completed: false }).eq("classroom_id", fixture.classrooms[0].id)).error, "Direct progress writes cannot bypass future save contracts");
  const badLink = await admin.from("class_progress").insert({ school_id: fixture.schoolId, period_id: fixture.periodId, grade_id: fixture.gradeId, classroom_id: fixture.classrooms[0].id, unit_id: foreign.units[0].id, completed: true });
  check(badLink.error?.code === "23503", "Composite FK must reject cross-school progress links");
  check((await api.get("/api/site-admin")).status() === 403, "Grade manager cannot use site administration");
  const schoolReady = await admin.rpc("mark_password_changed", { target_user: schoolManager.id }); check(!schoolReady.error, "Prepare temporary school-admin account");
  const schoolClient = await direct(schoolManager);
  check(!!(await schoolClient.rpc("grade_admin_snapshot", { target_grade: fixture.gradeId })).error, "School-admin role alone must not route into grade-manager dashboard");
  pass("Other grade/school isolation, read-only writes, cross-school FK, and role boundaries verified through real DB/API");

  for (const [table, id, column, off, on] of [
    ["grade_manager_assignments", fixture.tables.grade_manager_assignments[0].id, "is_active", false, true],
    ["teacher_assignments", fixture.tables.teacher_assignments[0].id, "is_active", false, true],
    ["schools", fixture.schoolId, "is_active", false, true],
    ["academic_periods", fixture.periodId, "status", "archived", "active"],
  ]) {
    const removed = await admin.from(table).update({ [column]: off }).eq("id", id); check(!removed.error, `Temporarily revoke ${table}`);
    check((await api.get(endpoint)).status() === 403, `Existing session must lose access after ${table} change`);
    const rows = await client.from("student_enrollments").select("id"); check(!rows.error && rows.data.length === 0, `RLS must reflect ${table} change`);
    const restored = await admin.from(table).update({ [column]: on }).eq("id", id); check(!restored.error, `Restore only temporary ${table}`);
  }
  const leftSchool = await admin.from("school_memberships").update({ is_active: false }).eq("school_id", fixture.schoolId).eq("user_id", manager.id);
  check(!leftSchool.error && (await api.get(endpoint)).status() === 403, "School membership revocation must apply to existing session");
  pass("Assignment, teacher, school, period, and membership changes immediately revoke existing session access");
} catch (error) { failure = error instanceof Error ? error.message.split(/\r?\n/)[0] : "Grade verification failed"; }
finally {
  for (const client of clients) { try { await client.auth.signOut({ scope: "local" }); } catch { /* Temporary users are deleted below. */ } }
  for (const api of contexts) { try { await api.dispose(); } catch { failure ||= "HTTP cleanup failed"; } }
  if (schoolIds.length) {
    const removed = await admin.from("schools").delete().in("id", schoolIds); if (removed.error) failure ||= "Temporary school cleanup failed";
    const remaining = await admin.from("schools").select("id").in("id", schoolIds);
    if (remaining.error || remaining.data.length) { failure ||= "Temporary school cleanup verification failed"; console.error(`Review temporary schools: ${schoolIds.join(", ")}`); }
  }
  for (const user of users) {
    const cleared = await admin.rpc("reset_login_attempts", { login_name: user.username });
    const removed = await admin.auth.admin.deleteUser(user.id);
    if (cleared.error || removed.error) { failure ||= "Temporary account cleanup failed"; console.error(`Review temporary user: ${user.id}`); }
  }
  if (users.length) {
    const remaining = await admin.from("profiles").select("user_id").in("user_id", users.map(user => user.id));
    if (remaining.error || remaining.data.length) failure ||= "Temporary profile cleanup verification failed";
    else pass("Temporary grade data, schools, memberships, assignments, and test accounts cleaned up");
  }
}
if (failure) { console.error(`FAIL: ${failure}`); process.exitCode = 1; }
else console.log("Real Supabase grade-dashboard verification completed.");
