// Test-only HTTP double. No application code imports this server.
// This validates SDK/API integration; it is not a replacement for testing DB RLS.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { gradeFixture } from "../scripts/grade-fixture.mjs";
import { workspaceMock } from "./mock-workspace.mjs";
let accounts, tokens, revoked, attempts, schools, memberships, changes, gradeData, workspace;
function reset() {
  accounts = [
    { id: "00000000-0000-4000-8000-000000000001", username: "kim.teacher", display_name: "김선생", email: "teacher@test.invalid", password: "teacher-password-2026", is_active: true, password_change_required: false, is_site_admin: false },
    { id: "00000000-0000-4000-8000-000000000002", username: "new.teacher", display_name: "새선생", email: "new@test.invalid", password: "000000", is_active: true, password_change_required: true, is_site_admin: false },
    { id: "00000000-0000-4000-8000-000000000003", username: "inactive.teacher", display_name: "비활성", email: "inactive@test.invalid", password: "teacher-password-2026", is_active: false, password_change_required: false, is_site_admin: false },
    { id: "00000000-0000-4000-8000-000000000004", username: "site.admin", display_name: "사이트 관리자", email: "admin@test.invalid", password: "Admin-password-2026!", is_active: true, password_change_required: false, is_site_admin: true },
    { id: "00000000-0000-4000-8000-000000000005", username: "lee.teacher", display_name: "이선생", email: "lee@test.invalid", password: "teacher-password-2026", is_active: true, password_change_required: false, is_site_admin: false },
    { id: "00000000-0000-4000-8000-000000000006", username: "grade.admin", display_name: "테스트 학년 관리자", email: "grade@test.invalid", password: "Grade-password-2026!", is_active: true, password_change_required: false, is_site_admin: false },
    { id: "00000000-0000-4000-8000-000000000007", username: "school.admin", display_name: "테스트 학교 관리자", email: "school@test.invalid", password: "School-password-2026!", is_active: true, password_change_required: false, is_site_admin: false },
    { id: "00000000-0000-4000-8000-000000000008", username: "test.teacher", display_name: "테스트 선생님", email: "assigned@test.invalid", password: "Teacher-password-2026!", is_active: true, password_change_required: false, is_site_admin: false },
  ];
  tokens = new Map(); revoked = new Set(); attempts = new Map();
  schools = []; memberships = []; changes = [];
  gradeData = gradeFixture("browser-grade", "대시보드 테스트 초등학교", accounts[5].id, accounts[6].id);
  workspace = workspaceMock(accounts, gradeData);
}
reset();
const user = a => ({ id: a.id, aud: "authenticated", role: "authenticated", email: a.email, email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" });
function session(a) {
  const sid = randomUUID(), now = Math.floor(Date.now() / 1000);
  const encode = v => Buffer.from(JSON.stringify(v)).toString("base64url");
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: a.id, email: a.email, aud: "authenticated", role: "authenticated", session_id: sid, iat: now, exp: now + 3600 })}.test-signature`;
  tokens.set(token, { a, sid });
  return { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: randomUUID(), user: user(a) };
}
createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:54329");
  const send = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
  if (url.pathname === "/health") return send(200, { ok: true });
  if (url.pathname === "/__test/reset") { reset(); return send(200, { ok: true }); }
  let body = ""; for await (const part of req) body += part;
  const input = body ? JSON.parse(body) : {};
  const authorization = req.headers.authorization?.replace(/^Bearer /, "");
  const authenticated = tokens.get(authorization);
  if (url.pathname === "/auth/v1/admin/users" && authorization === "test-server-only-key") {
    const a = { id:randomUUID(),email:input.email,password:input.password }; accounts.push(a); return send(200,user(a));
  }
  if (url.pathname.startsWith("/auth/v1/admin/users/") && authorization === "test-server-only-key") {
    const a=accounts.find(a => a.id === url.pathname.split("/").at(-1));
    if (req.method === "DELETE") { accounts.splice(accounts.indexOf(a),1); return send(200,{}); }
    if (a) { a.password=input.password; return send(200,user(a)); }
  }
  if (url.pathname === "/auth/v1/token") {
    const a = accounts.find(a => a.email === input.email && a.password === input.password);
    if (!a) return send(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
    return send(200, session(a));
  }
  if (url.pathname === "/auth/v1/user") {
    if (!authenticated) return send(401, { msg: "Invalid JWT" });
    if (req.method === "PUT") authenticated.a.password = input.password;
    return send(200, user(authenticated.a));
  }
  if (url.pathname === "/auth/v1/logout") return send(200, {});
  if (url.pathname === "/rest/v1/profiles") {
    const a = authenticated?.a;
    if (!a || !a.is_active || revoked.has(authenticated.sid)) return send(200, []);
    return send(200, [{ user_id: a.id, username: a.username, display_name: a.display_name, is_active: a.is_active, is_site_admin: a.is_site_admin, password_change_required: a.password_change_required }]);
  }
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = url.pathname.split("/").at(-1);
    if (!authenticated || !revoked.has(authenticated.sid)) {
      if (fn !== "school_register_teacher" || authorization === "test-server-only-key") {
        const result = workspace.handle(fn,input,authenticated?.a);
        if (result) return send(...result);
      }
    }
    if (fn === "dashboard_access" || fn === "grade_admin_snapshot") {
      const a = authenticated?.a;
      if (!a?.is_active || a.password_change_required || revoked.has(authenticated.sid)) return send(403, { code: "42501" });
      const isGradeManager = a.username === "grade.admin";
      const context = { id: gradeData.gradeId, school_name: "대시보드 테스트 초등학교", academic_year: 2026, semester: 2, grade_number: 3, status: "active" };
      if (fn === "dashboard_access") return send(200, { school_role: a.username === "school.admin" ? "school_admin" : memberships.find(m => m.user_id === a.id)?.role || null, school_name: ["school.admin","grade.admin"].includes(a.username) ? context.school_name : null, grades: isGradeManager ? [context] : [] });
      if (!isGradeManager || input.target_grade !== gradeData.gradeId) return send(403, { code: "42501" });
      return send(200, {
        context: { ...context, own_classroom_id: gradeData.classrooms[0].id },
        subjects: gradeData.subjects.map(subject => ({ id: subject.id, name: subject.name, units: gradeData.units.filter(unit => unit.subject_id === subject.id).map(unit => ({ id: unit.id, title: unit.title })) })),
        classrooms: gradeData.classrooms.map((classroom,index) => ({ ...classroom, teacher_name: index === 0 ? a.display_name : null, student_count: 6,
          subjects: gradeData.subjects.map(subject => {
            const units = gradeData.units.filter(unit => unit.subject_id === subject.id);
            const completed = gradeData.progress.filter(progress => progress.classroom_id === classroom.id && units.some(unit => unit.id === progress.unit_id)).length;
            return { subject_id: subject.id, completed, total: units.length, percentage: units.length ? Math.round(completed * 1000 / units.length) / 10 : null };
          }), completed_unit_ids: gradeData.progress.filter(progress => progress.classroom_id === classroom.id).map(progress => progress.unit_id),
        })), students: gradeData.students, updated_at: new Date().toISOString(),
      });
    }
    if (["site_admin_snapshot", "site_admin_save_school", "site_admin_set_manager"].includes(fn)) {
      const a = authenticated?.a;
      if (!a?.is_active || !a.is_site_admin || a.password_change_required || revoked.has(authenticated.sid)) return send(403, { code: "42501" });
      const schoolAdmins = schoolId => memberships.filter(m => m.school_id === schoolId && m.role === "school_admin").map(m => {
        const account = accounts.find(account => account.id === m.user_id);
        return { user_id: account.id, display_name: account.display_name, username: account.username };
      });
      const addLog = (school, action) => changes.unshift({ id: randomUUID(), school_name: school.name, action, actor_name: a.display_name, created_at: new Date().toISOString() });
      if (fn === "site_admin_snapshot") return send(200, {
        schools: schools.map(s => ({ ...s, administrators: schoolAdmins(s.id) })),
        accounts: accounts.filter(account => account.is_active && !account.is_site_admin).map(account => ({ user_id: account.id, display_name: account.display_name, username: account.username, school_id: memberships.find(m => m.user_id === account.id)?.school_id || null })),
        active_accounts: accounts.filter(account => account.is_active).length, recent_changes: changes.slice(0, 6), updated_at: new Date().toISOString(),
      });
      const school = schools.find(s => s.id === input.target_school);
      if (input.target_school && !school) return send(404, { code: "P0002" });
      if (school && school.version !== input.expected_version) return send(409, { code: "PT409" });
      if (fn === "site_admin_save_school") {
        if (!school) {
          const created = { id: randomUUID(), name: input.school_name.trim(), is_active: true, version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          schools.unshift(created); addLog(created, "created"); return send(200, created.id);
        }
        school.name = input.school_name.trim(); school.version++; school.updated_at = new Date().toISOString();
        const action = input.active === null ? "renamed" : input.active ? "restored" : "paused";
        if (input.active !== null) school.is_active = input.active;
        addLog(school, action); return send(200, school.id);
      }
      if (!school.is_active) return send(400, { code: "22023" });
      const account = accounts.find(account => account.id === input.target_user && account.is_active && !account.is_site_admin);
      if (!account) return send(400, { code: "22023" });
      let membership = memberships.find(m => m.user_id === account.id);
      if (membership && membership.school_id !== school.id) return send(409, { code: "23505" });
      if (!input.assign && schoolAdmins(school.id).length <= 1) return send(409, { code: "23514" });
      if (!membership) { membership = { school_id: school.id, user_id: account.id }; memberships.push(membership); }
      membership.role = input.assign ? "school_admin" : "teacher";
      school.version++; school.updated_at = new Date().toISOString();
      addLog(school, input.assign ? "admin_assigned" : "admin_removed"); return send(200, null);
    }
    if (fn === "revoke_current_session") {
      if (!authenticated) return send(401, {});
      revoked.add(authenticated.sid); return send(200, null);
    }
    if (authorization !== "test-server-only-key") return send(403, {});
    if (fn === "resolve_login") {
      const count = (attempts.get(input.login_name) || 0) + 1;
      attempts.set(input.login_name, count);
      return send(200, [{ allowed: count <= 10, auth_email: accounts.find(a => a.username === input.login_name)?.email || null }]);
    }
    if (fn === "reset_login_attempts") { attempts.delete(input.login_name); return send(200, null); }
    if (fn === "mark_password_changed") { accounts.find(a => a.id === input.target_user).password_change_required = false; return send(200, null); }
  }
  send(404, { error: "Unimplemented test endpoint" });
}).listen(54329, "127.0.0.1");
