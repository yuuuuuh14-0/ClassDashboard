import { createHash } from "node:crypto";

export function gradeFixture(namespace, schoolName, gradeManagerId, schoolManagerId) {
  const id = name => { const h = createHash("sha256").update(`${namespace}/${name}`).digest("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
  const schoolId = id("school"), periodId = id("period"), gradeId = id("grade-3"), otherGradeId = id("grade-4");
  const scope = { school_id: schoolId, period_id: periodId, grade_id: gradeId };
  const classrooms = [1,2,3].map(number => ({ ...scope, id: id(`class-${number}`), class_number: number, name: `3학년 ${number}반`, is_active: true }));
  const definitions = [
    ["국어", ["작품을 만나요", "중심 생각을 찾아요", "경험을 나눠요", "말의 재미를 느껴요", "바르게 대화해요", "글을 읽고 소개해요"]],
    ["수학", ["곱셈", "나눗셈", "원의 성질", "분수", "들이와 무게"]],
    ["사회", ["우리 고장의 모습", "고장의 옛이야기", "교통과 통신", "고장의 변화"]],
    ["과학", ["동물의 생활", "지표의 변화", "물질의 상태", "소리의 성질"]],
    ["영어", []], ["도덕", ["나를 돌아봐요", "함께하는 교실", "서로 존중해요"]],
  ];
  const subjects = definitions.map(([name], index) => ({ ...scope, id: id(`subject-${index}`), name, sort_order: index, is_active: true }));
  const units = definitions.flatMap(([, titles], subjectIndex) => titles.map((title, index) => ({ ...scope, id: id(`unit-${subjectIndex}-${index}`), subject_id: subjects[subjectIndex].id, title, sort_order: index, is_active: true })));
  const students = classrooms.flatMap((classroom, classIndex) => Array.from({ length: 6 }, (_, index) => ({ ...scope, id: id(`student-${classIndex}-${index}`), classroom_id: classroom.id, student_number: index + 1, name: `테스트 학생 ${classIndex + 1}-${String(index + 1).padStart(2,"0")}`, is_active: true })));
  const progress = classrooms.flatMap((classroom, classIndex) => units.filter(unit => unit.sort_order < 2 + classIndex + subjects.findIndex(s => s.id === unit.subject_id) % 2).map(unit => ({ ...scope, classroom_id: classroom.id, unit_id: unit.id, completed: true, version: 1 })));
  const otherScope = { school_id: schoolId, period_id: periodId, grade_id: otherGradeId };
  const otherClass = { ...otherScope, id: id("class-4"), class_number: 1, name: "4학년 1반", is_active: true };
  const tables = {
    schools: [{ id: schoolId, name: schoolName, is_active: true }],
    school_memberships: [{ school_id: schoolId, user_id: gradeManagerId, role: "teacher", is_active: true }, { school_id: schoolId, user_id: schoolManagerId, role: "school_admin", is_active: true }],
    academic_periods: [{ id: periodId, school_id: schoolId, academic_year: 2026, semester: 2, status: "active" }],
    grades: [{ id: gradeId, school_id: schoolId, period_id: periodId, grade_number: 3 }, { id: otherGradeId, school_id: schoolId, period_id: periodId, grade_number: 4 }],
    classrooms: [...classrooms, otherClass],
    teacher_assignments: [{ ...scope, id: id("assignment"), classroom_id: classrooms[0].id, user_id: gradeManagerId, is_active: true }],
    grade_manager_assignments: [{ ...scope, id: id("manager"), user_id: gradeManagerId, teacher_assignment_id: id("assignment"), is_active: true }],
    subjects,
    units,
    student_enrollments: [...students, { ...otherScope, id: id("student-other-grade"), classroom_id: otherClass.id, student_number: 1, name: "다른 학년 테스트 학생", is_active: true }],
    class_progress: progress,
  };
  return { schoolId, periodId, gradeId, otherGradeId, classrooms, subjects, units, students, progress, tables };
}

export async function seedGradeFixture(admin, fixture) {
  for (const [table, rows] of Object.entries(fixture.tables)) {
    if (!rows.length) continue;
    const conflict = table === "school_memberships" ? "school_id,user_id" : table === "class_progress" ? "classroom_id,unit_id" : "id";
    const result = await admin.from(table).upsert(rows, { onConflict: conflict, ignoreDuplicates: true });
    if (result.error) throw new Error(`Test fixture failed in ${table} (${result.error.code})`);
  }
}
