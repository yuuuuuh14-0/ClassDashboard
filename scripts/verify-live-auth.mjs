// Opt-in integration check against the configured Supabase project and local app.
// Creates only randomly named temporary accounts and removes them in finally.
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
const domain = process.env.AUTH_LOGIN_DOMAIN || "auth.classdashboard.invalid";
if (!url || !key || !secret) throw new Error("Configure the Supabase URL, public key, and server-only key first.");
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const createdIds = [];
const attemptNames = [];
const contexts = [];
const passwords = () => `Verify-${randomBytes(18).toString("base64url")}-Aa1!`;
function check(ok, label) { if (!ok) throw new Error(label); }
function pass(label) { console.log(`PASS: ${label}`); }
async function makeAccount() {
  const username = `verify.${randomBytes(7).toString("hex")}`;
  const email = `${randomUUID()}@${domain}`;
  const password = "000000";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  check(!error && data.user, `Create temporary Auth account (${error?.code || "unknown"})`);
  createdIds.push(data.user.id); attemptNames.push(username);
  const registered = await admin.rpc("register_login_account", {
    target_user: data.user.id, login_name: username, account_name: "로그인 검증용", internal_email: email, site_admin: false,
  });
  check(!registered.error, `Register temporary ID (${registered.error?.code || "unknown"})`);
  return { id: data.user.id, username, email, password };
}
async function context(storageState) {
  const api = await request.newContext({ baseURL: appUrl, extraHTTPHeaders: { Origin: origin }, storageState });
  contexts.push(api); return api;
}

