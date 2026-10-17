"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Profile } from "@/lib/auth/account";
import type { AdminMutation, School, SiteAdminSnapshot } from "@/lib/site-admin/types";
import { Brand } from "./brand";
import { LogoutButton } from "./account-actions";

type View = "overview" | "schools" | "managers" | "guide";
type Modal = { kind: "create" } | { kind: "edit" | "status" | "managers"; school: School };
type IconName = "grid" | "school" | "people" | "book" | "plus" | "arrow" | "search" | "refresh" | "check" | "edit";
const paths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  school: <><path d="M3 21V8l9-5 9 5v13M1 21h22M9 21v-6h6v6M7 10h2m6 0h2M7 13h2m6 0h2" /></>,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5" /></>,
  book: <><path d="M12 5v16M12 5C8 2 4 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-2-1-6-2-10 1Z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  edit: <><path d="m15 5 4 4M4 20l5-1L21 7a2.8 2.8 0 0 0-4-4L5 15l-1 5ZM13 20h8" /></>,
};
function Icon({ name }: { name: IconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
const navigation: { id: View; label: string; icon: IconName }[] = [
  { id: "overview", label: "운영 개요", icon: "grid" }, { id: "schools", label: "학교 관리", icon: "school" },
  { id: "managers", label: "학교 관리자", icon: "people" }, { id: "guide", label: "운영 안내", icon: "book" },
];
const actionLabels: Record<string, string> = { created: "학교 등록", renamed: "학교 이름 변경", paused: "학교 사용 중지", restored: "학교 사용 복구", admin_assigned: "학교 관리자 지정", admin_removed: "학교 관리자 해제" };
const date = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const time = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));

