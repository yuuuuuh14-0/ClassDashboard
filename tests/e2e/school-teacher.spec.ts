import { expect, test, type Page } from "@playwright/test";
test.beforeEach(async ({ request }) => { await request.post("http://127.0.0.1:54329/__test/reset"); });
async function signIn(page: Page, username: string, password: string) {
  await page.goto("/login"); await page.getByLabel("아이디", { exact: true }).fill(username); await page.getByLabel("비밀번호", { exact: true }).fill(password); await page.getByRole("button", { name: "로그인", exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
}
const origin = { Origin: "http://127.0.0.1:3100" };
test("ordinary teacher saves only own progress, retains it after reload, and sees only own roster", async ({ page }) => {
  await signIn(page,"test.teacher","Teacher-password-2026!");
  await expect(page.getByRole("heading", { name:"3학년 2반의 오늘 수업",exact:true })).toBeVisible();
  const checkbox=page.getByRole("checkbox").first(); await expect(checkbox).toBeChecked(); await checkbox.uncheck();
  await expect(page.getByRole("status")).toContainText("저장 완료"); await expect(checkbox).not.toBeChecked();
  await page.reload(); await expect(page.getByRole("checkbox").first()).not.toBeChecked();
  await page.screenshot({ path:"test-results/teacher-desktop.png",fullPage:true });
  const info=await (await page.request.get("/api/teacher")).json();
  expect(info.snapshot.students).toHaveLength(6);
  expect(info.snapshot.students.every((s:{classroom_id:string})=>s.classroom_id===info.snapshot.context.own_classroom_id)).toBe(true);
  const other=info.snapshot.classrooms.find((c:{id:string})=>c.id!==info.snapshot.context.own_classroom_id), unit=info.snapshot.subjects[0].units[0].id;
  expect((await page.request.post("/api/teacher",{headers:origin,data:{classroom_id:other.id,unit_id:unit,completed:true,version:1}})).status()).toBe(403);
  expect((await page.request.get("/api/school-admin")).status()).toBe(403);
  await page.getByRole("button", { name:"학년 진도 비교",exact:true }).click();
  await page.getByRole("button",{name:"3학년 1반 국어 진도 보기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"3학년 1반 단원별 진도 조회 전용",exact:true})).toBeVisible();
  await expect(page.getByRole("checkbox").first()).toBeDisabled();
  await page.getByRole("button",{name:"우리 반 명단",exact:true}).click();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(7);
  await expect(page.getByRole("table")).toContainText("테스트 학생 2-01");
  await expect(page.getByRole("table")).not.toContainText("테스트 학생 1-01");
  await page.setViewportSize({width:390,height:844}); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:"test-results/teacher-mobile.png",fullPage:true});
});

test("progress failure retains last saved state and conflict requires refreshed version", async ({page})=>{
  await signIn(page,"test.teacher","Teacher-password-2026!");
  const checkbox=page.getByRole("checkbox").first(); await expect(checkbox).toBeChecked();
  await page.route("**/api/teacher",route=>route.request().method()==="POST"?route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"저장 실패 테스트"})}):route.continue());
  await checkbox.uncheck(); await expect(page.locator(".admin-error")).toContainText("저장 실패 테스트"); await expect(checkbox).toBeChecked();
  await page.unroute("**/api/teacher");
  const info=await(await page.request.get("/api/teacher")).json(), c=info.snapshot.classrooms.find((c:{id:string})=>c.id===info.snapshot.context.own_classroom_id), unit=info.snapshot.subjects[0].units[0].id;
  const body={classroom_id:c.id,unit_id:unit,completed:false,version:c.progress_versions[unit]};
  expect((await page.request.post("/api/teacher",{headers:origin,data:body})).status()).toBe(200);
  expect((await page.request.post("/api/teacher",{headers:origin,data:body})).status()).toBe(409);
});

