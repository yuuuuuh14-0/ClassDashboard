"use client";
import { useState, type FormEvent } from "react";
import { passwordError } from "@/lib/auth/validation";

export function PasswordForm({ required }: { required: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const input = { currentPassword: form.get("currentPassword"), password: form.get("password"), confirmation: form.get("confirmation") };
    const validation = passwordError(input.password, input.confirmation, input.currentPassword);
    if (validation) { setError(validation); return; }
    setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json();
      if (response.ok) window.location.assign("/dashboard");
      else if (response.status === 401) window.location.assign("/login");
      else setError(result.error || "변경하지 못했습니다. 다시 시도해 주세요.");
    } catch { setError("연결을 확인하고 다시 시도해 주세요."); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="auth-form" aria-busy={pending}>
    <div className="field"><label htmlFor="currentPassword">현재 비밀번호</label><input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required disabled={pending} /></div>
    <div className="field"><label htmlFor="newPassword">새 비밀번호</label><input id="newPassword" name="password" type="password" autoComplete="new-password" required minLength={6} disabled={pending} aria-describedby="password-rule" /><p className="field-hint" id="password-rule">6자 이상 입력해 주세요. 한글·특수문자는 최대 길이가 다를 수 있습니다.</p></div>
    <div className="field"><label htmlFor="confirmation">새 비밀번호 확인</label><input id="confirmation" name="confirmation" type="password" autoComplete="new-password" required disabled={pending} /></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" disabled={pending}>{pending ? "변경 중…" : required ? "변경하고 시작하기" : "변경 저장"}<span aria-hidden="true">→</span></button>
    {!required && <a className="text-button centered" href="/dashboard">취소</a>}
  </form>;
}
