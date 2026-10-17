import { NextResponse } from "next/server";
export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export function workspaceError(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "42501") return json({ error: "배정 또는 권한이 변경되었습니다. 대시보드를 다시 열어 주세요." }, 403);
  if (code === "PT409") return json({ error: "정보가 변경되었거나 보관된 학기입니다. 새로고침 후 다시 확인해 주세요." }, 409);
  if (code === "23505") return json({ error: "같은 번호·계정·학기가 이미 있거나, 선생님이 다른 반에 배정되어 있습니다." }, 409);
  if (code === "23514") return json({ error: "입력 범위를 확인하고, 학기 시작 전 모든 반의 담임과 학년 관리자를 배정해 주세요." }, 400);
  if (["22023", "22P02", "23502", "23503"].includes(code || "")) return json({ error: "입력 내용과 적용 범위를 다시 확인해 주세요." }, 400);
  return json({ error: "요청을 완료하지 못했습니다. 새로고침으로 저장 여부를 확인해 주세요." }, 503);
}
