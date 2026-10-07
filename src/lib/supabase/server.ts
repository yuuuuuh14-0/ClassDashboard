import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { authConfig } from "./config";

export async function userClient() {
  const config = authConfig();
  if (!config) throw new Error("AUTH_NOT_CONFIGURED");
  const cookieStore = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component rendering cannot write cookies; proxy refreshes them.
        }
      },
    },
  });
}

export function adminClient() {
  const config = authConfig();
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!config || !secret) throw new Error("AUTH_NOT_CONFIGURED");
  return createClient(config.url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
