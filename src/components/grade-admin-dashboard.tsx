"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Profile } from "@/lib/auth/account";
import type { GradeContext, GradeSnapshot, GradeClassroom, GradeSubject, ClassSubject } from "@/lib/grade-admin/types";
import { Brand } from "./brand";
import { LogoutButton } from "./account-actions";

type View = "overview" | "classroom" | "students" | "curriculum";
const navigation: { id: View; label: string; mark: string }[] = [
  { id: "overview", label: "학년 현황", mark: "▦" }, { id: "classroom", label: "학급 진도 조회", mark: "▤" },
  { id: "students", label: "학생 명단", mark: "☷" }, { id: "curriculum", label: "공통 교육과정", mark: "▥" },
];
function Rate({ value }: { value: ClassSubject | undefined }) {
  if (!value || !value.total) return <span className="grade-no-units">—<small>단원 미등록</small></span>;
  return <span className="grade-rate"><strong>{value.percentage?.toFixed(1)}%</strong><small>{value.completed}/{value.total} 단원</small><span className="grade-track"><i style={{ width: `${value.percentage ?? 0}%` }} /></span></span>;
}
const stamp = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));

export function GradeAdminDashboard({ profile, contexts, initialData }: { profile: Profile; contexts: GradeContext[]; initialData: GradeSnapshot | null }) {
  const [data, setData] = useState(initialData);
  const [gradeId, setGradeId] = useState(contexts[0].id);
  const [view, setView] = useState<View>("overview");
  const [classId, setClassId] = useState(initialData?.context.own_classroom_id || initialData?.classrooms[0]?.id || "");
  const [subjectId, setSubjectId] = useState("");
  const [studentClassId, setStudentClassId] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialData ? "" : "학년 정보를 불러오지 못했습니다. 다시 시도해 주세요.");
  const serial = useRef(0);
  const refresh = useCallback(async (id: string) => {
    const token = ++serial.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/grade-admin?grade=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (token !== serial.current) return;
      if (response.status === 401 || response.status === 403) { setData(null); window.location.assign(response.status === 401 ? "/login" : "/dashboard"); return; }
      if (!response.ok) throw new Error();
      const next = await response.json() as GradeSnapshot;
      if (token !== serial.current) return;
      setData(next);
      setClassId(current => next.classrooms.some(item => item.id === current) ? current : next.context.own_classroom_id || next.classrooms[0]?.id || "");
    } catch { if (token === serial.current) setError("최신 정보를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요."); }
    finally { if (token === serial.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(gradeId); };
    const timer = window.setInterval(onFocus, 30_000);
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [gradeId, refresh]);
  useEffect(() => () => { serial.current++; }, []);
  const context = data?.context || contexts.find(item => item.id === gradeId)!;
  const subjects = data?.subjects ?? [];
  const classrooms = data?.classrooms ?? [];
  const selectedClass = classrooms.find(item => item.id === classId);
  const filteredSubjects = subjects.filter(subject => !subjectId || subject.id === subjectId);
  const students = (data?.students ?? []).filter(student => (!studentClassId || student.classroom_id === studentClassId) && (student.name.includes(query.trim()) || String(student.student_number) === query.trim()));
  const maxPage = Math.max(1, Math.ceil(students.length / 12));
  const currentPage = Math.min(page, maxPage);
  const missingTeachers = classrooms.filter(item => !item.teacher_name).length;
  function navigate(next: View) { setView(next); setQuery(""); setPage(1); if (next === "classroom") { setClassId(data?.context.own_classroom_id || classrooms[0]?.id || ""); setSubjectId(""); } }
  function showClass(classroom: GradeClassroom, subject?: GradeSubject) { setClassId(classroom.id); setSubjectId(subject?.id || ""); setView("classroom"); }

  return <div className="admin-app grade-app">
    <a className="admin-skip" href="#grade-main">본문으로 건너뛰기</a>
    <aside className="admin-sidebar"><Brand />
      <div className="admin-workspace"><span className="grade-workspace-number">{context.grade_number}</span><div><strong>{context.grade_number}학년 연구실</strong><small>학년 관리자</small></div><span className="admin-workspace-dot" /></div>
      <span className="admin-nav-label">GRADE WORKSPACE</span><nav aria-label="학년 관리자 메뉴">{navigation.map(item => <button key={item.id} className={`admin-nav-item ${view === item.id ? "is-active" : ""}`} aria-current={view === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><span className="grade-nav-mark" aria-hidden="true">{item.mark}</span>{item.label}</button>)}</nav>
      <div className="admin-sidebar-note"><span className="admin-leaf" aria-hidden="true">✳</span><strong>함께 맞추는 배움의 속도</strong><p>우리 학년의 수업 흐름을<br />한눈에 살펴보세요.</p></div>
      <div className="admin-profile"><span className="admin-avatar">{profile.display_name.slice(0, 1)}</span><div><strong>{profile.display_name}</strong><small>{context.grade_number}학년 관리자</small></div><a href="/password" aria-label="내 비밀번호 변경">⚙</a></div>
    </aside>
    <div className="admin-workspace-main"><header className="admin-topbar"><div><span>{context.school_name}</span><span className="admin-breadcrumb">/</span><strong>{context.grade_number}학년</strong></div><div className="admin-topbar-actions"><a className="admin-role-badge" href="/password">비밀번호 변경</a><LogoutButton /></div></header>
      <main id="grade-main" className="admin-main">
        <div className="admin-page-heading"><div><span className="eyebrow">GRADE WORKSPACE</span><h1>{view === "overview" ? `${context.grade_number}학년의 배움, 함께 살펴보세요.` : navigation.find(item => item.id === view)?.label}</h1><p>{profile.display_name}님, {context.school_name} {context.grade_number}학년의 수업 현황입니다.</p></div><button className="admin-secondary" onClick={() => void refresh(gradeId)} disabled={loading}>{loading ? "불러오는 중…" : "새로고침"}</button></div>
        <div className="grade-context-bar"><span className="grade-context-label">배정 범위</span><label><span className="sr-only">조회할 학년과 학기</span><select value={gradeId} onChange={event => { const id = event.target.value; setGradeId(id); setData(null); setSubjectId(""); setStudentClassId(""); setQuery(""); setPage(1); void refresh(id); }}>{contexts.map(item => <option key={item.id} value={item.id}>{item.academic_year}학년도 {item.semester}학기 · {item.grade_number}학년</option>)}</select></label><span className={`admin-status ${context.status === "active" ? "active" : "paused"}`}>{context.status === "active" ? "진행 중" : "준비 중"}</span><span className="grade-updated">{data ? `${stamp(data.updated_at)} 기준 · 30초마다 갱신` : "조회 대기 중"}</span></div>
        {error && <div className="admin-error" role="alert">{error}{data && " 마지막으로 불러온 정보입니다."}<button onClick={() => void refresh(gradeId)} disabled={loading}>다시 시도</button></div>}
        {view === "overview" && <>
          <div className="admin-stats grade-stats">{[{ name: "우리 학년 학급", value: classrooms.length, unit: "개 반", detail: "사용 중인 학급" }, { name: "재적 학생", value: data?.students.length ?? 0, unit: "명", detail: "학년 전체 재적 명단" }, { name: "공통 과목", value: subjects.length, unit: "과목", detail: "같은 학년이 함께 사용하는 과목" }, { name: "공통 단원", value: subjects.reduce((sum, subject) => sum + subject.units.length, 0), unit: "개", detail: "현재 사용 중인 단원" }].map(stat => <div className="admin-stat" key={stat.name}><div className="admin-stat-top">{stat.name}</div><div className="admin-stat-value">{data ? stat.value : "—"}<small>{data && stat.unit}</small></div><p>{stat.detail}</p></div>)}</div>
          <div className="grade-intro"><span className="grade-intro-symbol" aria-hidden="true">▦</span><div><strong>우리 학년의 수업 흐름을 함께 확인하세요.</strong><p>비교표의 과목을 선택하면 해당 반의 단원별 완료 현황을 볼 수 있습니다. 순위와 학년 평균은 표시하지 않습니다.</p></div></div>
          <section className="admin-panel" aria-labelledby="grade-comparison-title"><div className="admin-panel-heading"><div><h2 id="grade-comparison-title">학급별 진도 비교</h2><p>완료 단원 수 / 전체 단원 수와 진도율을 함께 표시합니다.</p></div><label className="grade-subject-filter"><span className="sr-only">비교할 과목</span><select aria-label="비교할 과목" value={subjectId} onChange={event => setSubjectId(event.target.value)}><option value="">전체 과목</option>{subjects.map(subject => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select></label></div>
            {classrooms.length ? <div className="grade-comparison-scroll"><table className="grade-comparison"><caption className="sr-only">{context.grade_number}학년 학급별 과목 진도 비교</caption><thead><tr><th scope="col">학급</th>{filteredSubjects.map(subject => <th scope="col" key={subject.id}>{subject.name}</th>)}</tr></thead><tbody>{classrooms.map(classroom => <tr key={classroom.id}><th scope="row"><strong>{classroom.name}</strong>{classroom.id === data?.context.own_classroom_id && <span className="grade-own-badge">내 반</span>}<small>{classroom.teacher_name || "담당 미배정"}</small></th>{filteredSubjects.map(subject => <td key={subject.id}><button className="grade-rate-button" aria-label={`${classroom.name} ${subject.name} 진도 보기`} onClick={() => showClass(classroom, subject)}><Rate value={classroom.subjects.find(item => item.subject_id === subject.id)} /></button></td>)}</tr>)}</tbody></table></div> : <div className="admin-empty"><h3>{data ? "등록된 학급이 없습니다" : "학년 정보를 불러와 주세요"}</h3><p>학교 관리자에게 학급 구성을 요청해 주세요.</p></div>}
            <div className="grade-table-note">진도율은 사용 중인 단원 기준으로 계산합니다. 단원 0개인 과목은 단원 미등록으로 표시합니다.</div>
          </section>
          <div className="grade-bottom-grid"><section className="admin-guide"><span className="eyebrow">OUR GRADE</span><h2>학년 운영 확인</h2><ul className="grade-check-list"><li><span>담당 교사 배정</span><strong>{data ? missingTeachers ? `${missingTeachers}개 반 미배정` : "모든 반 배정 완료" : "조회 대기"}</strong></li><li><span>단원 미등록 과목</span><strong>{data ? `${subjects.filter(subject => !subject.units.length).length}과목` : "—"}</strong></li><li><span>학기 상태</span><strong>{context.status === "active" ? "진행 중" : "준비 중"}</strong></li></ul></section><section className="admin-panel grade-quick-links"><h2>학년 자료 바로 보기</h2><button onClick={() => navigate("students")}><span><strong>학생 명단</strong><small>학년 전체 명단과 반별 학생 조회</small></span><span aria-hidden="true">→</span></button><button onClick={() => navigate("curriculum")}><span><strong>공통 교육과정</strong><small>우리 학년 과목과 단원 목록</small></span><span aria-hidden="true">→</span></button></section></div>
        </>}
        {view === "classroom" && <section className="admin-panel"><div className="admin-panel-heading"><div><h2>{selectedClass?.name || "학급 진도"}<span>조회 전용</span></h2><p>단원 완료 상태를 확인할 수 있습니다.</p></div><button className="admin-text-action" onClick={() => setView("overview")}>비교표로 돌아가기</button></div><div className="grade-class-filters"><label>학급<select aria-label="조회할 학급" value={classId} onChange={event => setClassId(event.target.value)}>{classrooms.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>과목<select aria-label="조회할 과목" value={subjectId} onChange={event => setSubjectId(event.target.value)}><option value="">전체 과목</option>{subjects.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div><div className="grade-subject-list">{selectedClass && filteredSubjects.map(subject => <SubjectDetails key={subject.id} subject={subject} classroom={selectedClass} />)}{!selectedClass && <div className="admin-empty"><h3>조회할 학급이 없습니다.</h3></div>}</div></section>}
        {view === "curriculum" && <section className="admin-panel"><div className="admin-panel-heading"><div><h2>학년 공통 과목·단원</h2><p>{context.grade_number}학년 전체 {classrooms.length}개 반이 같은 교육과정을 사용합니다.</p></div><span className="admin-status paused">조회 전용</span></div><div className="grade-subject-list">{subjects.map(subject => <details className="grade-subject" key={subject.id} open><summary><strong>{subject.name}</strong><span>{subject.units.length}개 단원</span></summary>{subject.units.length ? <ol>{subject.units.map(unit => <li key={unit.id}>{unit.title}</li>)}</ol> : <p className="grade-no-unit-notice">등록된 단원이 없습니다.</p>}</details>)}{data && !subjects.length && <div className="admin-empty"><h3>등록된 공통 과목이 없습니다.</h3></div>}</div></section>}
        {view === "students" && <section className="admin-panel"><div className="admin-panel-heading"><div><h2>학년 학생 명단<span>{data ? data.students.length : "—"}명</span></h2><p>배정된 {context.grade_number}학년의 재적 학생만 표시합니다.</p></div><span className="admin-status paused">조회 전용</span></div><div className="grade-class-filters"><label>학급<select aria-label="학생 명단 학급" value={studentClassId} onChange={event => { setStudentClassId(event.target.value); setPage(1); }}><option value="">전체 학급</option>{classrooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="grade-student-search"><span className="sr-only">학생 이름 또는 번호 검색</span><input type="search" aria-label="학생 이름 또는 번호 검색" placeholder="학생 이름 또는 반 내 번호" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label></div><div className="admin-table-scroll"><table className="grade-roster"><thead><tr><th scope="col">학급</th><th scope="col">반 내 번호</th><th scope="col">이름</th><th scope="col">상태</th></tr></thead><tbody>{students.slice((currentPage - 1) * 12, currentPage * 12).map(student => <tr key={student.id}><td>{classrooms.find(item => item.id === student.classroom_id)?.name}</td><td>{student.student_number}</td><td>{student.name}</td><td><span className="admin-status active">재적</span></td></tr>)}</tbody></table></div>{!students.length && <div className="admin-empty"><h3>{data ? "조건에 맞는 학생이 없습니다." : "학년 정보를 불러와 주세요."}</h3></div>}<div className="admin-table-footer"><span>{students.length}명</span><div><button aria-label="이전 학생 페이지" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>‹</button>{currentPage} / {maxPage}<button aria-label="다음 학생 페이지" disabled={currentPage >= maxPage} onClick={() => setPage(currentPage + 1)}>›</button></div></div></section>}
        <footer className="admin-footer"><span>학급 진도 대시보드 · 학년 관리자</span><span>배정된 학년의 자료만 조회할 수 있습니다.</span></footer>
      </main>
    </div>
  </div>;
}

function SubjectDetails({ subject, classroom }: { subject: GradeSubject; classroom: GradeClassroom }) {
  const value = classroom.subjects.find(item => item.subject_id === subject.id);
  return <details className="grade-subject" open><summary><strong>{subject.name}</strong><span>{value?.total ? `${value.completed}/${value.total} · ${value.percentage?.toFixed(1)}%` : "— · 단원 미등록"}</span></summary>{subject.units.length ? <ul className="grade-unit-status">{subject.units.map(unit => { const done = classroom.completed_unit_ids.includes(unit.id); return <li key={unit.id}><span className={`grade-unit-check ${done ? "done" : ""}`} aria-hidden="true">{done ? "✓" : ""}</span><span>{unit.title}</span><small>{done ? "완료" : "미완료"}</small></li>; })}</ul> : <p className="grade-no-unit-notice">등록된 단원이 없습니다.</p>}</details>;
}
