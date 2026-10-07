import { requireAccount } from "@/lib/auth/account";
import { Brand } from "@/components/brand";
import { LogoutButton } from "@/components/account-actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { profile } = await requireAccount();
  return <main className="account-page"><header className="app-header"><Brand /><LogoutButton /></header>
    <section className="welcome-card"><span className="eyebrow">MY WORKSPACE</span><h1>{profile.display_name}님, 반갑습니다.</h1><p className="login-description">로그인한 계정 정보를 확인해 주세요.</p>
      <dl className="account-details"><div><dt>이름</dt><dd>{profile.display_name}</dd></div><div><dt>아이디</dt><dd>{profile.username}</dd></div><div><dt>계정</dt><dd>{profile.is_site_admin ? "사이트 관리자" : "선생님"}</dd></div><div><dt>상태</dt><dd><span className="status-pill">로그인 완료</span></dd></div></dl>
      {!profile.is_site_admin && <div className="notice"><strong>담당 학급 배정을 기다리고 있어요.</strong><p>학교 관리자에게 학급 배정을 요청해 주세요.</p></div>}
      <a className="secondary-button inline-button" href="/password">비밀번호 변경</a>
    </section>
  </main>;
}
