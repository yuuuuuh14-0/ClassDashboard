import { NextResponse } from "next/server";
import { currentAccount } from "@/lib/auth/account";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: Request) {
  try {
    const account = await currentAccount();
    if (!account) return json({ error: "다시 로그인해 주세요." }, 401);
    if (account.profile.password_change_required) return json({ error: "비밀번호를 먼저 변경해 주세요." }, 403);
    const gradeId = new URL(request.url).searchParams.get("grade");
    if (!gradeId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gradeId)) return json({ error: "조회할 학년을 확인해 주세요." }, 400);
    const { data, error } = await account.client.rpc("grade_admin_snapshot", { target_grade: gradeId });
    if (error?.code === "42501") return json({ error: "이 학년의 조회 권한이 없습니다." }, 403);
    if (error || !data) throw new Error("GRADE_LOAD_FAILED");
    return json(data);
  } catch { return json({ error: "학년 정보를 불러오지 못했습니다. 다시 시도해 주세요." }, 503); }
}
