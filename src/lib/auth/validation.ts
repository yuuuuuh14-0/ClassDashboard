export const LOGIN_ERROR = "아이디 또는 비밀번호를 확인해 주세요.";
export const SERVICE_ERROR = "현재 로그인 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.";

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9._-]{4,30}$/.test(username) ? username : null;
}

export function validLoginPassword(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).length <= 72;
}

export function passwordError(password: unknown, confirmation: unknown, current: unknown): string | null {
  if (typeof password !== "string" || [...password].length < 12) return "새 비밀번호는 12자 이상 입력해 주세요.";
  if (new TextEncoder().encode(password).length > 72) return "새 비밀번호가 너무 깁니다. 영문 기준 72자 이내로 입력해 주세요.";
  if (password !== confirmation) return "새 비밀번호와 확인 값이 일치하지 않습니다.";
  if (password === current) return "현재 비밀번호와 다른 비밀번호를 입력해 주세요.";
  return null;
}

export function isSameOrigin(request: Request, configuredOrigin?: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(configuredOrigin || request.url).origin;
  } catch {
    return false;
  }
}
