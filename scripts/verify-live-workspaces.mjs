import { existsSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { request } from "@playwright/test";
import { gradeFixture, seedGradeFixture } from "./grade-fixture.mjs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url=process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, secret=process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const options={auth:{persistSession:false,autoRefreshToken:false}}, admin=createClient(url,secret,options), users=[], schoolIds=[], contexts=[], clients=[];
const appUrl=process.env.AUTH_TEST_APP_URL || "http://localhost:3000", origin=process.env.APP_ORIGIN || new URL(appUrl).origin;
const namespace=`verify-workspace-${randomBytes(6).toString("hex")}`, password=()=>`Verify-Aa1!${randomBytes(16).toString("hex")}`;
const check=(ok,message)=>{if(!ok)throw new Error(message);}, pass=message=>console.log(`PASS: ${message}`);
async function makeUser() {
  const username=`verify.${randomBytes(7).toString("hex")}`, email=`${randomUUID()}@auth.classdashboard.invalid`, pw=password();
  const created=await admin.auth.admin.createUser({email,password:pw,email_confirm:true}); check(!created.error && created.data.user,"Create temporary user");
  const user={id:created.data.user.id,username,email,password:pw}; users.push(user);
  check(!(await admin.rpc("register_login_account",{target_user:user.id,login_name:username,account_name:"Workspace test",internal_email:email,site_admin:false})).error,"Register temporary user");
  check(!(await admin.rpc("mark_password_changed",{target_user:user.id})).error,"Prepare temporary user"); return user;
}
async function api(user) {
  const context=await request.newContext({baseURL:appUrl,extraHTTPHeaders:{Origin:origin},timeout:45_000}); contexts.push(context);
  check((await context.post("/api/auth/login",{data:{username:user.username,password:user.password}})).status()===200,"Temporary API login"); return context;
}
async function direct(user) {
  const c=createClient(url,key,options); clients.push(c); check(!(await c.auth.signInWithPassword({email:user.email,password:user.password})).error,"Direct temporary login"); return c;
}
let failure;
try {
  const manager=await makeUser(), schoolManager=await makeUser(), teacher=await makeUser();
  const fixture=gradeFixture(namespace,`${namespace} school`,manager.id,schoolManager.id); schoolIds.push(fixture.schoolId); await seedGradeFixture(admin,fixture);
  check(!(await admin.from("school_memberships").insert({school_id:fixture.schoolId,user_id:teacher.id,role:"teacher"})).error,"Teacher membership");
  check(!(await admin.from("teacher_assignments").insert({school_id:fixture.schoolId,period_id:fixture.periodId,grade_id:fixture.gradeId,classroom_id:fixture.classrooms[1].id,user_id:teacher.id})).error,"Teacher classroom assignment");
  const other=gradeFixture(`${namespace}-foreign`,`${namespace} foreign`,manager.id,schoolManager.id);
  for(const table of ["school_memberships","teacher_assignments","grade_manager_assignments"]) other.tables[table]=[];
  schoolIds.push(other.schoolId); await seedGradeFixture(admin,other);
  const schoolApi=await api(schoolManager), teacherApi=await api(teacher), client=await direct(teacher), schoolClient=await direct(schoolManager);
  let school;
  async function getSchool(period="") { const response=await schoolApi.get(`/api/school-admin${period?`?period=${period}`:""}`); check(response.status()===200,`School snapshot (${response.status()})`); school=await response.json(); return school; }
  async function mutate(payload,expected=200) { await getSchool(payload.period_id || ""); const response=await schoolApi.post("/api/school-admin",{data:{version:school.school.version,payload}}); check(response.status()===expected,`School operation ${payload.action} (${response.status()})`); return response; }
  await getSchool();
  check(school.members.length===3 && school.students.length===19,"Own school counts include all grades");
  check((await teacherApi.get("/api/school-admin")).status()===403,"Ordinary teacher denied school dashboard");
  check((await schoolApi.get(`/api/school-admin?period=${other.periodId}`)).status()===403,"Other school period API denied");
  check(!!(await schoolClient.rpc("school_workspace_snapshot",{target_period:other.periodId})).error,"Other school direct RPC denied");
  const diagnosis=await client.rpc("teacher_workspace_snapshot",{target_classroom:null});
  check(!diagnosis.error,`Teacher RPC: ${diagnosis.error?.code} ${diagnosis.error?.message}`);
  const teacherResponse=await teacherApi.get("/api/teacher"); check(teacherResponse.status()===200,`Teacher snapshot (${teacherResponse.status()})`);
  const shape=await teacherResponse.json(), snap=shape.snapshot;
  check(snap.context.own_classroom_id===fixture.classrooms[1].id && snap.students.length===6 && snap.students.every(s=>s.classroom_id===fixture.classrooms[1].id),"Teacher sees only own roster");
  check(snap.classrooms.length===3 && snap.classrooms.filter(c=>c.id!==fixture.classrooms[1].id).every(c=>c.student_count===null),"Peer progress excludes peer roster/counts");
  check((await teacherApi.get(`/api/teacher?classroom=${fixture.classrooms[0].id}`)).status()===403,"Other classroom context denied");
  check((await teacherApi.get(`/api/teacher?classroom=${other.classrooms[0].id}`)).status()===403,"Other school context denied");
  const privateRoster=await client.from("student_enrollments").select("id"); check(!privateRoster.error && privateRoster.data.length===0,"No direct grade-wide student RLS for teacher");
  const own=snap.classrooms.find(c=>c.id===fixture.classrooms[1].id), unit=fixture.units[0].id;
  const body={classroom_id:own.id,unit_id:unit,completed:false,version:own.progress_versions[unit] || 0};
  check((await teacherApi.post("/api/teacher",{data:body})).status()===200,"Save own progress");
  check((await teacherApi.post("/api/teacher",{data:body})).status()===409,"Stale progress version rejected");
  check((await teacherApi.post("/api/teacher",{data:{...body,classroom_id:fixture.classrooms[0].id}})).status()===403,"Peer progress write denied");
  const persisted=await admin.from("class_progress").select("completed,version").eq("classroom_id",own.id).eq("unit_id",unit).single();
  check(!persisted.error && !persisted.data.completed && persisted.data.version===body.version+1,"Progress persists with incremented version");
  check(!!(await client.from("class_progress").update({completed:true}).eq("classroom_id",own.id)).error,"Direct progress writes denied");
  pass("School scope, teacher roster isolation, own progress persistence and stale-version rejection verified");
  const common={period_id:fixture.periodId,grade_id:fixture.gradeId};
  const invalid=await schoolClient.rpc("school_workspace_mutate",{payload:{action:"class_save",...common,classroom_id:other.classrooms[0].id,name:"Invalid",number:9,active:true},expected_version:school.school.version});
  check(invalid.error?.code==="42501","Cross-school classroom mutation denied in DB");
  await mutate({action:"student_save",...common,classroom_id:own.id,id:null,number:7,name:"Workspace new student",active:true});
  await mutate({action:"subject_save",...common,id:null,name:"Workspace subject",order:10,active:true});
  await getSchool(); const subject=school.subjects.find(s=>s.name==="Workspace subject"); check(subject,"Subject created");
  await mutate({action:"unit_save",...common,subject_id:subject.id,id:null,name:"Workspace unit",order:0,active:true});
  await getSchool(); const added=school.units.find(u=>u.subject_id===subject.id); check(added,"Unit created");
  const next=await(await teacherApi.get("/api/teacher")).json(); check(next.snapshot.subjects.some(s=>s.id===subject.id && s.units.length===1),"Common curriculum reflected in teacher workspace");
  const blankProgress={classroom_id:own.id,unit_id:added.id,completed:true,version:0};
  check((await teacherApi.post("/api/teacher",{data:blankProgress})).status()===200,"First progress insert");
  await mutate({action:"unit_save",...common,subject_id:subject.id,id:added.id,name:"Renamed unit",order:1,active:false});
  check((await teacherApi.post("/api/teacher",{data:{...blankProgress,version:1}})).status()===400,"Inactive unit cannot accept progress");
  await mutate({action:"unit_save",...common,subject_id:subject.id,id:added.id,name:"Restored unit",order:0,active:true});
  const restored=await(await teacherApi.get("/api/teacher")).json(); check(restored.snapshot.classrooms.find(c=>c.id===own.id).completed_unit_ids.includes(added.id),"Restoring unit preserves prior completion");
  pass("School roster and shared curriculum edits persist; deactivate/restore preserves progress");
  const newUsername=`verify.${randomBytes(7).toString("hex")}`;
  await mutate({action:"teacher_create",username:newUsername,name:"Issued teacher"}); await getSchool();
  const issued=school.members.find(m=>m.username===newUsername); check(issued && issued.password_change_required,"Issued teacher requires initial change");
  users.push({id:issued.user_id,username:newUsername});
  const issuedApi=await request.newContext({baseURL:appUrl,extraHTTPHeaders:{Origin:origin},timeout:45_000}); contexts.push(issuedApi);
  check((await issuedApi.post("/api/auth/login",{data:{username:newUsername,password:"000000"}})).status()===200,"Issued initial password stored in Auth");
  check((await issuedApi.get("/api/teacher")).status()===403,"Issued teacher blocked before initial change");
  await mutate({action:"member_reset",user_id:teacher.id});
  check((await teacherApi.get("/api/teacher")).status()===401,"Reset revokes existing session");
  const resetApi=await request.newContext({baseURL:appUrl,extraHTTPHeaders:{Origin:origin},timeout:45_000}); contexts.push(resetApi);
  const login=await resetApi.post("/api/auth/login",{data:{username:teacher.username,password:"000000"}}); check(login.status()===200 && (await login.json()).redirect==="/password","Reset initial password persisted");
  const newPassword=password(); check((await resetApi.post("/api/auth/password",{data:{currentPassword:"000000",password:newPassword,confirmation:newPassword}})).status()===200,"Reset teacher changes password"); teacher.password=newPassword;
  check((await teacherApi.get("/api/teacher")).status()===401,"Old cookie remains revoked after password change");
  check((await resetApi.get("/api/teacher")).status()===200,"New session has teacher scope after password change");
  pass("School-issued initial password, mandatory change, reset and permanent old-session revocation verified");
  await mutate({action:"period_create",year:2027,semester:1}); await getSchool(); const draft=school.periods.find(p=>p.academic_year===2027);
  check(draft && draft.status==="draft","New term begins draft");
  await mutate({action:"period_activate",period_id:draft.id},400);
  await mutate({action:"grade_create",period_id:draft.id,number:3}); await getSchool(draft.id); const gid=school.grades[0].id;
  await mutate({action:"class_save",period_id:draft.id,grade_id:gid,classroom_id:null,name:"New class 3-1",number:1,active:true}); await getSchool(draft.id); const cid=school.classrooms[0].id;
  await mutate({action:"assignment",period_id:draft.id,grade_id:gid,classroom_id:cid,user_id:teacher.id,manager:true});
  await mutate({action:"period_activate",period_id:draft.id}); await getSchool(draft.id);
  check(school.periods.find(p=>p.id===fixture.periodId).status==="archived" && school.periods.find(p=>p.id===draft.id).status==="active","Term transition atomically archives prior term");
  const history=await(await resetApi.get(`/api/teacher?classroom=${own.id}`)).json(); check(history.snapshot.context.status==="archived" && history.snapshot.students.length===7,"Teacher retains actual archived assignment and own roster");
  check((await resetApi.post("/api/teacher",{data:{...body,version:body.version+1}})).status()===409,"Archived teacher progress write denied");
  await mutate({action:"student_save",...common,classroom_id:own.id,id:null,number:8,name:"Blocked archive edit",active:true},409);
  const oldRows=await admin.from("student_enrollments").select("id").eq("classroom_id",own.id); check(oldRows.data.length===7,"Archived original roster retained");
  const newRows=await admin.from("class_progress").select("unit_id").eq("classroom_id",cid); check(newRows.data.length===0,"New term never inherits old progress");
  pass("Draft readiness validation, term transition, archived history and write protection verified");
  check(!(await admin.from("school_memberships").update({is_active:false}).eq("school_id",fixture.schoolId).eq("user_id",teacher.id)).error,"Revoke test membership");
  const revoked=await(await resetApi.get("/api/teacher")).json(); check(revoked.choices.length===0 && revoked.snapshot===null,"Membership revocation removes current and archived access");
  pass("Membership changes immediately revoke current and historical classroom access");
} catch(error) { failure=error instanceof Error?error.message.split(/\r?\n/)[0]:"Workspace verification failed"; }
finally {
  for(const c of clients) try {await c.auth.signOut({scope:"local"});}catch{}
  for(const c of contexts) try {await c.dispose();}catch{}
  if(schoolIds.length) { const result=await admin.from("schools").delete().in("id",schoolIds); if(result.error) failure||="Temporary school cleanup failed"; }
  for(const u of users) { await admin.rpc("reset_login_attempts",{login_name:u.username}); if((await admin.auth.admin.deleteUser(u.id)).error) failure||="Temporary user cleanup failed"; }
  if(schoolIds.length) {const remaining=await admin.from("schools").select("id").in("id",schoolIds); if(remaining.error || remaining.data.length) failure||="Temporary school cleanup verification failed";}
  if(users.length) {const remaining=await admin.from("profiles").select("user_id").in("user_id",users.map(u=>u.id)); if(remaining.error || remaining.data.length) failure||="Temporary profile cleanup verification failed";}
}
if(failure) {console.error(`FAIL: ${failure}`);process.exitCode=1;} else console.log("All school/teacher live checks passed; temporary accounts and schools removed.");
