import { requireAccount } from "@/lib/auth/account";
import { Brand } from "@/components/brand";
import { PasswordForm } from "@/components/password-form";
import { LogoutButton } from "@/components/account-actions";

export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  const { profile } = await requireAccount(true);
  return <main className="account-page"><header className="app-header"><Brand /><LogoutButton /></header>
    <section className="password-card"><span className="eyebrow">MY ACCOUNT</span><h1>비밀번호 변경</h1><p className="login-description">{profile.password_change_required ? "임시 비밀번호를 새 비밀번호로 변경해 주세요." : "계정을 보호할 새 비밀번호를 입력해 주세요."}</p><PasswordForm required={profile.password_change_required} /></section>
  </main>;
}
