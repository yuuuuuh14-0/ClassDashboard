import { NextResponse } from "next/server";
import { adminClient, userClient } from "@/lib/supabase/server";
import { isSameOrigin, LOGIN_ERROR, normalizeUsername, SERVICE_ERROR, validLoginPassword } from "@/lib/auth/validation";

export async function POST(request: Request) {
  if (!isSameOrigin(request, process.env.APP_ORIGIN)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  let input;
  try { input = await request.json(); } catch { return NextResponse.json({ error: LOGIN_ERROR }, { status: 400 }); }
  const username = normalizeUsername(input?.username);
  if (!username || !validLoginPassword(input?.password)) return NextResponse.json({ error: LOGIN_ERROR }, { status: 400 });
  try {
    const admin = adminClient();
    const { data: resolution, error: resolveError } = await admin.rpc("resolve_login", { login_name: username });
    if (resolveError) throw new Error("LOGIN_RESOLUTION_FAILED");
    const resolved = resolution?.[0];
    if (!resolved?.allowed) return NextResponse.json({ error: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429 });
    const client = await userClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: resolved.auth_email || "unknown-account@login.invalid",
      password: input.password,
    });
    if (error || !data.user) return NextResponse.json({ error: LOGIN_ERROR }, { status: 401 });
    const { data: profile, error: profileError } = await client.from("profiles")
      .select("is_active,password_change_required").eq("user_id", data.user.id).maybeSingle();
    if (profileError || !profile?.is_active) {
      await client.auth.signOut({ scope: "local" });
      return NextResponse.json({ error: LOGIN_ERROR }, { status: 401 });
    }
    await admin.rpc("reset_login_attempts", { login_name: username });
    return NextResponse.json({ redirect: profile.password_change_required ? "/password" : "/dashboard" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("Login service unavailable; check server configuration and migration.");
    return NextResponse.json({ error: SERVICE_ERROR }, { status: 503 });
  }
}