function Dialog({ title, children, pending, close }: { title: string; children: ReactNode; pending: boolean; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="admin-dialog" aria-labelledby="admin-dialog-title" onCancel={event => { event.preventDefault(); if (!pending) close(); }}>
    <div className="admin-dialog-head"><h2 id="admin-dialog-title">{title}</h2><button className="admin-icon-button" aria-label="창 닫기" disabled={pending} onClick={close}>×</button></div>
    {children}
  </dialog>;
}

export function SiteAdminDashboard({ profile, initialData }: { profile: Profile; initialData: SiteAdminSnapshot | null }) {
  const [data, setData] = useState(initialData);
  const [view, setView] = useState<View>("overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<Modal | null>(null);
  const [schoolName, setSchoolName] = useState("");
  const [userId, setUserId] = useState("");
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(initialData ? "" : "운영 정보를 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요.");
  const [modalError, setModalError] = useState("");
  const [mustRefresh, setMustRefresh] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const schools = data?.schools ?? [];
  const active = schools.filter(school => school.is_active);
  const unassigned = active.filter(school => !school.administrators.length);
  const managers = new Set(active.flatMap(school => school.administrators.map(admin => admin.user_id))).size;
  const filtered = schools.filter(school => school.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    && (filter === "all" || filter === "active" && school.is_active || filter === "paused" && !school.is_active || filter === "unassigned" && school.is_active && !school.administrators.length));
  const maxPage = Math.max(1, Math.ceil(filtered.length / 8));
  const currentPage = Math.min(page, maxPage);
  const visible = filtered.slice((currentPage - 1) * 8, currentPage * 8);

  function navigate(next: View) { setView(next); setQuery(""); setFilter("all"); setPage(1); }
  function open(next: Modal) {
    setModalError(""); setMustRefresh(false); setUserId(""); setSchoolName(next.kind === "create" ? "" : next.school.name); setModal(next);
  }
  async function refresh(): Promise<boolean> {
    setRefreshing(true); setError("");
    try {
      const response = await fetch("/api/site-admin", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setData(null); window.location.assign(response.status === 401 ? "/login" : "/dashboard"); return false;
      }
      if (!response.ok) throw new Error();
      setData(await response.json()); return true;
    } catch { setError("최신 정보를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요."); return false; }
    finally { setRefreshing(false); }
  }
  async function mutate(command: AdminMutation, success: string) {
    if (busy.current) return;
    busy.current = true; setPending(true); setModalError(""); setMessage("");
    try {
      const response = await fetch("/api/site-admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { setData(null); window.location.assign(response.status === 401 ? "/login" : "/dashboard"); return; }
        setModalError(result.error || "변경하지 못했습니다. 다시 시도해 주세요.");
        setMustRefresh(response.status === 409 || response.status >= 500); return;
      }
      setModal(null); setMessage(success);
      await refresh();
    } catch { setModalError("저장 결과를 확인하지 못했습니다. 목록에서 반영 여부를 확인한 뒤 다시 진행해 주세요."); setMustRefresh(true); }
    finally { busy.current = false; setPending(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || mustRefresh) return;
    if (modal.kind === "create") void mutate({ action: "create_school", name: schoolName }, "학교가 등록됐습니다. 학교 관리자를 지정해 주세요.");
    if (modal.kind === "edit") void mutate({ action: "save_school", id: modal.school.id, name: schoolName, version: modal.school.version }, "학교 이름을 변경했습니다.");
    if (modal.kind === "status") void mutate({ action: "save_school", id: modal.school.id, name: modal.school.name, version: modal.school.version, active: !modal.school.is_active }, modal.school.is_active ? "학교 사용을 중지했습니다. 기존 기록은 보존됩니다." : "학교 사용을 복구했습니다.");
    if (modal.kind === "managers") void mutate({ action: "set_manager", id: modal.school.id, user_id: userId, version: modal.school.version, assign: true }, "학교 관리자를 지정했습니다.");
  }

  return <div className="admin-app">
    <a className="admin-skip" href="#admin-main">본문으로 건너뛰기</a>
    <aside className="admin-sidebar">
      <Brand />
      <div className="admin-workspace"><span className="admin-workspace-icon"><Icon name="school" /></span><div><strong>사이트 관리</strong><small>전체 학교 운영 공간</small></div><span className="admin-workspace-dot" /></div>
      <span className="admin-nav-label">WORKSPACE</span>
      <nav aria-label="사이트 관리 메뉴">{navigation.map(item => <button key={item.id} className={`admin-nav-item ${view === item.id ? "is-active" : ""}`} aria-current={view === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span>{item.id === "schools" && data && <span className="admin-nav-count">{schools.length}</span>}</button>)}</nav>
      <div className="admin-sidebar-note"><span className="admin-leaf" aria-hidden="true">✳</span><strong>함께 시작하는 학교</strong><p>학교를 연결하고,<br />선생님의 수업을 지원하세요.</p></div>
      <div className="admin-profile"><span className="admin-avatar">{profile.display_name.slice(0, 1)}</span><div><strong>{profile.display_name}</strong><small>사이트 관리자</small></div><a href="/password" aria-label="내 비밀번호 변경" title="비밀번호 변경">⚙</a></div>
    </aside>
    <div className="admin-workspace-main">
      <header className="admin-topbar"><div><span>사이트 관리</span><span className="admin-breadcrumb">/</span><strong>{navigation.find(item => item.id === view)?.label}</strong></div><div className="admin-topbar-actions"><span className="admin-role-badge">사이트 관리자</span><LogoutButton /></div></header>
      <main id="admin-main" className="admin-main">
        <div className="admin-page-heading"><div><span className="eyebrow">SCHOOL WORKSPACE</span><h1>{view === "overview" ? "우리 학교들의 시작을 함께해요." : view === "schools" ? "학교 관리" : view === "managers" ? "학교 관리자" : "사이트 운영 안내"}</h1><p>{view === "overview" ? `${profile.display_name}님, 학교 운영 현황과 필요한 작업을 확인하세요.` : view === "schools" ? "등록한 학교 정보를 확인하고 운영 상태를 관리하세요." : view === "managers" ? "학교별 담당 관리자를 지정하고 권한을 관리하세요." : "학교 등록부터 관리자 지정까지, 차근차근 시작하세요."}</p></div>
          {view !== "guide" && <button className="admin-primary" disabled={pending || !data} onClick={() => open({ kind: "create" })}><Icon name="plus" />학교 추가</button>}</div>
        {error && <div className="admin-error" role="alert"><span>{error}{data && " 마지막으로 불러온 정보를 표시하고 있습니다."}</span><button disabled={refreshing || pending} onClick={() => void refresh()}>다시 시도</button></div>}
        {message && <div className="admin-success" role="status"><Icon name="check" />{message}<button aria-label="알림 닫기" onClick={() => setMessage("")}>×</button></div>}
        {view === "overview" && <>
          <div className="admin-overview-meta"><span>전체 학교 현황</span><span>{data ? `${date(data.updated_at)} ${time(data.updated_at)} 기준` : "조회 대기 중"}<button className="admin-icon-button" aria-label="운영 정보 새로고침" disabled={refreshing || pending} onClick={() => void refresh()}><Icon name="refresh" /></button></span></div>
          <div className="admin-stats">
            {[{ label: "운영 중인 학교", value: active.length, unit: "개", icon: "school" as IconName, detail: `전체 ${schools.length}개 학교`, color: "green" },
              { label: "학교 관리자", value: managers, unit: "명", icon: "people" as IconName, detail: "운영 중인 학교의 담당 관리자", color: "blue" },
              { label: "활성 계정", value: data?.active_accounts ?? 0, unit: "명", icon: "check" as IconName, detail: "사이트 관리자와 선생님 포함", color: "sage" },
              { label: "관리자 지정 필요", value: unassigned.length, unit: "개교", icon: "school" as IconName, detail: "관리자가 없는 운영 중인 학교", color: "amber" }].map(stat => <div className="admin-stat" key={stat.label}><div className="admin-stat-top"><span>{stat.label}</span><span className={`admin-stat-icon ${stat.color}`}><Icon name={stat.icon} /></span></div><div className="admin-stat-value">{data ? stat.value : "—"}<small>{data && stat.unit}</small></div><p>{data ? stat.detail : "정보를 불러와 주세요"}</p></div>)}
          </div>
          {data && <div className="admin-start-banner"><div className="admin-banner-icon"><Icon name={unassigned.length ? "people" : "school"} /></div><div><strong>{!schools.length ? "첫 번째 학교를 등록해 보세요." : unassigned.length ? `관리자 지정이 필요한 학교가 ${unassigned.length}곳 있어요.` : "등록된 학교의 관리자 지정이 완료됐어요."}</strong><p>{!schools.length ? "학교를 추가한 뒤, 해당 학교를 담당할 관리자 계정을 연결할 수 있습니다." : "학교 관리자는 자기 학교의 구성과 운영을 담당합니다."}</p></div><button onClick={() => { if (!schools.length) open({ kind: "create" }); else { navigate("managers"); setFilter(unassigned.length ? "unassigned" : "all"); } }}>{!schools.length ? "학교 등록하기" : "관리자 확인하기"}<Icon name="arrow" /></button></div>}
        </>}

        {view !== "guide" && <section className="admin-panel" aria-labelledby="schools-title">
          <div className="admin-panel-heading"><div><h2 id="schools-title">{view === "managers" ? "학교별 관리자" : "등록 학교"}<span>{data ? schools.length : "—"}</span></h2><p>{view === "managers" ? "새 관리자를 먼저 지정하면 기존 관리자를 해제할 수 있습니다." : "학교와 담당 관리자를 한곳에서 확인하세요."}</p></div>{view === "overview" ? <button className="admin-text-action" onClick={() => navigate("schools")}>학교 관리하기<Icon name="arrow" /></button> : <button className="admin-secondary" disabled={refreshing || pending} onClick={() => void refresh()}><Icon name="refresh" />{refreshing ? "불러오는 중" : "새로고침"}</button>}</div>
          <div className="admin-filters"><label className="admin-search"><Icon name="search" /><input aria-label="학교 이름 검색" type="search" placeholder="학교 이름으로 검색" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label><label className="admin-filter-label">상태<select aria-label="학교 상태" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}><option value="all">전체 상태</option><option value="active">운영 중</option><option value="paused">사용 중지</option><option value="unassigned">관리자 미지정</option></select></label><span className="admin-result-count">{data ? `${filtered.length}개 학교` : "조회 대기"}</span></div>
          {visible.length ? <div className="admin-table-scroll"><table className="admin-school-table"><thead><tr><th scope="col">학교 이름</th><th scope="col">운영 상태</th><th scope="col">학교 관리자</th><th scope="col">등록일</th><th scope="col"><span className="sr-only">학교 관리 동작</span></th></tr></thead><tbody>{visible.map(school => <tr key={school.id}><td><div className="admin-school-name"><span className="admin-school-avatar"><Icon name="school" /></span><strong>{school.name}</strong></div></td><td><span className={`admin-status ${school.is_active ? "active" : "paused"}`}><i />{school.is_active ? "운영 중" : "사용 중지"}</span></td><td>{school.administrators.length ? <div className="admin-manager-names">{school.administrators.map(manager => <span key={manager.user_id}>{manager.display_name}<small>{manager.username}</small></span>)}</div> : <span className="admin-unassigned">미지정</span>}</td><td className="admin-date-cell">{date(school.created_at)}</td><td><div className="admin-row-actions"><button className="admin-secondary" disabled={!school.is_active || pending} onClick={() => open({ kind: "managers", school })} aria-label={`${school.name} 관리자 지정`}>관리자 지정</button><button className="admin-icon-button" disabled={pending} aria-label={`${school.name} 정보 수정`} onClick={() => open({ kind: "edit", school })}><Icon name="edit" /></button></div></td></tr>)}</tbody></table></div>
            : <div className="admin-empty"><span className="admin-empty-icon"><Icon name="school" /></span><h3>{!data ? "학교 정보를 불러와 주세요" : schools.length ? "검색 조건에 맞는 학교가 없습니다" : "아직 등록된 학교가 없어요"}</h3><p>{!data ? "새로고침으로 다시 확인할 수 있습니다." : schools.length ? "검색어나 상태 필터를 변경해 보세요." : "첫 번째 학교를 등록하고 학교 운영을 시작해 보세요."}</p>{data && (!schools.length ? <button className="admin-secondary" onClick={() => open({ kind: "create" })}><Icon name="plus" />첫 학교 등록</button> : <button className="admin-text-action" onClick={() => { setQuery(""); setFilter("all"); }}>검색 조건 초기화</button>)}</div>}
          <div className="admin-table-footer"><span>{data ? `전체 ${filtered.length}개 중 ${filtered.length ? (currentPage - 1) * 8 + 1 : 0}–${Math.min(currentPage * 8, filtered.length)}개` : "데이터 조회 대기 중"}</span><div><button aria-label="이전 페이지" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>‹</button><span>{currentPage} / {maxPage}</span><button aria-label="다음 페이지" disabled={currentPage === maxPage} onClick={() => setPage(currentPage + 1)}>›</button></div></div>
        </section>}

        {(view === "overview" || view === "guide") && <div className="admin-bottom-grid"><section className="admin-panel admin-activity"><div className="admin-panel-heading"><div><h2>최근 운영 기록</h2><p>학교 정보와 관리자 권한의 변경 내역입니다.</p></div><span className="admin-subtle">최근 6건</span></div>{data?.recent_changes.length ? <ol>{data.recent_changes.map(entry => <li key={entry.id}><span className="admin-activity-dot" /><div><strong>{entry.school_name}</strong><p>{actionLabels[entry.action] || "운영 정보 변경"}<span> · {entry.actor_name}</span></p></div><time dateTime={entry.created_at}>{date(entry.created_at)}<br />{time(entry.created_at)}</time></li>)}</ol> : <div className="admin-activity-empty">{data ? "아직 운영 기록이 없습니다. 학교를 등록하면 이곳에 기록됩니다." : "운영 정보를 불러온 뒤 기록을 확인할 수 있습니다."}</div>}</section>
          <section className="admin-guide"><span className="eyebrow">GETTING STARTED</span><h2>학교 운영, 이렇게 시작하세요.</h2><ol><li><span>01</span><div><strong>학교 등록</strong><p>운영할 학교의 이름을 입력해 주세요.</p></div></li><li><span>02</span><div><strong>학교 관리자 지정</strong><p>기존 계정을 해당 학교에 연결하고 관리 권한을 부여하세요.</p></div></li><li><span>03</span><div><strong>등록 정보 확인</strong><p>학교 이름과 담당 관리자가 올바른지 확인하세요.</p></div></li></ol><details><summary>사용 중지와 관리자 변경 안내</summary><p>학교 사용 중지는 기존 기록을 삭제하지 않습니다. 관리자 변경은 새 관리자를 먼저 지정한 뒤 기존 관리자의 권한을 해제하세요. 해제한 계정의 학교 소속은 유지됩니다.</p></details></section></div>}
        <footer className="admin-footer"><span>학급 진도 대시보드</span><span>학교와 선생님의 배움을 연결합니다.</span></footer>
      </main>
    </div>

    {modal && <Dialog title={modal.kind === "create" ? "새 학교 등록" : modal.kind === "edit" ? "학교 정보 수정" : modal.kind === "managers" ? "학교 관리자 지정" : modal.school.is_active ? "학교 사용 중지" : "학교 사용 복구"} close={() => setModal(null)} pending={pending}>
      <form onSubmit={submit} className="admin-modal-form">
        {modal.kind !== "create" && <div className="admin-modal-school"><Icon name="school" /><strong>{modal.school.name}</strong><span className={`admin-status ${modal.school.is_active ? "active" : "paused"}`}>{modal.school.is_active ? "운영 중" : "사용 중지"}</span></div>}
        {(modal.kind === "create" || modal.kind === "edit") && <><label className="field" htmlFor="school-name"><span>학교 이름</span><input id="school-name" value={schoolName} onChange={event => setSchoolName(event.target.value)} placeholder="예: 우리초등학교" maxLength={80} required disabled={pending || mustRefresh} autoFocus /></label><p className="admin-modal-description">학교 이름은 최대 80자까지 입력할 수 있습니다.{modal.kind === "create" ? " 등록 후 학교 관리자를 지정해 주세요." : " 이름을 변경해도 기존 기록은 유지됩니다."}</p></>}
        {modal.kind === "edit" && <div className="admin-danger-zone"><div><strong>{modal.school.is_active ? "학교 사용 중지" : "학교 사용 복구"}</strong><p>학교 정보와 기존 기록을 보존합니다.</p></div><button type="button" className="admin-text-action" disabled={pending} onClick={() => open({ kind: "status", school: modal.school })}>{modal.school.is_active ? "사용 중지" : "다시 사용"}</button></div>}
        {modal.kind === "status" && <p className="admin-modal-description">{modal.school.is_active ? "이 학교의 운영을 중지할까요? 학교의 관리 권한을 사용할 수 없게 되며, 기존 소속과 기록은 유지됩니다. 이후 다시 복구할 수 있습니다." : "이 학교를 다시 운영할까요? 기존 소속과 관리자 지정 정보가 유지된 상태로 복구됩니다."}</p>}
        {modal.kind === "managers" && <>
          <div className="admin-current-managers"><strong>현재 관리자</strong>{modal.school.administrators.length ? modal.school.administrators.map(manager => <div key={manager.user_id}><span>{manager.display_name}<small>{manager.username}</small></span><button type="button" className="admin-text-action" disabled={pending || mustRefresh || modal.school.administrators.length <= 1} title={modal.school.administrators.length <= 1 ? "새 관리자를 먼저 지정해 주세요" : "학교 소속을 유지하고 관리 권한만 해제합니다"} onClick={() => { if (window.confirm(`${manager.display_name}님의 학교 관리자 권한을 해제할까요? 학교 소속은 유지됩니다.`)) void mutate({ action: "set_manager", id: modal.school.id, user_id: manager.user_id, version: modal.school.version, assign: false }, "관리 권한을 해제했습니다. 학교 소속은 유지됩니다."); }}>권한 해제</button></div>) : <p>아직 지정된 관리자가 없습니다.</p>}</div>
          <label className="field" htmlFor="manager-account"><span>관리자로 지정할 계정</span><select id="manager-account" required value={userId} onChange={event => setUserId(event.target.value)} disabled={pending || mustRefresh}><option value="">계정을 선택해 주세요</option>{data?.accounts.filter(account => (!account.school_id || account.school_id === modal.school.id) && !modal.school.administrators.some(manager => manager.user_id === account.user_id)).map(account => <option value={account.user_id} key={account.user_id}>{account.display_name} ({account.username}){account.school_id ? "" : " · 학교 미소속"}</option>)}</select></label>
          <p className="admin-modal-description">학교 미소속 계정을 선택하면 이 학교에 등록하고 관리 권한을 함께 부여합니다. 다른 학교에 소속된 계정은 선택할 수 없습니다. 사이트 관리자 권한은 부여하지 않습니다.</p>
        </>}
        {modalError && <p className="form-error" role="alert">{modalError}</p>}
        <div className="admin-modal-footer"><button type="button" className="admin-secondary" disabled={pending} onClick={() => setModal(null)}>취소</button>{mustRefresh ? <button type="button" className="admin-primary" disabled={pending} onClick={() => { setModal(null); void refresh(); }}>최신 목록 확인</button> : <button className="admin-primary" type="submit" disabled={pending || (modal.kind === "managers" && !userId)}>{pending ? "저장 중…" : modal.kind === "create" ? "학교 등록" : modal.kind === "managers" ? "관리자 지정" : modal.kind === "status" ? modal.school.is_active ? "사용 중지 확인" : "복구 확인" : "변경 저장"}</button>}</div>
      </form>
    </Dialog>}
  </div>;
}
