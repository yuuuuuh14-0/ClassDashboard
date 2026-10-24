import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ request }) => { await request.post("http://127.0.0.1:54329/__test/reset"); });
async function signIn(page: Page, username = "grade.admin", password = "Grade-password-2026!") {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("grade dashboard displays real-shaped grade scope, comparison, subject details, and roster filters", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await expect(page.getByRole("heading", { name: "3학년의 배움, 함께 살펴보세요." })).toBeVisible();
  const table = page.getByRole("table", { name: "3학년 학급별 과목 진도 비교" });
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table.getByRole("columnheader", { name: "국어(평균: 50%)", exact: true })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "과학(평균: 92%)", exact: true })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "영어(평균: —)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "3학년 1반 국어 진도 보기", exact: true })).toContainText("33%");
  await expect(page.getByRole("button", { name: "3학년 1반 영어 진도 보기", exact: true })).toContainText("단원 미등록");
  await page.screenshot({ path: "test-results/grade-admin-desktop.png", fullPage: true });
  await page.getByLabel("비교할 과목", { exact: true }).selectOption({ label: "국어" });
  await expect(table.getByRole("columnheader")).toHaveCount(2);
  await page.getByRole("button", { name: "3학년 2반 국어 진도 보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "3학년 2반 조회 전용", exact: true })).toBeVisible();
  await expect(page.locator(".grade-unit-status")).toContainText("작품을 만나요");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "비교표로 돌아가기", exact: true }).click();
  await expect(page.getByLabel("비교할 과목", { exact: true })).toHaveValue(await page.getByLabel("비교할 과목").locator("option").filter({ hasText: /^국어$/ }).getAttribute("value") as string);
  await page.getByRole("button", { name: "학생 명단", exact: true }).click();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(13);
  await page.getByRole("button", { name: "다음 학생 페이지", exact: true }).click();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(7);
  await page.getByLabel("학생 명단 학급", { exact: true }).selectOption({ label: "3학년 2반" });
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(7);
  await page.getByLabel("학생 이름 또는 번호 검색", { exact: true }).fill("테스트 학생 2-03");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("table")).not.toContainText("다른 학년 테스트 학생");
  await page.getByRole("button", { name: "공통 교육과정", exact: true }).click();
  await expect(page.getByRole("heading", { name: "학년 공통 과목·단원", exact: true })).toBeVisible();
  await expect(page.getByText("등록된 단원이 없습니다.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "학년 현황", exact: true }).click();
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "3학년의 배움, 함께 살펴보세요." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator(".grade-comparison-scroll").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/grade-admin-mobile.png", fullPage: true });
});

test("grade API denies unauthenticated, school-admin, teacher, and wrong-grade access; login footer shows contact", async ({ page, request }) => {
  const gradeId = "00000000-0000-4000-8000-000000000099";
  expect((await request.get(`/api/grade-admin?grade=${gradeId}`)).status()).toBe(401);
  await page.goto("/login");
  await expect(page.getByText("사이트 관리자 (사용 문의, 학교 추가, 학교 관리자 비밀번호 재설정)", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "yuuuuuh14@gmail.com", exact: true })).toHaveAttribute("href", "mailto:yuuuuuh14@gmail.com");
  await signIn(page);
  expect((await page.request.get(`/api/grade-admin?grade=${gradeId}`)).status()).toBe(403);
  expect((await page.request.get("/api/grade-admin?grade=wrong")).status()).toBe(400);
  expect((await page.request.get("/api/site-admin")).status()).toBe(403);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, "school.admin", "School-password-2026!");
  await expect(page.getByRole("heading", { name: "우리 학교의 배움이 시작되는 곳", exact: true })).toBeVisible();
  expect((await page.request.get(`/api/grade-admin?grade=${gradeId}`)).status()).toBe(403);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, "kim.teacher", "teacher-password-2026");
  await expect(page.getByRole("heading", { name: "김선생님, 반갑습니다.", exact: true })).toBeVisible();
  expect((await page.request.get(`/api/grade-admin?grade=${gradeId}`)).status()).toBe(403);
});
