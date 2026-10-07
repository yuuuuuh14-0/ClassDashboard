"use client";

import { useState, type FormEvent } from "react";
import { LOGIN_ERROR, normalizeUsername, SERVICE_ERROR, validLoginPassword } from "@/lib/auth/validation";

export function LoginForm() {
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [help, setHelp] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const username = normalizeUsername(form.get("username"));
    const password = form.get("password");
    if (!username || !validLoginPassword(password)) { setError(LOGIN_ERROR); return; }
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error || SERVICE_ERROR); return; }
      // Destinations are fixed by the server, never supplied by a URL parameter.
      window.location.assign(result.redirect === "/password" ? "/password" : "/dashboard");
    } catch { setError(SERVICE_ERROR); }
    finally { setPending(false); }
  }

  return <>
    <form onSubmit={submit} className="auth-form" aria-busy={pending}>
      <div className="field"><label htmlFor="username">아이디</label>
        <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="아이디를 입력해 주세요" required maxLength={30} disabled={pending} aria-describedby={error ? "login-error" : undefined} />
      </div>
      <div className="field"><label htmlFor="password">비밀번호</label>
        <div className="password-input"><input id="password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" placeholder="비밀번호를 입력해 주세요" required disabled={pending} aria-describedby={error ? "login-error" : undefined} />
          <button type="button" className="visibility-button" onClick={() => setVisible(!visible)} aria-label={visible ? "비밀번호 숨기기" : "비밀번호 보기"} aria-pressed={visible}>{visible ? "숨김" : "보기"}</button>
        </div>
      </div>
      {error && <p className="form-error" id="login-error" role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={pending}>{pending ? "로그인 중…" : "로그인"}<span aria-hidden="true">→</span></button>
    </form>
    <button className="text-button recovery-button" onClick={() => setHelp(!help)} aria-expanded={help} aria-controls="recovery-help">비밀번호를 잊으셨나요?</button>
    {help && <div className="notice" id="recovery-help"><strong>학교 관리자에게 초기화를 요청해 주세요.</strong><p>발급받은 임시 비밀번호로 로그인하면 새 비밀번호로 변경할 수 있습니다. 학교 관리자는 사이트 관리자에게 요청해 주세요.</p></div>}
  </>;
}
