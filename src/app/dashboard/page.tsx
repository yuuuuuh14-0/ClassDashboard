import { requireAccount } from "@/lib/auth/account";
import { Brand } from "@/components/brand";
import { LogoutButton } from "@/components/account-actions";
import { SiteAdminDashboard } from "@/components/site-admin-dashboard";
import { siteAdminSnapshot } from "@/lib/site-admin/server";
import { dashboardAccess, gradeAdminSnapshot } from "@/lib/grade-admin/server";
import { GradeAdminDashboard } from "@/components/grade-admin-dashboard";
import { SchoolAdminDashboard } from "@/components/school-admin-dashboard";
import { TeacherDashboard } from "@/components/teacher-dashboard";
import { schoolSnapshot, teacherSnapshot } from "@/lib/workspace/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { profile, client } = await requireAccount();
  if (profile.is_site_admin) {
    let data = null;
    try { data = await siteAdminSnapshot(client); } catch { /* Render a retry state instead of invented totals. */ }
    return <SiteAdminDashboard profile={profile} initialData={data} />;
  }
  let access;
  try { access = await dashboardAccess(client); } catch {
    return <main className="account-page"><header className="app-header"><Brand /><LogoutButton /></header><section className="welcome-card"><h1>배정 정보를 불러오지 못했습니다.</h1><p className="login-description">잠시 후 다시 시도해 주세요.</p><a href="/dashboard" className="secondary-button inline-button">다시 시도</a></section></main>;
  }
  if (access.school_role === "school_admin") {
    let data = null;
    try { data = await schoolSnapshot(client); } catch { /* Render retry state. */ }
    return <SchoolAdminDashboard profile={profile} initialData={data} />;
  }
  if (access.grades.length) {
    let data = null;
    try { data = await gradeAdminSnapshot(client, access.grades[0].id); } catch { /* Show the retry state. */ }
    return <GradeAdminDashboard profile={profile} contexts={access.grades} initialData={data} />;
  }
  let data = null;
  try { data = await teacherSnapshot(client); } catch { /* Render retry state. */ }
  return <TeacherDashboard profile={profile} initialData={data} />;
}
