import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardAccess, GradeSnapshot } from "./types";

export async function dashboardAccess(client: SupabaseClient): Promise<DashboardAccess> {
  const result = await client.rpc("dashboard_access");
  if (result.error || !result.data) throw new Error("DASHBOARD_ACCESS_FAILED");
  return result.data as DashboardAccess;
}
export async function gradeAdminSnapshot(client: SupabaseClient, gradeId: string): Promise<GradeSnapshot> {
  const result = await client.rpc("grade_admin_snapshot", { target_grade: gradeId });
  if (result.error || !result.data) throw new Error("GRADE_LOAD_FAILED");
  return result.data as GradeSnapshot;
}
