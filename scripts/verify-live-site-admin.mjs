// Exercises only randomly named temporary accounts and schools, then removes them.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { request } from "@playwright/test";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.AUTH_TEST_APP_URL || "http://localhost:3000";
const origin = process.env.APP_ORIGIN || new URL(appUrl).origin;
if (!url || !key || !secret) throw new Error("Configure the Supabase connection first.");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, options);
const users = [], contexts = [], schoolIds = [], clients = [];
const prefix = `verify-school-${randomBytes(8).toString("hex")}`;
const password = () => `Verify-${randomBytes(18).toString("base64url")}-Aa1!`;
const check = (ok, label) => { if (!ok) throw new Error(label); };
const pass = label => console.log(`PASS: ${label}`);
async function makeUser(siteAdmin = false) {
  const username = `verify.${randomBytes(7).toString("hex")}`;
  const email = `${randomUUID()}@${process.env.AUTH_LOGIN_DOMAIN || "auth.classdashboard.invalid"}`;
  const initialPassword = password();
  const result = await admin.auth.admin.createUser({ email, password: initialPassword, email_confirm: true });
  check(!result.error && result.data.user, "Create temporary user");
  const user = { id: result.data.user.id, username, email, password: initialPassword };
  users.push(user);
  const registered = await admin.rpc("register_login_account", { target_user: user.id, login_name: username, account_name: "대시보드 검증용", internal_email: email, site_admin: siteAdmin });
  check(!registered.error, "Register temporary user");
  return user;
}
async function apiContext() {
  const api = await request.newContext({ baseURL: appUrl, extraHTTPHeaders: { Origin: origin }, timeout: 20_000 });
  contexts.push(api); return api;
}
async function directClient(user) {
  const client = createClient(url, key, options); clients.push(client);
  const signed = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  check(!signed.error, "Authenticate temporary DB caller"); return client;
}

