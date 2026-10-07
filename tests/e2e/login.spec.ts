import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => { await request.post("http://127.0.0.1:54329/__test/reset"); });
async function login(page: import("@playwright/test").Page, username = "kim.teacher", password = "teacher-password-2026") {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}

test("ID login persists across refresh, logout rejects replayed cookies", async ({ page, context }) => {
  await login(page, "  KIM.Teacher  ");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "김선생님, 반갑습니다." })).toBeVisible();
  const oldCookies = await context.cookies();
  expect(oldCookies.filter(c => c.name.startsWith("sb-")).every(c => c.httpOnly)).toBe(true);
  await page.reload(); await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await context.addCookies(oldCookies);
  await page.goto("/dashboard"); await expect(page).toHaveURL(/\/login$/);
});

test("wrong credentials and inactive accounts have the same generic error", async ({ page }) => {
  for (const [id, pass] of [["kim.teacher", "wrong-password"], ["missing.teacher", "wrong-password"], ["inactive.teacher", "teacher-password-2026"]]) {
    await login(page, id, pass);
    await expect(page.locator("#login-error")).toHaveText("아이디 또는 비밀번호를 확인해 주세요.");
    await expect(page).toHaveURL(/\/login$/);
  }
});

test("protected routes reject unauthenticated visitors and external POST origins", async ({ page, request }) => {
  await page.goto("/dashboard"); await expect(page).toHaveURL(/\/login$/);
  await page.goto("/password"); await expect(page).toHaveURL(/\/login$/);
  const response = await request.post("/api/auth/login", { headers: { Origin: "https://attacker.example" }, data: { username: "kim.teacher", password: "teacher-password-2026" } });
  expect(response.status()).toBe(403);
});

test("temporary password forces change before workspace access", async ({ page }) => {
  await login(page, "new.teacher", "temporary-password-2026");
  await expect(page).toHaveURL(/\/password$/);
  await page.goto("/dashboard"); await expect(page).toHaveURL(/\/password$/);
  await page.getByLabel("현재 비밀번호", { exact: true }).fill("wrong-current-password");
  await page.getByLabel("새 비밀번호", { exact: true }).fill("changed-password-2026");
  await page.getByLabel("새 비밀번호 확인", { exact: true }).fill("changed-password-2026");
  await page.getByRole("button", { name: "변경하고 시작하기" }).click();
  await expect(page.getByText("현재 비밀번호를 확인해 주세요.", { exact: true })).toBeVisible();
  await page.getByLabel("현재 비밀번호", { exact: true }).fill("temporary-password-2026");
  await page.getByLabel("새 비밀번호", { exact: true }).fill("changed-password-2026");
  await page.getByLabel("새 비밀번호 확인", { exact: true }).fill("changed-password-2026");
  await page.getByRole("button", { name: "변경하고 시작하기" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, "new.teacher", "changed-password-2026");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("password visibility, recovery help, and small-screen layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/login");
  await page.screenshot({ path: "test-results/login-mobile.png", fullPage: true, caret: "initial" });
  await page.getByRole("button", { name: "비밀번호 보기", exact: true }).click();
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "비밀번호를 잊으셨나요?" }).click();
  await expect(page.getByText("학교 관리자에게 초기화를 요청해 주세요.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 }); await page.goto("/login");
  await page.screenshot({ path: "test-results/login-desktop.png", fullPage: true, caret: "initial" });
});

test("repeated failures are limited without disclosing whether the ID exists", async ({ request }) => {
  for (let i = 0; i < 10; i++) {
    const response = await request.post("/api/auth/login", { headers: { Origin: "http://127.0.0.1:3100" }, data: { username: "missing.teacher", password: "wrong-password" } });
    expect(response.status()).toBe(401);
  }
  const response = await request.post("/api/auth/login", { headers: { Origin: "http://127.0.0.1:3100" }, data: { username: "missing.teacher", password: "wrong-password" } });
  expect(response.status()).toBe(429);
});
