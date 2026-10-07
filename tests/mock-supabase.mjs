// Test-only HTTP double. No application code imports this server.
// This validates SDK/API integration; it is not a replacement for testing DB RLS.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
let accounts, tokens, revoked, attempts;
function reset() {
  accounts = [
    { id: "00000000-0000-4000-8000-000000000001", username: "kim.teacher", display_name: "김선생", email: "teacher@test.invalid", password: "teacher-password-2026", is_active: true, password_change_required: false, is_site_admin: false },
    { id: "00000000-0000-4000-8000-000000000002", username: "new.teacher", display_name: "새선생", email: "new@test.invalid", password: "temporary-password-2026", is_active: true, password_change_required: true, is_site_admin: false },
    { id: "00000000-0000-4000-8000-000000000003", username: "inactive.teacher", display_name: "비활성", email: "inactive@test.invalid", password: "teacher-password-2026", is_active: false, password_change_required: false, is_site_admin: false },
  ];
  tokens = new Map(); revoked = new Set(); attempts = new Map();
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
