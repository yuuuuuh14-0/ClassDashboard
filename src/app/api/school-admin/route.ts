import { randomUUID } from "node:crypto";
import { currentAccount } from "@/lib/auth/account";
import { isSameOrigin } from "@/lib/auth/validation";
import { adminClient } from "@/lib/supabase/server";
import { schoolSnapshot } from "@/lib/workspace/server";
import { json, workspaceError } from "@/lib/workspace/http";
import { uuid, validSchoolMutation } from "@/lib/workspace/validation";

export async function GET(request: Request) {
  try {
    const a = await currentAccount();
    if (!a) return json({ error: "다시 로그인해 주세요." }, 401);
    if (a.profile.password_change_required) return json({ error: "먼저 비밀번호를 변경해 주세요." }, 403);
    const period = new URL(request.url).searchParams.get("period");
    if (period && !uuid(period)) return json({ error: "올바른 학기를 선택해 주세요." }, 400);
    return json(await schoolSnapshot(a.client, period));
  } catch (error) { return workspaceError(error); }
}
export async function POST(request: Request) {
  if (!isSameOrigin(request, process.env.APP_ORIGIN)) return json({ error: "허용되지 않은 요청입니다." }, 403);
  try {
    const a = await currentAccount();
    if (!a) return json({ error: "다시 로그인해 주세요." }, 401);
    if (a.profile.password_change_required) return json({ error: "먼저 비밀번호를 변경해 주세요." }, 403);
    let input: unknown;
    try { input = await request.json(); } catch { return json({ error: "입력 형식을 확인해 주세요." }, 400); }
    if (!validSchoolMutation(input)) return json({ error: "입력 내용과 필수 항목을 확인해 주세요." }, 400);
    const { payload, version } = input;
    // User-client RPC revalidates live school role and expected version under lock.
    if (payload.action === "teacher_create") {
      const snapshot = await schoolSnapshot(a.client);
      if (snapshot.school.version !== version) return workspaceError({ code: "PT409" });
      const admin = adminClient(), email = `${randomUUID()}@${process.env.AUTH_LOGIN_DOMAIN || "auth.classdashboard.invalid"}`;
      const created = await admin.auth.admin.createUser({ email, password: "000000", email_confirm: true });
      if (created.error || !created.data.user) return json({ error: "계정을 만들지 못했습니다. 다시 시도해 주세요." }, 503);
      const userId = created.data.user.id;
      const registered = await admin.rpc("school_register_teacher", { actor: a.user.id, target_user: userId, login_name: payload.username, account_name: String(payload.name).trim(), internal_email: email, target_school: snapshot.school.id, expected_version: version });
      if (registered.error) {
        const cleanup = await admin.auth.admin.deleteUser(userId);
        if (cleanup.error) console.error("Provisioning cleanup required for Auth identity", userId);
        return workspaceError(registered.error);
      }
    } else {
      const result = await a.client.rpc("school_workspace_mutate", { payload, expected_version: version });
      if (result.error) return workspaceError(result.error);
      if (payload.action === "member_reset") {
        // The atomic RPC already requires a new password and revokes old sessions.
        const admin = adminClient();
        const changed = await admin.auth.admin.updateUserById(String(payload.user_id), { password: "000000" });
        if (changed.error) return json({ error: "기존 세션은 차단했습니다. 초기 비밀번호 설정에 실패했으니 새로고침 후 초기화를 다시 실행해 주세요." }, 503);
        const target = await admin.from("profiles").select("username").eq("user_id", String(payload.user_id)).single();
        if (!target.error) await admin.rpc("reset_login_attempts", { login_name: target.data.username });
      }
    }
    return json({ ok: true });
  } catch (error) { return workspaceError(error); }
}
