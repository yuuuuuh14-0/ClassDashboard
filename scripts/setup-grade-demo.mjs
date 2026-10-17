import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { gradeFixture, seedGradeFixture } from "./grade-fixture.mjs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) throw new Error("Configure Supabase first.");
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
async function account(username, name) {
  const existing = await admin.from("profiles").select("user_id,is_active,is_site_admin").eq("username", username).maybeSingle();
  if (existing.error) throw new Error("Profile lookup failed.");
  if (existing.data) {
    if (!existing.data.is_active || existing.data.is_site_admin) throw new Error(`Existing ${username} is not an active test teacher.`);
    console.log(`Existing ${username} kept; its password was not changed.`);
    return existing.data.user_id;
  }
  const email = `${randomUUID()}@${process.env.AUTH_LOGIN_DOMAIN || "auth.classdashboard.invalid"}`;
  const created = await admin.auth.admin.createUser({ email, password: "000000", email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`Could not create ${username}.`);
  const userId = created.data.user.id;
  const registered = await admin.rpc("register_login_account", { target_user: userId, login_name: username, account_name: name, internal_email: email, site_admin: false });
  if (registered.error) {
    const cleanup = await admin.auth.admin.deleteUser(userId);
    if (cleanup.error) console.error(`Temporary account cleanup required: ${userId}`);
    throw new Error(`Could not register ${username}.`);
  }
  console.log(`Created ${username}; initial password change is required.`);
  return userId;
}
const schoolManagerId = await account("school.admin", "테스트 학교 관리자");
const gradeManagerId = await account("grade.admin", "테스트 학년 관리자");
const fixture = gradeFixture("classdashboard-grade-demo-v1", "대시보드 테스트 초등학교", gradeManagerId, schoolManagerId);
const memberships = await admin.from("school_memberships").select("user_id,school_id").in("user_id", [schoolManagerId, gradeManagerId]).eq("is_active", true);
if (memberships.error || memberships.data.some(row => row.school_id !== fixture.schoolId)) throw new Error("A test account already belongs to another school; no assignments were changed.");
await seedGradeFixture(admin, fixture);
console.log("Grade demo ready: 2026 semester 2, grade 3, 3 classrooms, 18 example students, 6 subjects. Grade manager: classroom 1.");
