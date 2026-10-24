"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Profile } from "@/lib/auth/account";
import type { TeacherSnapshot } from "@/lib/workspace/types";
import { WorkspaceGuide, WorkspaceShell } from "./workspace-shell";
import { ComparisonProgress } from "./comparison-progress";
import { ComparisonSubjectHeading } from "./comparison-subject-heading";

const navigation = [{ id: "class", label: "우리 반 진도", mark: "▤" }, { id: "comparison", label: "학년 진도 비교", mark: "▦" }, { id: "students", label: "우리 반 명단", mark: "☷" }, { id: "guide", label: "사용 설명서", mark: "?" }];
export function TeacherDashboard({ profile, initialData }: { profile: Profile; initialData: TeacherSnapshot | null }) {
  const [view, setView] = useState("class");
  return <WorkspaceShell profile={profile} role="선생님" school={initialData?.choices[0]?.school_name || ""} navigation={navigation} view={view} onNavigate={setView}>{view === "guide" ? <WorkspaceGuide /> : <ClassroomWorkspace initialData={initialData} view={view} profileName={profile.display_name} />}</WorkspaceShell>;
}
export function ClassroomWorkspace({ initialData = null, view = "class", schoolAdmin = false, profileName = "" }: { initialData?: TeacherSnapshot | null; view?: string; schoolAdmin?: boolean; profileName?: string }) {
  const [data, setData] = useState(initialData);
  const [classId, setClassId] = useState(initialData?.snapshot?.context.own_classroom_id || "");
  const [inspected, setInspected] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ unitId: string; completed: boolean } | null>(null);
  const locked = useRef(false), serial = useRef(0), selected = useRef(classId);
  const refresh = useCallback(async (id = "") => {
    const token = ++serial.current;
    try {
      const response = await fetch(`/api/teacher${id ? `?classroom=${id}` : ""}`, { cache: "no-store" });
      if (token !== serial.current) return false;
      if (response.status === 401 || response.status === 403) { setData(null); window.location.assign(response.status === 401 ? "/login" : "/dashboard"); return false; }
      if (!response.ok) throw new Error();
      const next = await response.json() as TeacherSnapshot;
      if (token !== serial.current) return false;
      setData(next); const cid = next.snapshot?.context.own_classroom_id || ""; setClassId(cid); selected.current = cid; setError(""); return true;
    } catch { if (token === serial.current) setError("최신 정보를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요."); return false; }
  }, []);
  useEffect(() => {
    if (!initialData) void refresh();
    const update = () => { if (!locked.current && document.visibilityState === "visible") void refresh(selected.current); };
    const timer = window.setInterval(update, 30_000); window.addEventListener("focus", update);
    return () => { serial.current++; clearInterval(timer); window.removeEventListener("focus", update); };
  }, [initialData, refresh]);
  const snapshot = data?.snapshot, context = snapshot?.context;
  const own = snapshot?.classrooms.find(c => c.id === classId);
  const classroom = (view === "comparison" ? snapshot?.classrooms.find(c => c.id === inspected) : null) || own;
  const editable = context?.status === "active" && classroom?.id === classId;
  const subjects = (snapshot?.subjects || []).filter(s => !subjectId || s.id === subjectId);
  const roster = (snapshot?.students || []).filter(s => s.classroom_id === classId && (s.name.includes(query.trim()) || String(s.student_number) === query.trim()));
  const maxPage = Math.max(1, Math.ceil(roster.length / 15)), currentPage = Math.min(page, maxPage);
  async function save(unitId: string, completed: boolean) {
    if (locked.current || !editable || !classroom) return;
    locked.current = true; serial.current++; setBusy(true); setPending({ unitId, completed }); setError(""); setMessage("저장 중…");
    try {
      const response = await fetch("/api/teacher", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ classroom_id: classroom.id, unit_id: unitId, completed, version: classroom.progress_versions[unitId] || 0 }) });
      const result = await response.json();
      if (response.status === 401 || response.status === 403) { setData(null); window.location.assign(response.status === 401 ? "/login" : "/dashboard"); return; }
      if (!response.ok) { setMessage(""); await refresh(classId); setError(result.error || "저장하지 못했습니다. 새로고침 후 다시 시도해 주세요."); return; }
      const refreshed = await refresh(classId);
      setMessage(refreshed ? "저장 완료 · 서버에 반영했습니다." : "저장은 완료되었습니다. 새로고침으로 최신 진도를 확인해 주세요.");
    } catch { setMessage(""); setError("연결이 끊겼습니다. 체크 상태는 마지막 조회 값입니다. 새로고침으로 저장 여부를 확인해 주세요."); }
    finally { locked.current = false; setPending(null); setBusy(false); }
  }
  return <>
    <div className="admin-page-heading"><div><span className="eyebrow">CLASSROOM WORKSPACE</span><h1>{snapshot ? view === "comparison" ? "같은 학년, 함께 걷는 배움" : view === "students" ? `${own?.name} 학생 명단` : `${own?.name}의 오늘 수업` : `${profileName}님, 반갑습니다.`}</h1><p>{schoolAdmin ? "선택한 학급의 진도와 자료를 확인하세요." : "완료한 단원을 기록하고, 우리 학년의 수업 흐름을 살펴보세요."}</p></div><button className="admin-secondary" disabled={busy} onClick={() => void refresh(classId)}>새로고침</button></div>
    {error && <div className="admin-error" role="alert">{error}<button onClick={() => void refresh(classId)} disabled={busy}>다시 확인</button></div>}
    {message && <div className="admin-success" role="status">{message}</div>}
    {data && !snapshot ? <section className="admin-panel admin-empty"><h2>담당 학급 배정을 기다리고 있어요.</h2><p>학교 관리자에게 학급 배정을 요청해 주세요.</p><button className="admin-secondary" onClick={() => void refresh()}>배정 다시 확인</button><a className="admin-text-action" href="/password">비밀번호 변경</a></section> : snapshot && <>
      <div className="grade-context-bar"><label>학급 <select aria-label="담당 학급과 학기" value={classId} disabled={busy} onChange={event => { const id = event.target.value; selected.current = id; setClassId(id); setData(null); setInspected(""); setSubjectId(""); setMessage(""); setPage(1); void refresh(id); }}>{data!.choices.map(c => <option value={c.id} key={c.id}>{c.academic_year}학년도 {c.semester}학기 · {c.name}</option>)}</select></label><span className={`admin-status ${context?.status === "active" ? "active" : "paused"}`}>{context?.status === "active" ? "진행 중" : context?.status === "draft" ? "준비 중 · 읽기 전용" : "보관된 학기 · 읽기 전용"}</span><span className="grade-updated">30초마다 갱신</span></div>
      {view === "comparison" ? <section className="admin-panel"><div className="admin-panel-heading"><div><h2>학급별 진도 비교</h2><p>다른 반은 진도만 조회할 수 있습니다.</p></div><SubjectFilter subjects={snapshot.subjects} value={subjectId} onChange={setSubjectId} /></div><div className="grade-comparison-scroll"><table className="grade-comparison"><caption className="sr-only">같은 학년 학급별 진도</caption><thead><tr><th>학급</th>{subjects.map(s => <th scope="col" className="grade-subject-cell" key={s.id}><ComparisonSubjectHeading subject={s} classrooms={snapshot.classrooms} /></th>)}</tr></thead><tbody>{snapshot.classrooms.map(c => <tr key={c.id}><th><strong>{c.name}</strong>{c.id === classId && <span className="grade-own-badge">내 반</span>}<small>{c.teacher_name || "담당 미배정"}</small></th>{subjects.map(s => { const rate = c.subjects.find(r => r.subject_id === s.id); return <td key={s.id}><button className="grade-rate-button" aria-label={`${c.name} ${s.name} 진도 보기`} onClick={() => { setInspected(c.id); setSubjectId(s.id); }}><ComparisonProgress value={rate} /></button></td>; })}</tr>)}</tbody></table></div><div className="grade-table-note">과목별 평균은 같은 학년 학급들의 진도율을 평균내어 반올림합니다. 등록된 단원이 없는 학급은 평균 계산에서 제외합니다.</div></section> : null}
      {view === "students" ? <section className="admin-panel"><div className="admin-panel-heading"><div><h2>우리 반 재적 학생<span>{roster.length}명</span></h2><p>학생 정보 수정은 학년 관리자에게 요청해 주세요.</p></div><span className="admin-status paused">조회 전용</span></div><div className="grade-class-filters"><label className="grade-student-search">검색<input aria-label="학생 이름 또는 번호 검색" type="search" placeholder="학생 이름 또는 반 내 번호" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label></div><div className="admin-table-scroll"><table className="grade-roster"><thead><tr><th>반 내 번호</th><th>이름</th><th>상태</th></tr></thead><tbody>{roster.slice((currentPage - 1) * 15, currentPage * 15).map(s => <tr key={s.id}><td>{s.student_number}</td><td>{s.name}</td><td>재적</td></tr>)}</tbody></table></div>{!roster.length && <p className="grade-no-unit-notice">조건에 맞는 학생이 없습니다.</p>}<div className="admin-table-footer"><span>{roster.length}명</span><div><button disabled={currentPage === 1} aria-label="이전 학생 페이지" onClick={() => setPage(currentPage - 1)}>‹</button>{currentPage}/{maxPage}<button disabled={currentPage === maxPage} aria-label="다음 학생 페이지" onClick={() => setPage(currentPage + 1)}>›</button></div></div></section> : (view !== "comparison" || inspected) && <section className="admin-panel workspace-progress"><div className="admin-panel-heading"><div><h2>{classroom?.name} 단원별 진도<span>{editable ? "진도 체크" : "조회 전용"}</span></h2><p>{editable ? "단원을 체크하면 서버에 저장됩니다. 완료 체크를 해제할 수도 있습니다." : "이 학급의 기록은 읽기 전용입니다."}</p></div>{view === "comparison" ? <button className="admin-secondary" disabled={busy} onClick={() => { setInspected(""); setSubjectId(""); }}>진도 상세 닫기</button> : <SubjectFilter subjects={snapshot.subjects} value={subjectId} onChange={setSubjectId} />}</div><div className="grade-subject-list">{classroom && subjects.map(s => { const rate = classroom.subjects.find(r => r.subject_id === s.id); return <details className="grade-subject" key={s.id} open><summary><strong>{s.name}</strong><span>{rate?.total ? `${rate.completed}/${rate.total} · ${rate.percentage?.toFixed(1)}%` : "단원 미등록"}</span></summary>{s.units.length ? <ul className="grade-unit-status">{s.units.map(u => { const done = classroom.completed_unit_ids.includes(u.id); return <li key={u.id}><label className="workspace-unit-label"><input type="checkbox" aria-label={`${s.name} ${u.title}`} checked={pending?.unitId === u.id ? pending.completed : done} disabled={busy || !editable} onChange={e => void save(u.id, e.target.checked)} /><span>{u.title}</span></label><small>{done ? "완료" : "미완료"}</small></li>; })}</ul> : <p className="grade-no-unit-notice">등록된 단원이 없습니다.</p>}</details>; })}{!subjects.length && <p className="grade-no-unit-notice">등록된 공통 과목이 없습니다. 관리자에게 요청해 주세요.</p>}</div></section>}
    </>}
    {!data && !error && <div className="admin-empty" role="status">학급 정보를 불러오는 중입니다…</div>}
  </>;
}
function SubjectFilter({ subjects, value, onChange }: { subjects: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) { return <label className="grade-subject-filter"><span className="sr-only">과목 선택</span><select aria-label="과목 선택" value={value} onChange={e => onChange(e.target.value)}><option value="">전체 과목</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>; }
