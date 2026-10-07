import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const [rawUsername, displayName, flag] = process.argv.slice(2);
const username = rawUsername?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_PASSWORD;
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const domain = process.env.AUTH_LOGIN_DOMAIN || "auth.classdashboard.invalid";
if (!username || !/^[a-z0-9._-]{4,30}$/.test(username) || !displayName || displayName.length > 80 || (flag && flag !== "--site-admin")) {
  console.error('Usage: npm run auth:create-user -- username "display name" [--site-admin]'); process.exit(1);
}
if (!password || [...password].length < 6 || Buffer.byteLength(password, "utf8") > 72) {
  console.error("Set BOOTSTRAP_PASSWORD to a 6-character minimum temporary password (at most 72 UTF-8 bytes). Do not put passwords in command arguments."); process.exit(1);
}
if (!url || !secret || !domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
  console.error("Set the Supabase connection values and AUTH_LOGIN_DOMAIN in .env.local first."); process.exit(1);
}
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `${randomUUID()}@${domain}`;
const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error || !data.user) { console.error("Could not create the authentication account. Check Supabase settings."); process.exit(1); }
const registered = await admin.rpc("register_login_account", { target_user: data.user.id, login_name: username, account_name: displayName, internal_email: email, site_admin: flag === "--site-admin" });
if (registered.error) {
  const cleanup = await admin.auth.admin.deleteUser(data.user.id);
  console.error("Could not register the login ID. Check for a duplicate username and apply the authentication migration.");
  if (cleanup.error) console.error(`Account cleanup failed. Review Auth user ${data.user.id} in the Supabase dashboard.`);
  process.exit(1);
}
console.log(`Created login account: ${username}. The temporary password must be changed at first login.`);
