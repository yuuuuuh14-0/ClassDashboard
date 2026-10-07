import { NextResponse } from "next/server";
import { currentAccount } from "@/lib/auth/account";
import { userClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/auth/validation";

export async function POST(request: Request) {
  if (!isSameOrigin(request, process.env.APP_ORIGIN)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  try {
    const account = await currentAccount();
    if (account) {
      const revoked = await account.client.rpc("revoke_current_session");
      if (revoked.error) return NextResponse.json({ error: "로그아웃하지 못했습니다. 다시 시도해 주세요." }, { status: 503 });
    }
    const client = account?.client || await userClient();
    await client.auth.signOut({ scope: "local" });
    return NextResponse.json({ redirect: "/login" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "로그아웃하지 못했습니다. 다시 시도해 주세요." }, { status: 503 });
  }
}