let failure;
try {
  const operator = await makeUser(true), first = await makeUser(), replacement = await makeUser();
  const api = await apiContext();
  check((await api.get("/api/site-admin")).status() === 401, "Anonymous dashboard request must fail");
  check((await api.post("/api/auth/login", { data: { username: operator.username, password: operator.password } })).status() === 200, "Temporary administrator login");
  check((await api.get("/api/site-admin")).status() === 403, "Initial-password admin must not read dashboard");
  const initialClient = await directClient(operator);
  check(!!(await initialClient.rpc("site_admin_snapshot")).error, "DB must deny initial-password admin");
  const nextPassword = password();
  check((await api.post("/api/auth/password", { data: { currentPassword: operator.password, password: nextPassword, confirmation: nextPassword } })).status() === 200, "Administrator initial password change");
  operator.password = nextPassword;
  pass("Both API and DB enforce login, site-admin role, and mandatory password change");

  async function snapshot() {
    const response = await api.get("/api/site-admin");
    check(response.status() === 200, "Load actual administrator snapshot"); return response.json();
  }
  async function mutation(command, status = 200) {
    console.log(`CHECK: ${command.action}${"assign" in command ? command.assign ? " assign" : " remove" : ""} (${status})`);
    const response = await api.post("/api/site-admin", { data: command });
    check(response.status() === status, `${command.action} expected ${status}, received ${response.status()}`);
    return response.json();
  }
  async function school(id) { return (await snapshot()).schools.find(school => school.id === id); }
  const firstSchool = (await mutation({ action: "create_school", name: `${prefix}-A` })).id;
  schoolIds.push(firstSchool);
  const secondSchool = (await mutation({ action: "create_school", name: `${prefix}-B` })).id;
  schoolIds.push(secondSchool);
  let saved = await school(firstSchool);
  check(saved?.name === `${prefix}-A` && saved.version === 1, "Created school must persist");
  await mutation({ action: "save_school", id: firstSchool, name: `${prefix}-renamed`, version: saved.version });
  await mutation({ action: "save_school", id: firstSchool, name: `${prefix}-stale`, version: saved.version }, 409);
  check((await school(firstSchool)).name === `${prefix}-renamed`, "Stale write must not overwrite persisted name");
  pass("Real school persistence and optimistic concurrency reject stale writes");

  saved = await school(firstSchool);
  await mutation({ action: "set_manager", id: firstSchool, user_id: first.id, version: saved.version, assign: true });
  saved = await school(firstSchool);
  check(saved.administrators.some(account => account.user_id === first.id), "School administrator assignment must persist");
  await mutation({ action: "set_manager", id: firstSchool, user_id: first.id, version: saved.version, assign: false }, 409);
  const otherSchool = await school(secondSchool);
  await mutation({ action: "set_manager", id: secondSchool, user_id: first.id, version: otherSchool.version, assign: true }, 409);
  await mutation({ action: "set_manager", id: firstSchool, user_id: replacement.id, version: saved.version, assign: true });
  saved = await school(firstSchool);
  await mutation({ action: "set_manager", id: firstSchool, user_id: first.id, version: saved.version, assign: false });
  saved = await school(firstSchool);
  check(saved.administrators.length === 1 && saved.administrators[0].user_id === replacement.id, "Replacement must remain assigned");
  const membership = await admin.from("school_memberships").select("role,is_active").eq("school_id", firstSchool).eq("user_id", first.id).single();
  check(!membership.error && membership.data.role === "teacher" && membership.data.is_active, "Removing manager permission must retain school membership");
  pass("Administrator replacement, last-manager protection, and cross-school isolation work in PostgreSQL");

  await mutation({ action: "save_school", id: firstSchool, name: saved.name, version: saved.version, active: false });
  saved = await school(firstSchool);
  check(saved.is_active === false, "School pause persists");
  await mutation({ action: "set_manager", id: firstSchool, user_id: first.id, version: saved.version, assign: true }, 400);
  await mutation({ action: "save_school", id: firstSchool, name: saved.name, version: saved.version, active: true });
  saved = await school(firstSchool);
  check(saved.is_active && saved.administrators.some(account => account.user_id === replacement.id), "Restore must preserve administrator assignment");
  const recent = (await snapshot()).recent_changes;
  check(recent.some(entry => entry.school_name === saved.name && entry.action === "restored"), "Persisted audit log must record restore");
  pass("School pause and restore preserve data and record audit events");

  const ready = await admin.rpc("mark_password_changed", { target_user: first.id });
  check(!ready.error, "Prepare only temporary teacher for permission tests");
  const teacher = await directClient(first);
  const hidden = await teacher.from("schools").select("id");
  check(!hidden.error && hidden.data.length === 0, "RLS must hide school administration data from teacher");
  check(!!(await teacher.from("schools").insert({ name: `${prefix}-forbidden` })).error, "Direct table insert must be denied");
  check(!!(await teacher.rpc("site_admin_snapshot")).error, "Teacher must not call snapshot RPC");
  check(!!(await teacher.rpc("site_admin_save_school", { school_name: `${prefix}-forbidden` })).error, "Teacher must not call school mutation RPC");
  const teacherApi = await apiContext();
  await teacherApi.post("/api/auth/login", { data: { username: first.username, password: first.password } });
  check((await teacherApi.get("/api/site-admin")).status() === 403, "Teacher API must be forbidden");
  const schoolAdminReady = await admin.rpc("mark_password_changed", { target_user: replacement.id });
  check(!schoolAdminReady.error, "Prepare only temporary school administrator");
  const schoolAdmin = await directClient(replacement);
  check(!!(await schoolAdmin.rpc("site_admin_snapshot")).error, "School administrator must not gain site administration");
  const ownMembership = await schoolAdmin.from("school_memberships").select("id");
  check(!ownMembership.error && !ownMembership.data.length, "School manager cannot enumerate global memberships");
  const siteClient = await directClient(operator);
  check(!!(await siteClient.from("schools").insert({ name: `${prefix}-bypass` })).error, "Even site admins must use audited mutation RPCs");
  pass("Direct DB/API requests cannot bypass teacher or school-admin restrictions or audited writes");

  await admin.from("profiles").update({ is_site_admin: false }).eq("user_id", operator.id).throwOnError();
  check((await api.get("/api/site-admin")).status() === 403, "Role revocation must invalidate an existing session's access");
  check(!!(await siteClient.rpc("site_admin_snapshot")).error, "DB must recheck current role after revocation");
  pass("Revoking site-admin permission takes effect immediately on existing API and DB sessions");
} catch (error) {
  // HTTP error details may include cookies; print only the first diagnostic line.
  failure = error instanceof Error ? error.message.split(/\r?\n/)[0] : "Live dashboard verification failed";
} finally {
  for (const client of clients) { try { await client.auth.signOut({ scope: "local" }); } catch { /* Temporary users are deleted below. */ } }
  for (const api of contexts) { try { await api.dispose(); } catch { failure ||= "HTTP context cleanup failed"; } }
  const leftover = await admin.from("schools").select("id").like("name", `${prefix}%`);
  const ids = [...new Set([...schoolIds, ...(leftover.data || []).map(school => school.id)])];
  if (leftover.error) failure ||= "Temporary school lookup failed";
  if (ids.length) {
    const removed = await admin.from("schools").delete().in("id", ids);
    if (removed.error) { failure ||= "Temporary school cleanup failed"; console.error(`Review temporary schools: ${ids.join(", ")}`); }
  }
  for (const user of users) {
    const cleared = await admin.rpc("reset_login_attempts", { login_name: user.username });
    const removed = await admin.auth.admin.deleteUser(user.id);
    if (cleared.error || removed.error) { failure ||= "Temporary user cleanup failed"; console.error(`Review temporary user: ${user.id}`); }
  }
  const schoolsLeft = ids.length ? await admin.from("schools").select("id").in("id", ids) : { data: [], error: null };
  const profilesLeft = users.length ? await admin.from("profiles").select("user_id").in("user_id", users.map(user => user.id)) : { data: [], error: null };
  if (schoolsLeft.error || profilesLeft.error || schoolsLeft.data.length || profilesLeft.data.length) failure ||= "Temporary data cleanup verification failed";
  else pass("Temporary schools, memberships, audit records, and accounts cleaned up");
}
if (failure) { console.error(`FAIL: ${failure}`); process.exitCode = 1; }
else console.log("Real Supabase site-admin verification completed.");
