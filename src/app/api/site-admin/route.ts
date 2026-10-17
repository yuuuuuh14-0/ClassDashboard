import { NextResponse } from "next/server";
import { currentAccount } from "@/lib/auth/account";
import { isSameOrigin } from "@/lib/auth/validation";
import { siteAdminSnapshot } from "@/lib/site-admin/server";
import { parseAdminMutation } from "@/lib/site-admin/validation";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function authorize() {
  const account = await currentAccount();
  if (!account) return json({ error: "다시 로그인해 주세요." }, 401);
  if (account.profile.password_change_required) return json({ error: "먼저 비밀번호를 변경해 주세요." }, 403);
  if (!account.profile.is_site_admin) return json({ error: "사이트 관리자만 사용할 수 있습니다." }, 403);
  return account;
}

export async function GET() {
  try {
    const account = await authorize();
    if (account instanceof NextResponse) return account;
    return json(await siteAdminSnapshot(account.client));
  } catch {
    return json({ error: "운영 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." }, 503);
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request, process.env.APP_ORIGIN)) return json({ error: "허용되지 않은 요청입니다." }, 403);
  try {
    const account = await authorize();
    if (account instanceof NextResponse) return account;
    let input: unknown;
    try { input = await request.json(); } catch { return json({ error: "입력 내용을 확인해 주세요." }, 400); }
    const command = parseAdminMutation(input);
    if (!command) return json({ error: "학교 이름(1~80자)과 입력 내용을 확인해 주세요." }, 400);
    const result = command.action === "set_manager"
      ? await account.client.rpc("site_admin_set_manager", { target_school: command.id, target_user: command.user_id, expected_version: command.version, assign: command.assign })
      : await account.client.rpc("site_admin_save_school", {
        school_name: command.name, target_school: command.action === "save_school" ? command.id : null,
        expected_version: command.action === "save_school" ? command.version : null,
        active: command.action === "save_school" ? command.active ?? null : null,
      });
    if (result.error) {
      const code = result.error.code;
      if (code === "42501") return json({ error: "접근 권한이 변경됐습니다. 다시 로그인해 주세요." }, 403);
      if (code === "PT409" || code === "40001") return json({ error: "다른 관리자가 정보를 변경했습니다. 새로고침 후 다시 확인해 주세요." }, 409);
      if (code === "23505") return json({ error: "이미 다른 학교에 소속된 계정입니다." }, 409);
      if (code === "23514") return json({ error: "새 관리자를 먼저 지정한 뒤 기존 관리자를 해제해 주세요." }, 409);
      if (code === "P0002") return json({ error: "대상을 찾지 못했습니다. 새로고침해 주세요." }, 404);
      if (code === "22023") return json({ error: "사용 중인 학교와 활성 계정을 선택해 주세요." }, 400);
      throw new Error("SITE_ADMIN_SAVE_FAILED");
    }
    // The write has committed. Let the client refresh separately, so a refresh
    // failure cannot be mistaken for a failed write and cause a duplicate create.
    return json({ ok: true, id: result.data });
  } catch {
    return json({ error: "저장 결과를 확인하지 못했습니다. 새로고침으로 반영 여부를 먼저 확인해 주세요." }, 503);
  }
}
