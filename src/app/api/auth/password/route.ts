import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { currentAccount } from "@/lib/auth/account";
import { isSameOrigin, passwordError, validLoginPassword } from "@/lib/auth/validation";
import { adminClient } from "@/lib/supabase/server";
import { authConfig } from "@/lib/supabase/config";

export async function POST(request: Request) {
  if (!isSameOrigin(request, process.env.APP_ORIGIN)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  try {
    const account = await currentAccount();
    if (!account) return NextResponse.json({ error: "다시 로그인해 주세요." }, { status: 401 });
    const input = await request.json();
    const error = passwordError(input?.password, input?.confirmation, input?.currentPassword);
    if (error || !validLoginPassword(input?.currentPassword)) return NextResponse.json({ error: error || "현재 비밀번호를 입력해 주세요." }, { status: 400 });
    const config = authConfig()!;
    const verifier = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
    const verification = await verifier.auth.signInWithPassword({ email: account.user.email!, password: input.currentPassword });
    if (verification.error || verification.data.user?.id !== account.user.id) return NextResponse.json({ error: "현재 비밀번호를 확인해 주세요." }, { status: 400 });
    // Verification is a temporary session, not the user's cookie-backed session.
    await verifier.auth.signOut({ scope: "local" });
    const update = await account.client.auth.updateUser({ password: input.password });
    if (update.error) return NextResponse.json({ error: "비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 400 });
    const marked = await adminClient().rpc("mark_password_changed", { target_user: account.user.id });
    if (marked.error) return NextResponse.json({ error: "비밀번호는 변경됐지만 완료 처리가 지연됐습니다. 현재 비밀번호에 새 비밀번호를 입력해 다시 진행해 주세요." }, { status: 503 });
    return NextResponse.json({ redirect: "/dashboard" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "비밀번호를 변경할 수 없습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
}