let failure;
try {
  const first = await makeAccount();
  const second = await makeAccount();
  pass("Temporary account creation with confirmed internal authentication identifiers");
  const api = await context();
  const missingName = `missing.${randomBytes(7).toString("hex")}`;
  attemptNames.push(missingName);
  for (const username of [first.username, missingName]) {
    const denied = await api.post("/api/auth/login", { data: { username, password: "wrong-password-2026" } });
    check(denied.status() === 401, "Wrong or missing account must be rejected");
    check((await denied.json()).error === "아이디 또는 비밀번호를 확인해 주세요.", "Credential errors must not identify account existence");
  }
  pass("Wrong passwords and unknown IDs have the same rejection");
  const loggedIn = await api.post("/api/auth/login", { data: { username: ` ${first.username.toUpperCase()} `, password: first.password } });
  check(loggedIn.status() === 200, `ID login returned ${loggedIn.status()}`);
  check((await loggedIn.json()).redirect === "/password", "Temporary password must require change");
  const protectedBefore = await api.get("/dashboard", { maxRedirects: 0 });
  check(protectedBefore.status() === 307 && protectedBefore.headers().location === "/password", "Workspace must be blocked before password change");
  pass("Real ID login and forced first-password change");

  const userClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const userLogin = await userClient.auth.signInWithPassword({ email: first.email, password: first.password });
  check(!userLogin.error, "Direct test-user authentication");
  const own = await userClient.from("profiles").select("user_id,is_site_admin").eq("user_id", first.id);
  check(!own.error && own.data.length === 1 && own.data[0].is_site_admin === false, "Own profile must be readable");
  const other = await userClient.from("profiles").select("user_id").eq("user_id", second.id);
  check(!other.error && other.data.length === 0, "Another account's profile must be hidden by RLS");
  const escalation = await userClient.from("profiles").update({ is_site_admin: true }).eq("user_id", first.id);
  check(!!escalation.error, "Authenticated users must not edit privileged profile fields");
  const mark = await userClient.rpc("mark_password_changed", { target_user: first.id });
  check(!!mark.error, "Authenticated users must not bypass forced password change");
  const resolve = await userClient.rpc("resolve_login", { login_name: second.username });
  check(!!resolve.error, "Authenticated users must not directly resolve internal login identifiers");
  const beforeAccess = await userClient.rpc("can_access_app");
  check(!beforeAccess.error && beforeAccess.data === false, "DB app-access guard must block temporary passwords");
  pass("Real PostgreSQL profile isolation, privilege protection, and password-change guard");
  await userClient.auth.signOut({ scope: "local" });

  const newPassword = passwords();
  for (const password of ["000000", "Aa1!abc", "abcdefgh1!", "ABCDEFGH1!", "Abcdefgh!", "Abcdefgh1", "Abc123  "]) {
    const weak = await api.post("/api/auth/password", { data: { currentPassword: first.password, password, confirmation: password } });
    check(weak.status() === 400, "Server must reject a password missing length or a required character group");
  }
  pass("Initial 000000 password works; new-password length and all four character groups are enforced by the server");
  const wrongCurrent = await api.post("/api/auth/password", { data: { currentPassword: "wrong-password-2026", password: newPassword, confirmation: newPassword } });
  check(wrongCurrent.status() === 400, "Wrong current password must be rejected");
  const changed = await api.post("/api/auth/password", { data: { currentPassword: first.password, password: newPassword, confirmation: newPassword } });
  check(changed.status() === 200, `Real password change returned ${changed.status()}`);
  check((await changed.json()).redirect === "/dashboard", "Password change must return workspace destination");
  const protectedAfter = await api.get("/dashboard", { maxRedirects: 0 });
  check(protectedAfter.status() === 200, `Workspace after password change returned ${protectedAfter.status()}`);
  const profile = await admin.from("profiles").select("password_change_required").eq("user_id", first.id).single();
  check(!profile.error && profile.data.password_change_required === false, "First-change flag must be cleared");
  pass("Real current-password verification, password update, and workspace access");

  const disabled = await admin.from("profiles").update({ is_active: false }).eq("user_id", first.id);
  check(!disabled.error, "Disable only the temporary account");
  const blocked = await api.get("/dashboard", { maxRedirects: 0 });
  check(blocked.status() === 307 && blocked.headers().location === "/login", "Already-signed-in inactive account must lose access");
  const enabled = await admin.from("profiles").update({ is_active: true }).eq("user_id", first.id);
  check(!enabled.error, "Restore temporary account for remaining checks");
  pass("Account deactivation applies to an existing real session");

  const previousCookies = await api.storageState();
  const logout = await api.post("/api/auth/logout");
  check(logout.status() === 200, `Real logout returned ${logout.status()}`);
  const replay = await context(previousCookies);
  const replayed = await replay.get("/dashboard", { maxRedirects: 0 });
  check(replayed.status() === 307 && replayed.headers().location === "/login", "Logged-out cookies must not regain workspace access");
  pass("Real logout and old-cookie replay rejection");
  const again = await api.post("/api/auth/login", { data: { username: first.username, password: newPassword } });
  check(again.status() === 200 && (await again.json()).redirect === "/dashboard", "New password must sign in without first-change redirect");
  const oldPassword = await (await context()).post("/api/auth/login", { data: { username: first.username, password: first.password } });
  check(oldPassword.status() === 401, "The old password must no longer sign in");
  await api.post("/api/auth/logout");
  pass("Changed password works and old password is rejected");
  const directAgain = await userClient.auth.signInWithPassword({ email: first.email, password: newPassword });
  check(!directAgain.error, "Authenticate temporary account for DB session checks");
  const allowedBeforeRevocation = await userClient.rpc("can_access_app");
  check(!allowedBeforeRevocation.error && allowedBeforeRevocation.data === true, "Changed password must allow DB app access");
  const revoke = await userClient.rpc("revoke_current_session");
  check(!revoke.error, "Revoke the direct test session");
  const deniedProfile = await userClient.from("profiles").select("user_id").eq("user_id", first.id);
  const deniedAccess = await userClient.rpc("can_access_app");
  check(!deniedProfile.error && deniedProfile.data.length === 0, "RLS must hide profiles for a revoked JWT session");
  check(!deniedAccess.error && deniedAccess.data === false, "DB app access must reject a revoked JWT session");
  await userClient.auth.signOut({ scope: "local" });
  pass("Real DB session revocation blocks both profile reads and app access");
} catch (error) {
  failure = error instanceof Error ? error.message.split(/\r?\n/)[0] : "Live authentication verification failed";
} finally {
  let cleanupFailed = false;
  for (const api of contexts) {
    try { await api.dispose(); } catch { failure ||= "Test HTTP context disposal failed"; }
  }
  for (const username of attemptNames) {
    try {
      const cleared = await admin.rpc("reset_login_attempts", { login_name: username });
      if (cleared.error) { cleanupFailed = true; failure ||= "Temporary login-attempt cleanup failed"; }
    } catch { cleanupFailed = true; failure ||= "Temporary login-attempt cleanup failed"; }
  }
  for (const id of createdIds) {
    try {
      const removed = await admin.auth.admin.deleteUser(id);
      if (removed.error) throw new Error("delete failed");
    } catch {
      console.error(`Temporary Auth account cleanup required: ${id}`);
      cleanupFailed = true;
      failure ||= "Temporary account cleanup failed";
    }
  }
  if (createdIds.length && !cleanupFailed) {
    const remaining = await admin.from("profiles").select("user_id").in("user_id", createdIds);
    if (remaining.error || remaining.data.length) failure ||= "Temporary profile cleanup verification failed";
    else pass("Temporary accounts and their linked profiles cleaned up");
  }
}
if (failure) { console.error(`FAIL: ${failure}`); process.exitCode = 1; }
else console.log("Real Supabase authentication verification completed.");