test("school administrator manages teachers, classes, roster, curriculum and prepares a term",async({page})=>{
  await signIn(page,"school.admin","School-password-2026!");
  await expect(page.getByRole("heading",{name:"우리 학교의 배움이 시작되는 곳",exact:true})).toBeVisible();
  await page.screenshot({path:"test-results/school-admin-desktop.png",fullPage:true});
  await page.getByRole("button",{name:"선생님 관리",exact:true}).click(); await page.getByRole("button",{name:"선생님 추가",exact:true}).click();
  let dialog=page.getByRole("dialog"); await dialog.getByLabel("아이디 (영문 소문자·숫자·._-, 4~30자)").fill("new.colleague"); await dialog.getByLabel("이름",{exact:true}).fill("새 동료 선생님"); await dialog.getByRole("button",{name:"저장",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("교사 계정을 만들었습니다");
  await expect(page.getByRole("row").filter({hasText:"new.colleague"})).toContainText("최초 비밀번호 변경 필요");
  await page.getByRole("button",{name:"학년·담당 배정",exact:true}).click(); await page.getByRole("button",{name:"학급 추가",exact:true}).click();
  dialog=page.getByRole("dialog"); await dialog.getByLabel("학급 이름",{exact:true}).fill("3학년 4반"); await dialog.getByLabel("반 번호",{exact:true}).fill("4"); await dialog.getByRole("button",{name:"저장",exact:true}).click();
  await page.getByRole("row").filter({hasText:"3학년 4반"}).getByRole("button",{name:"담당 배정",exact:true}).click();
  dialog=page.getByRole("dialog"); await dialog.getByRole("combobox",{name:"담임 선생님",exact:true}).selectOption({label:"새 동료 선생님 (new.colleague)"}); await dialog.getByRole("button",{name:"저장",exact:true}).click(); await expect(page.getByRole("row").filter({hasText:"3학년 4반"})).toContainText("새 동료 선생님");
  await page.getByRole("button",{name:"학생 명단 관리",exact:true}).click(); await page.getByRole("button",{name:"학생 추가",exact:true}).click();
  dialog=page.getByRole("dialog"); await dialog.getByLabel("이름",{exact:true}).fill("새 예시 학생"); await dialog.getByLabel("반 내 번호",{exact:true}).fill("7"); await dialog.getByRole("button",{name:"저장",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("저장 완료"); await page.getByLabel("학생 검색",{exact:true}).fill("새 예시 학생"); await expect(page.getByRole("table")).toContainText("새 예시 학생");
  await page.getByRole("button",{name:"과목·단원 관리",exact:true}).click(); await page.getByRole("button",{name:"과목 추가",exact:true}).click();
  dialog=page.getByRole("dialog"); await dialog.getByLabel("과목 이름",{exact:true}).fill("창의 활동"); await dialog.getByRole("button",{name:"저장",exact:true}).click(); await expect(page.getByRole("status")).toContainText("저장 완료");
  const subject=page.locator("details").filter({has:page.locator("summary",{hasText:"창의 활동"})}); await subject.getByRole("button",{name:"단원 추가",exact:true}).click();
  dialog=page.getByRole("dialog"); await dialog.getByLabel("단원 제목",{exact:true}).fill("우리 마을 알아보기"); await dialog.getByRole("button",{name:"저장",exact:true}).click(); await expect(subject).toContainText("우리 마을 알아보기");
  await page.getByRole("button",{name:"학기 관리",exact:true}).click(); await page.getByRole("button",{name:"새 학기 만들기",exact:true}).click();
  dialog=page.getByRole("dialog"); await dialog.getByLabel("학년도",{exact:true}).fill("2027"); await dialog.getByRole("button",{name:"저장",exact:true}).click(); await expect(page.getByRole("table")).toContainText("2027학년도 1학기");
  await page.getByRole("row").filter({hasText:"2027학년도 1학기"}).getByRole("button",{name:"학기 시작",exact:true}).click(); await page.getByRole("dialog").getByRole("button",{name:"확인 후 학기 시작",exact:true}).click(); await expect(page.getByRole("dialog").getByRole("alert")).toContainText("모든 반의 담임과 학년 관리자"); await page.getByRole("dialog").getByRole("button",{name:"취소",exact:true}).click();
  await page.setViewportSize({width:390,height:844}); await page.getByRole("button",{name:"학교 현황",exact:true}).click(); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true); await page.screenshot({path:"test-results/school-admin-mobile.png",fullPage:true});
});
