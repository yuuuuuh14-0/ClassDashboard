import "server-only";
import { redirect } from "next/navigation";
import { authConfig } from "@/lib/supabase/config";
import { userClient } from "@/lib/supabase/server";

export type Profile = {
  user_id: string;
  username: string;
  display_name: string;
  is_active: boolean;
  is_site_admin: boolean;
  password_change_required: boolean;
};

export async function currentAccount() {
  if (!authConfig()) return null;
  const client = await userClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  const { data: profile, error: profileError } = await client.from("profiles")
    .select("user_id,username,display_name,is_active,is_site_admin,password_change_required")
    .eq("user_id", user.id).maybeSingle();
  if (profileError || !profile || !profile.is_active) return null;
  return { user, profile: profile as Profile, client };
}

export async function requireAccount(allowPasswordChange = false) {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (account.profile.password_change_required && !allowPasswordChange) redirect("/password");
  return account;
}
