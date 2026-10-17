import { currentAccount } from "@/lib/auth/account";
import { isSameOrigin } from "@/lib/auth/validation";
import { teacherSnapshot } from "@/lib/workspace/server";
import { json, workspaceError } from "@/lib/workspace/http";
import { uuid, validProgress } from "@/lib/workspace/validation";
export async function GET(request: Request) {
  try {
    const a = await currentAccount();
    if (!a) return json({ error: "다시 로그인해 주세요." }, 401);
    if (a.profile.password_change_required) return json({ error: "먼저 비밀번호를 변경해 주세요." }, 403);
    const classroom = new URL(request.url).searchParams.get("classroom");
    if (classroom && !uuid(classroom)) return json({ error: "올바른 학급을 선택해 주세요." }, 400);
    return json(await teacherSnapshot(a.client, classroom));
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
    if (!validProgress(input)) return json({ error: "진도 항목을 확인해 주세요." }, 400);
    const result = await a.client.rpc("save_class_progress", { target_classroom: input.classroom_id, target_unit: input.unit_id, done: input.completed, expected_version: input.version });
    return result.error ? workspaceError(result.error) : json({ ok: true });
  } catch (error) { return workspaceError(error); }
}
