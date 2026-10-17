import { randomUUID } from "node:crypto";
export function workspaceMock(accounts, fixture) {
  const tables = structuredClone(fixture.tables), sid = fixture.schoolId;
  let version = 1;
  const teacher = accounts.find(a => a.username === "test.teacher");
  tables.school_memberships.push({ school_id: sid, user_id: teacher.id, role: "teacher", is_active: true });
  tables.teacher_assignments.push({ id: randomUUID(), school_id: sid, period_id: fixture.periodId, grade_id: fixture.gradeId, classroom_id: fixture.classrooms[1].id, user_id: teacher.id, is_active: true });
  const find = (table, id) => tables[table].find(r => r.id === id);
  const membership = a => tables.school_memberships.find(m => m.user_id === a?.id && m.is_active);
  const schoolManager = a => membership(a)?.role === "school_admin";
  const assigned = (a,c) => tables.teacher_assignments.some(t => t.user_id === a?.id && t.classroom_id === c?.id && t.is_active) && membership(a);
  function gradeSnapshot(c, manager) {
    const grade = find("grades", c.grade_id), p = find("academic_periods", c.period_id);
    const subjects = tables.subjects.filter(s => s.grade_id === c.grade_id && s.is_active).map(s => ({ id: s.id, name: s.name, units: tables.units.filter(u => u.subject_id === s.id && u.is_active).map(u => ({ id: u.id, title: u.title })) }));
    return { context: { id: grade.id, school_name: tables.schools[0].name, grade_number: grade.grade_number, academic_year: p.academic_year, semester: p.semester, status: p.status, own_classroom_id: c.id }, subjects,
      classrooms: tables.classrooms.filter(row => row.grade_id === c.grade_id && row.is_active).map(row => { const progress = tables.class_progress.filter(cp => cp.classroom_id === row.id), assignment = tables.teacher_assignments.find(t => t.classroom_id === row.id && t.is_active); return { id: row.id, name: row.name, class_number: row.class_number, teacher_name: accounts.find(a => a.id === assignment?.user_id)?.display_name || null, student_count: manager || row.id === c.id ? tables.student_enrollments.filter(e => e.classroom_id === row.id && e.is_active).length : null,
        subjects: subjects.map(s => { const completed = s.units.filter(u => progress.some(cp => cp.unit_id === u.id && cp.completed)).length; return { subject_id: s.id, completed, total: s.units.length, percentage: s.units.length ? Math.round(completed * 1000 / s.units.length) / 10 : null }; }), completed_unit_ids: progress.filter(cp => cp.completed).map(cp => cp.unit_id), progress_versions: Object.fromEntries(progress.map(cp => [cp.unit_id,cp.version])) }; }),
      students: tables.student_enrollments.filter(e => e.grade_id === c.grade_id && e.is_active && (manager || e.classroom_id === c.id)), updated_at: new Date().toISOString() };
  }
  return { tables, membership, handle(fn, p, a) {
    if (!["school_workspace_snapshot","school_workspace_mutate","teacher_workspace_snapshot","save_class_progress","school_register_teacher"].includes(fn)) return null;
    const deny = [403, { code: "42501" }], conflict = [409,{ code:"PT409" }];
    if (fn === "school_register_teacher") {
      if (p.actor !== accounts.find(a => a.username === "school.admin").id || p.target_school !== sid) return deny;
      if (p.expected_version !== version) return conflict;
      const account = accounts.find(a => a.id === p.target_user); if (!account) return deny;
      if (accounts.some(a => a.id !== account.id && a.username === p.login_name)) return [409,{ code:"23505" }];
      Object.assign(account, { username:p.login_name,display_name:p.account_name,is_active:true,password_change_required:true,is_site_admin:false });
      tables.school_memberships.push({ school_id:sid,user_id:account.id,role:"teacher",is_active:true }); version++; return [200,null];
    }
    if (!a?.is_active || a.password_change_required) return deny;
    if (fn === "teacher_workspace_snapshot") {
      const choices = tables.classrooms.filter(c => c.is_active && (schoolManager(a) || assigned(a,c))).map(c => ({ ...find("academic_periods",c.period_id), id:c.id,name:c.name,school_name:tables.schools[0].name })).sort((a,b) => (b.status === "active") - (a.status === "active"));
      const c = find("classrooms",p.target_classroom || choices[0]?.id);
      if (!c) return [200,{ choices, snapshot:null }];
      if (!schoolManager(a) && !assigned(a,c)) return deny;
      return [200,{ choices,snapshot:gradeSnapshot(c,schoolManager(a)) }];
    }
    if (fn === "save_class_progress") {
      const c = find("classrooms",p.target_classroom), unit = find("units",p.target_unit);
      if (!c || (!schoolManager(a) && !assigned(a,c))) return deny;
      if (find("academic_periods",c.period_id).status !== "active") return conflict;
      if (!unit || unit.grade_id !== c.grade_id || !unit.is_active) return [400,{ code:"22023" }];
      let cp = tables.class_progress.find(cp => cp.classroom_id === c.id && cp.unit_id === unit.id);
      if ((cp?.version || 0) !== p.expected_version) return conflict;
      if (!cp) { cp = { classroom_id:c.id,unit_id:unit.id,version:0 }; tables.class_progress.push(cp); }
      cp.completed = p.done; cp.version++; return [200,null];
    }
    if (!schoolManager(a)) return deny;
    if (fn === "school_workspace_snapshot") {
      const period = p.target_period ? find("academic_periods",p.target_period) : tables.academic_periods.find(p => p.status === "active") || tables.academic_periods[0];
      if (p.target_period && !period) return deny;
      const pid = period?.id;
      return [200,{ school:{ id:sid,name:tables.schools[0].name,version },period_id:pid,periods:tables.academic_periods,
        members:tables.school_memberships.map(m => { const a = accounts.find(a => a.id === m.user_id); return { ...a,user_id:a.id,role:m.role }; }),
        grades:tables.grades.filter(g => g.period_id === pid),classrooms:tables.classrooms.filter(c => c.period_id === pid),assignments:tables.teacher_assignments.filter(t => t.period_id === pid && t.is_active),managers:tables.grade_manager_assignments.filter(g => g.period_id === pid && g.is_active),subjects:tables.subjects.filter(s => s.period_id === pid),units:tables.units.filter(u => u.period_id === pid),students:tables.student_enrollments.filter(e => e.period_id === pid),updated_at:new Date().toISOString() }];
    }
    if (p.expected_version !== version) return conflict;
    const v = p.payload, period = find("academic_periods",v.period_id);
    if (v.period_id && !period) return deny;
    if (period?.status === "archived") return conflict;
    const scope = { school_id:sid,period_id:v.period_id,grade_id:v.grade_id }, id = v.id || randomUUID();
    if (v.action === "period_create") tables.academic_periods.push({ id,school_id:sid,academic_year:v.year,semester:v.semester,status:"draft" });
    else if (v.action === "grade_create") tables.grades.push({ id,school_id:sid,period_id:v.period_id,grade_number:v.number });
    else if (v.action === "class_save") {
      const c = find("classrooms",v.classroom_id); if (c) Object.assign(c,{name:v.name,class_number:v.number,is_active:v.active}); else tables.classrooms.push({...scope,id,name:v.name,class_number:v.number,is_active:v.active});
    } else if (v.action === "assignment") {
      const old = tables.teacher_assignments.find(t => t.classroom_id === v.classroom_id && t.is_active);
      if (tables.teacher_assignments.some(t => t.user_id === v.user_id && t.period_id === v.period_id && t.classroom_id !== v.classroom_id && t.is_active)) return [409,{code:"23505"}];
      if (old) { old.is_active=false; tables.grade_manager_assignments.filter(g => g.teacher_assignment_id === old.id).forEach(g => g.is_active=false); }
      if (v.user_id) { const assignment = {...scope,id:randomUUID(),classroom_id:v.classroom_id,user_id:v.user_id,is_active:true}; tables.teacher_assignments.push(assignment); if (v.manager) { tables.grade_manager_assignments.filter(g => g.grade_id === v.grade_id).forEach(g => g.is_active=false); tables.grade_manager_assignments.push({...scope,id:randomUUID(),user_id:v.user_id,teacher_assignment_id:assignment.id,is_active:true}); } }
    } else if (v.action === "student_save") {
      const row = find("student_enrollments",v.id), values={...scope,classroom_id:v.classroom_id,student_number:v.number,name:v.name,is_active:v.active};
      if (row) Object.assign(row,values); else tables.student_enrollments.push({id,...values});
    } else if (["subject_save","unit_save"].includes(v.action)) {
      const table = v.action === "subject_save" ? "subjects" : "units", row=find(table,v.id), values={...scope,sort_order:v.order,is_active:v.active,...(table === "units" ? {subject_id:v.subject_id,title:v.name} : {name:v.name})};
      if (row) Object.assign(row,values); else tables[table].push({id,...values});
    } else if (v.action === "period_activate") {
      const cs=tables.classrooms.filter(c => c.period_id === period.id && c.is_active);
      if (!cs.length || cs.some(c => !tables.teacher_assignments.some(a => a.classroom_id === c.id && a.is_active) || !tables.grade_manager_assignments.some(g => g.grade_id === c.grade_id && g.is_active))) return [400,{code:"23514"}];
      tables.academic_periods.filter(p => p.status === "active").forEach(p => p.status="archived"); period.status="active";
    } else if (["member_update","member_reset"].includes(v.action)) {
      const m=tables.school_memberships.find(m => m.user_id === v.user_id && m.role === "teacher"), account=accounts.find(a => a.id === v.user_id); if (!m || !account) return deny;
      if (v.action === "member_reset") account.password_change_required=true; else { account.display_name=v.name; account.is_active=v.active; }
    } else return [400,{code:"22023"}];
    version++; return [200,id];
  } };
}
