"use client";
import { useState } from "react";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const result = await response.json();
      if (response.ok) window.location.assign("/login");
      else setError(result.error || "로그아웃하지 못했습니다. 다시 시도해 주세요.");
    } catch { setError("연결을 확인하고 다시 시도해 주세요."); }
    finally { setPending(false); }
  }
  return <div className="logout-action"><button className="secondary-button" onClick={logout} disabled={pending}>{pending ? "로그아웃 중…" : "로그아웃"}</button>{error && <p role="alert" className="form-error">{error}</p>}</div>;
}
