import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SiteAdminSnapshot } from "./types";

export async function siteAdminSnapshot(client: SupabaseClient): Promise<SiteAdminSnapshot> {
  const { data, error } = await client.rpc("site_admin_snapshot");
  if (error || !data) throw new Error("SITE_ADMIN_LOAD_FAILED");
  return data as SiteAdminSnapshot;
}
