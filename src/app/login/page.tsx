import { redirect } from "next/navigation";
import { currentAccount } from "@/lib/auth/account";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const account = await currentAccount();
  if (account) redirect(account.profile.password_change_required ? "/password" : "/dashboard");
  return <main className="login-layout">
    <section className="intro-panel" aria-labelledby="intro-title">
      <Brand />
      <div className="intro-content"><span className="eyebrow">선생님의 수업을 함께</span>
        <h1 id="intro-title">우리 반의 배움,<br />한눈에 살펴보세요.</h1>
        <p className="intro-description">수업 진도는 차곡차곡 기록하고,<br />같은 학년의 흐름은 함께 살펴보세요.</p>
        <div className="preview-card" aria-hidden="true"><div className="preview-header"><span className="preview-icon">✓</span><strong>오늘도 한 걸음 앞으로</strong><span className="preview-dot" /></div>
          <div className="preview-subject"><span>국어</span><div className="preview-track"><i style={{ width: "62%" }} /></div><span>5 / 8</span></div>
          <div className="preview-subject"><span>수학</span><div className="preview-track"><i style={{ width: "40%" }} /></div><span>4 / 10</span></div>
          <div className="preview-subject"><span>과학</span><div className="preview-track"><i style={{ width: "50%" }} /></div><span>3 / 6</span></div>
          <div className="preview-bottom"><span>수업의 기록이 쌓이는 공간</span><span>↗</span></div>
        </div>
      </div>
      <p className="intro-footer">작은 기록으로 연결되는 우리 학교의 배움</p>
    </section>
    <section className="login-panel" aria-labelledby="login-title">
      <div className="login-card"><span className="eyebrow">TEACHER WORKSPACE</span><h2 id="login-title">반갑습니다, 선생님.</h2><p className="login-description">학교에서 발급받은 계정으로 로그인해 주세요.</p>
        <LoginForm />
        <div className="account-guide"><span aria-hidden="true">ⓘ</span><p>아직 계정이 없으신가요?<br /><strong>학교 관리자에게 계정 발급을 요청해 주세요.</strong></p></div>
      </div>
      <p className="login-footer">학급 진도 대시보드 · 함께 배우는 학교</p>
    </section>
  </main>;
}
