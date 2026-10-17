import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchoolSnapshot, TeacherSnapshot } from "./types";
export async function schoolSnapshot(client: SupabaseClient, period: string | null = null): Promise<SchoolSnapshot> {
  const result = await client.rpc("school_workspace_snapshot", { target_period: period });
  if (result.error) throw result.error;
  return result.data;
}
export async function teacherSnapshot(client: SupabaseClient, classroom: string | null = null): Promise<TeacherSnapshot> {
  const result = await client.rpc("teacher_workspace_snapshot", { target_classroom: classroom });
  if (result.error) throw result.error;
  return result.data;
}
